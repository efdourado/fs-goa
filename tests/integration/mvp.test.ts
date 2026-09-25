import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL é obrigatória para o teste de integração.");
process.env.APP_ORIGIN = "http://goa.test";

const { DELETE, GET, PATCH, POST } = await import("../../app/api/[...path]/route");
const { dateKeyInTimeZone } = await import("../../lib/goa/domain/shared");
const adminPool = new pg.Pool({ connectionString: databaseUrl, max: 1 });

type ClientSession = { cookie: string; csrf: string; user: { id: string; name: string; username: string } };

async function call(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  options: { session?: ClientSession; body?: unknown; csrf?: boolean } = {},
) {
  const headers = new Headers({ accept: "application/json" });
  if (method !== "GET") headers.set("origin", "http://goa.test");
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (options.session) {
    headers.set("cookie", options.session.cookie);
    if (options.csrf !== false) headers.set("x-csrf-token", options.session.csrf);
  }
  const request = new Request(`http://goa.test${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const response = method === "GET" ? await GET(request)
    : method === "POST" ? await POST(request)
    : method === "PATCH" ? await PATCH(request)
    : await DELETE(request);
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();
  return { response, body };
}

async function register(name: string, username: string): Promise<ClientSession> {
  const result = await call("POST", "/api/auth/register", {
    body: { name, username, password: "uma senha segura 123" },
  });
  assert.equal(result.response.status, 201, JSON.stringify(result.body));
  const payload = result.body as { user: ClientSession["user"]; csrfToken: string };
  const setCookie = result.response.headers.get("set-cookie");
  if (!setCookie) throw new Error("Cookie de sessão ausente.");
  assert.ok(setCookie.includes("__Host-goa_session="));
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /Secure/i);
  assert.match(setCookie, /SameSite=Lax/i);
  return { cookie: setCookie.split(";", 1)[0], csrf: payload.csrfToken, user: payload.user };
}

async function login(username: string): Promise<ClientSession> {
  const result = await call("POST", "/api/auth/login", {
    body: { username, password: "uma senha segura 123" },
  });
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  const payload = result.body as { user: ClientSession["user"]; csrfToken: string };
  const setCookie = result.response.headers.get("set-cookie");
  if (!setCookie) throw new Error("Cookie de sessão ausente.");
  return { cookie: setCookie.split(";", 1)[0], csrf: payload.csrfToken, user: payload.user };
}

before(async () => {
  const database = await adminPool.query<{ current_database: string }>("SELECT current_database()");
  if (database.rows[0]?.current_database !== "goa_test") {
    throw new Error("O teste de integração se recusa a limpar um banco que não seja goa_test.");
  }
  await adminPool.query("TRUNCATE users CASCADE");
});

after(async () => {
  await adminPool.end();
  const { getPool } = await import("../../lib/db");
  await getPool().end();
});

test("executa o MVP completo com isolamento, métricas, vitrine e duplicação estrutural", async () => {
  const owner = await register("Eduardo", "eduardo");
  const participant = await register("Ana", "ana_filmes");
  const outsider = await register("João", "joao_outro");

  const groupResponse = await call("POST", "/api/groups", {
    session: owner,
    body: { name: "Clube do Sofá" },
  });
  assert.equal(groupResponse.response.status, 201, JSON.stringify(groupResponse.body));
  const groupId = (groupResponse.body as { id: string }).id;

  const inviteResponse = await call("POST", `/api/groups/${groupId}/invites`, {
    session: owner,
    body: { expiresInDays: 7, maxUses: 1 },
  });
  assert.equal(inviteResponse.response.status, 201, JSON.stringify(inviteResponse.body));
  const inviteToken = (inviteResponse.body as { token: string }).token;
  const inviteDb = await adminPool.query<{ token_hash: string }>("SELECT token_hash FROM group_invites LIMIT 1");
  assert.notEqual(inviteDb.rows[0]?.token_hash, inviteToken, "token bruto do convite não pode ser persistido");

  const accepted = await call("POST", `/api/invites/${inviteToken}`, { session: participant, body: {} });
  assert.equal(accepted.response.status, 200, JSON.stringify(accepted.body));
  const replay = await call("POST", `/api/invites/${inviteToken}`, { session: participant, body: {} });
  assert.equal(replay.response.status, 200, "aceite repetido pela mesma conta deve ser idempotente");

  const participantGroupEdit = await call("PATCH", `/api/groups/${groupId}`, {
    session: participant,
    body: { name: "Clube invadido", description: "Participantes não podem editar o grupo." },
  });
  assert.equal(participantGroupEdit.response.status, 403, "participante não pode editar os dados do grupo");

  const outsiderGroupEdit = await call("PATCH", `/api/groups/${groupId}`, {
    session: outsider,
    body: { name: "Grupo alheio", description: "Não deve revelar a existência do grupo." },
  });
  assert.equal(outsiderGroupEdit.response.status, 404, "usuário externo não pode descobrir o grupo pela edição");

  const ownerGroupEdit = await call("PATCH", `/api/groups/${groupId}`, {
    session: owner,
    body: { name: "Clube do Sofá Editado", description: "Cinema, conversa e bons hábitos." },
  });
  assert.equal(ownerGroupEdit.response.status, 200, JSON.stringify(ownerGroupEdit.body));
  assert.deepEqual(ownerGroupEdit.body, {
    id: groupId,
    name: "Clube do Sofá Editado",
    description: "Cinema, conversa e bons hábitos.",
    recommendationsEnabled: true,
  });

  await adminPool.query(
    "UPDATE group_members SET role='admin' WHERE group_id=$1 AND user_id=$2",
    [groupId, participant.user.id],
  );
  const adminGroupEdit = await call("PATCH", `/api/groups/${groupId}`, {
    session: participant,
    body: { name: "Clube do Sofá Editado", description: "Descrição revisada por uma administradora." },
  });
  await adminPool.query(
    "UPDATE group_members SET role='participant' WHERE group_id=$1 AND user_id=$2",
    [groupId, participant.user.id],
  );
  assert.equal(adminGroupEdit.response.status, 200, JSON.stringify(adminGroupEdit.body));
  assert.equal((adminGroupEdit.body as { id: string }).id, groupId, "editar o grupo deve preservar seu ID");

  const editedGroupBootstrap = await call("GET", "/api/bootstrap", { session: owner });
  assert.equal(editedGroupBootstrap.response.status, 200, JSON.stringify(editedGroupBootstrap.body));
  const editedGroup = (editedGroupBootstrap.body as {
    groups: Array<{ id: string; name: string; description: string | null }>;
  }).groups.find((group) => group.id === groupId);
  assert.ok(editedGroup);
  assert.equal(editedGroup.id, groupId);
  assert.equal(editedGroup.name, "Clube do Sofá Editado");
  assert.equal(editedGroup.description, "Descrição revisada por uma administradora.");

  const outsiderGroup = await call("POST", "/api/groups", { session: outsider, body: { name: "Outro grupo" } });
  assert.equal(outsiderGroup.response.status, 201);
  const outsiderGroupId = (outsiderGroup.body as { id: string }).id;
  const targetGroup = await call("POST", "/api/groups", { session: owner, body: { name: "Clube de modelos" } });
  assert.equal(targetGroup.response.status, 201, JSON.stringify(targetGroup.body));
  const targetGroupId = (targetGroup.body as { id: string }).id;

  const challengeResponse = await call("POST", `/api/groups/${groupId}/challenges`, {
    session: owner,
    body: {
      template: "cine",
      title: "Cine — 2 filmes",
      description: "Piloto de cinema",
      ruleSections: [
        { title: "Assistir por inteiro", description: "Veja o filme até o fim antes de avaliar." },
        { title: "Registrar a impressão", description: "Dê uma nota e conte o que ficou com você." },
      ],
      startsOn: "2026-08-01",
      endsOn: "2026-09-30",
      submissionMode: "item",
      participantIds: [owner.user.id, participant.user.id],
      fields: [
        { key: "nota", label: "Nota", type: "rating", required: true },
        { key: "comentario", label: "Comentário", type: "text", required: false, config: { maxLength: 280 } },
      ],
      items: [{ title: "Aftersun" }, { title: "Perfect Days" }],
    },
  });
  assert.equal(challengeResponse.response.status, 201, JSON.stringify(challengeResponse.body));
  const challengeId = (challengeResponse.body as { id: string }).id;
  assert.equal((challengeResponse.body as { kind: string }).kind, "round", "um desafio de grupo com período é um round, não uma lista");

  const originalDraftDetail = await call("GET", `/api/challenges/${challengeId}`, { session: owner });
  assert.equal(originalDraftDetail.response.status, 200, JSON.stringify(originalDraftDetail.body));
  assert.equal((originalDraftDetail.body as { kind: string }).kind, "round", "o detalhe do desafio também expõe kind");
  const originalDraftItems = (originalDraftDetail.body as {
    items: Array<{ id: string; title: string; description: string | null }>;
  }).items;
  assert.deepEqual((originalDraftDetail.body as { ruleSections: unknown }).ruleSections, [
    { title: "Assistir por inteiro", description: "Veja o filme até o fim antes de avaliar." },
    { title: "Registrar a impressão", description: "Dê uma nota e conte o que ficou com você." },
  ]);
  const originalItemIds = originalDraftItems.map((item) => item.id);
  assert.equal(originalItemIds.length, 2);

  const ownerDraftItemEdit = await call(
    "PATCH",
    `/api/challenges/${challengeId}/items/${originalItemIds[0]}`,
    {
      session: owner,
      body: { title: "Aftersun — seleção do clube", description: "Primeiro filme da rodada." },
    },
  );
  assert.equal(ownerDraftItemEdit.response.status, 200, JSON.stringify(ownerDraftItemEdit.body));
  assert.deepEqual(ownerDraftItemEdit.body, {
    id: originalItemIds[0],
    title: "Aftersun — seleção do clube",
    description: "Primeiro filme da rodada.",
    opensAt: null,
    dueAt: null,
    schedulePrecision: "datetime",
  });
  const updatedRules = [
    {
      title: "Assistir por inteiro",
      description: "Veja o filme até o fim antes de avaliar.",
      topics: [{ title: "sem trailer", description: "spoilers atrapalham a nota" }],
    },
    { title: "Compartilhar com cuidado", description: "Dê uma nota e respeite a experiência das outras pessoas." },
  ];
  const rulesEdit = await call("PATCH", `/api/challenges/${challengeId}`, {
    session: owner,
    body: { ruleSections: updatedRules },
  });
  assert.equal(rulesEdit.response.status, 200, JSON.stringify(rulesEdit.body));
  assert.deepEqual((rulesEdit.body as { ruleSections: unknown }).ruleSections, updatedRules);

  const draftAfterOwnerEdit = await call("GET", `/api/challenges/${challengeId}`, { session: owner });
  assert.equal(draftAfterOwnerEdit.response.status, 200, JSON.stringify(draftAfterOwnerEdit.body));
  const draftAfterOwnerItems = (draftAfterOwnerEdit.body as {
    items: Array<{ id: string; title: string; description: string | null }>;
  }).items;
  assert.deepEqual(draftAfterOwnerItems.map((item) => item.id), originalItemIds, "editar não deve recriar os itens");
  assert.equal(draftAfterOwnerItems[0].title, "Aftersun — seleção do clube");
  assert.equal(draftAfterOwnerItems[0].description, "Primeiro filme da rodada.");

  const hiddenDraft = await call("GET", `/api/challenges/${challengeId}`, { session: participant });
  assert.equal(hiddenDraft.response.status, 404, "participante não pode descobrir rascunho antes da ativação");
  const crossTenant = await call("GET", `/api/challenges/${challengeId}`, { session: outsider });
  assert.equal(crossTenant.response.status, 404, "membro de outro grupo não pode descobrir o desafio");

  await adminPool.query(
    "UPDATE group_members SET role='admin' WHERE group_id=$1 AND user_id=$2",
    [groupId, participant.user.id],
  );
  const adminDraftItemEdit = await call(
    "PATCH",
    `/api/challenges/${challengeId}/items/${originalItemIds[1]}`,
    {
      session: participant,
      body: { title: "Perfect Days — edição do clube", description: "Segundo filme da rodada." },
    },
  );
  await adminPool.query(
    "UPDATE group_members SET role='participant' WHERE group_id=$1 AND user_id=$2",
    [groupId, participant.user.id],
  );
  assert.equal(adminDraftItemEdit.response.status, 200, JSON.stringify(adminDraftItemEdit.body));
  assert.equal((adminDraftItemEdit.body as { id: string }).id, originalItemIds[1]);

  const missingCsrf = await call("POST", `/api/challenges/${challengeId}/transition`, {
    session: { ...owner, csrf: "" }, body: { status: "active" }, csrf: false,
  });
  assert.equal(missingCsrf.response.status, 403);

  const activated = await call("POST", `/api/challenges/${challengeId}/transition`, {
    session: owner, body: { status: "active" },
  });
  assert.equal(activated.response.status, 200, JSON.stringify(activated.body));

  const activeItemEdit = await call(
    "PATCH",
    `/api/challenges/${challengeId}/items/${originalItemIds[0]}`,
    {
      session: owner,
      body: { title: "Aftersun (2022)", description: "Título corrigido durante o desafio." },
    },
  );
  assert.equal(activeItemEdit.response.status, 200, JSON.stringify(activeItemEdit.body));
  assert.equal((activeItemEdit.body as { id: string }).id, originalItemIds[0]);

  const activeFieldAdd = await call("POST", `/api/challenges/${challengeId}/fields`, {
    session: owner,
    body: { label: "Onde assistiu", type: "text", required: false },
  });
  assert.equal(activeFieldAdd.response.status, 201, JSON.stringify(activeFieldAdd.body));

  const activeExtend = await call("PATCH", `/api/challenges/${challengeId}`, {
    session: owner, body: { startsOn: "2026-08-01", endsOn: "2026-12-31" },
  });
  assert.equal(activeExtend.response.status, 200, JSON.stringify(activeExtend.body));
  assert.equal((activeExtend.body as { endsOn: string }).endsOn, "2026-12-31", "o prazo de um desafio ativo pode ser estendido");

  const detail = await call("GET", `/api/challenges/${challengeId}`, { session: participant });
  assert.equal(detail.response.status, 200, JSON.stringify(detail.body));
  const challenge = detail.body as {
    fields: Array<{ id: string; key: string }>;
    items: Array<{ id: string; title: string }>;
    metrics: Array<{ id: string }>;
  };
  assert.deepEqual(challenge.items.map((item) => item.id), originalItemIds, "edições em draft e active devem preservar IDs");
  assert.deepEqual(challenge.items.map((item) => item.title), ["Aftersun (2022)", "Perfect Days — edição do clube"]);
  const ratingId = challenge.fields.find((field) => field.key === "nota")?.id;
  const commentId = challenge.fields.find((field) => field.key === "comentario")?.id;
  assert.ok(ratingId && commentId);
  assert.ok(
    challenge.fields.some((field) => field.key === "onde_assistiu"),
    "campo adicionado com o desafio ativo aparece no detalhe",
  );

  const saved = await call("POST", `/api/challenges/${challengeId}/entries`, {
    session: participant,
    body: {
      itemId: challenge.items[0].id,
      values: { [ratingId]: 4.5, [commentId]: "canario-pessoal: uma memória bonita" },
    },
  });
  assert.equal(saved.response.status, 201, JSON.stringify(saved.body));
  const entryId = (saved.body as { id: string }).id;

  const forbiddenMetric = await call("POST", `/api/challenges/${challengeId}/metrics`, {
    session: participant,
    body: { label: "Tentativa", operation: "average", fieldId: ratingId },
  });
  assert.equal(forbiddenMetric.response.status, 403);
  const hiddenMetric = await call("POST", `/api/challenges/${challengeId}/metrics`, {
    session: owner,
    body: { label: "Contagem reservada", operation: "count", visibleDuring: false, visibleInResults: false },
  });
  assert.equal(hiddenMetric.response.status, 201, JSON.stringify(hiddenMetric.body));

  const entries = await call("GET", `/api/challenges/${challengeId}/entries`, { session: owner });
  assert.equal(entries.response.status, 200);
  assert.equal((entries.body as { entries: unknown[] }).entries.length, 1);

  const strandingShrink = await call("PATCH", `/api/challenges/${challengeId}`, {
    session: owner, body: { startsOn: "2026-08-01", endsOn: "2026-08-02" },
  });
  assert.equal(strandingShrink.response.status, 409, "encurtar o prazo por cima de um registro é barrado");
  assert.equal((strandingShrink.body as { error: string }).error, "schedule_would_strand_entries");

  // Remover um item que já tem registro: os registros presos a ele saem em cascata.
  const cascadeItem = await call("POST", `/api/challenges/${challengeId}/items`, {
    session: owner, body: { items: [{ title: "Item removido junto com o registro" }] },
  });
  const cascadeItemId = (cascadeItem.body as { itemIds: string[] }).itemIds[0];
  const cascadeEntry = await call("POST", `/api/challenges/${challengeId}/entries`, {
    session: participant, body: { itemId: cascadeItemId, values: { [ratingId]: 3 } },
  });
  assert.equal(cascadeEntry.response.status, 201, JSON.stringify(cascadeEntry.body));
  const archiveUsedItem = await call("DELETE", `/api/challenges/${challengeId}/items/${cascadeItemId}`, {
    session: owner,
  });
  assert.equal(archiveUsedItem.response.status, 200, JSON.stringify(archiveUsedItem.body));
  assert.equal((archiveUsedItem.body as { entriesRemoved: number }).entriesRemoved, 1, "o registro do item sai junto");
  const afterCascade = await call("GET", `/api/challenges/${challengeId}/entries`, { session: owner });
  assert.equal((afterCascade.body as { entries: unknown[] }).entries.length, 1, "sobra apenas o registro do primeiro item");

  const extraItem = await call("POST", `/api/challenges/${challengeId}/items`, {
    session: owner, body: { items: [{ title: "Item adicionado no meio da rodada" }] },
  });
  assert.equal(extraItem.response.status, 201, JSON.stringify(extraItem.body));
  const extraItemId = (extraItem.body as { itemIds: string[] }).itemIds[0];
  const archiveExtra = await call("DELETE", `/api/challenges/${challengeId}/items/${extraItemId}`, {
    session: owner,
  });
  assert.equal(archiveExtra.response.status, 200, JSON.stringify(archiveExtra.body));
  const afterArchive = await call("GET", `/api/challenges/${challengeId}`, { session: owner });
  assert.deepEqual(
    (afterArchive.body as { items: Array<{ id: string }> }).items.map((item) => item.id),
    originalItemIds,
    "o item recém-arquivado some e os originais continuam",
  );

  const closed = await call("POST", `/api/challenges/${challengeId}/transition`, {
    session: owner, body: { status: "closed" },
  });
  assert.equal(closed.response.status, 200, JSON.stringify(closed.body));
  const closedItemEdit = await call(
    "PATCH",
    `/api/challenges/${challengeId}/items/${originalItemIds[0]}`,
    { session: owner, body: { title: "Não pode mudar depois do encerramento" } },
  );
  assert.equal(closedItemEdit.response.status, 409, "item de desafio encerrado deve permanecer bloqueado");
  const finalDetail = await call("GET", `/api/challenges/${challengeId}`, { session: owner });
  const finalMetrics = (finalDetail.body as { metrics: Array<{ id: string }> }).metrics;
  // Salvar rascunho não publica: nenhum link é criado.
  const draft = await call("POST", `/api/challenges/${challengeId}/results`, {
    session: owner,
    body: {
      headline: "Duas histórias na tela",
      summary: "Nosso primeiro piloto concluído.",
      metricIds: finalMetrics.map((metric) => metric.id),
      comments: [{ entryId, fieldId: commentId }],
    },
  });
  assert.equal(draft.response.status, 200, JSON.stringify(draft.body));
  assert.equal((draft.body as { published: boolean }).published, false);

  const publish = await call("POST", `/api/challenges/${challengeId}/results/publish`, {
    session: owner, body: {},
  });
  assert.equal(publish.response.status, 200, JSON.stringify(publish.body));
  const shareToken = (publish.body as { shareToken: string }).shareToken;
  const shareUrl = (publish.body as { url: string }).url;
  assert.ok(shareToken);
  assert.ok(shareUrl.endsWith(`/results/${shareToken}`), shareUrl);
  const showcase = await call("GET", `/api/results/${shareToken}`);
  assert.equal(showcase.response.status, 200, JSON.stringify(showcase.body));
  assert.match(JSON.stringify(showcase.body), /Duas histórias na tela/);

  // O token fica guardado (migração 0035): o detalhe do desafio o devolve para
  // que o link possa ser mostrado de novo, não só na hora de publicar.
  const detailWithToken = await call("GET", `/api/challenges/${challengeId}`, { session: owner });
  assert.equal((detailWithToken.body as { result: { shareToken?: string } }).result.shareToken, shareToken, "o token volta no detalhe");

  // Sem snapshot congelado: salvar de novo já aparece no link publicado, sem
  // precisar republicar.
  await call("POST", `/api/challenges/${challengeId}/results`, {
    session: owner,
    body: { headline: "Manchete atualizada ao vivo", summary: "x", metricIds: [], comments: [] },
  });
  const live = await call("GET", `/api/results/${shareToken}`);
  assert.match(JSON.stringify(live.body), /Manchete atualizada ao vivo/, "o link publicado segue o que foi salvo, sem republicar");
  assert.doesNotMatch(JSON.stringify(live.body), /Duas histórias na tela/, "o texto antigo não fica preso num snapshot");

  // Re-publicar sem rotacionar mantém o mesmo link e devolve o mesmo token.
  const republishSame = await call("POST", `/api/challenges/${challengeId}/results/publish`, { session: owner, body: {} });
  assert.equal((republishSame.body as { shareToken: string | null }).shareToken, shareToken, "re-publicar devolve o mesmo token guardado");
  assert.equal((await call("GET", `/api/results/${shareToken}`)).response.status, 200, "o link antigo continua valendo");

  // "Gerar novo link" invalida o token anterior.
  const rotated = await call("POST", `/api/challenges/${challengeId}/results/publish`, {
    session: owner, body: { rotateLink: true },
  });
  const rotatedToken = (rotated.body as { shareToken: string }).shareToken;
  assert.notEqual(rotatedToken, shareToken);
  assert.equal((await call("GET", `/api/results/${shareToken}`)).response.status, 404, "o link antigo para de funcionar");
  assert.equal((await call("GET", `/api/results/${rotatedToken}`)).response.status, 200);

  // Anonimização: marca a opção, republica no mesmo link, e os nomes somem.
  await call("POST", `/api/challenges/${challengeId}/results`, {
    session: owner,
    body: { headline: "Duas histórias na tela", summary: "s", metricIds: finalMetrics.map((m) => m.id), comments: [], anonymizeParticipants: true },
  });
  await call("POST", `/api/challenges/${challengeId}/results/publish`, { session: owner, body: {} });
  const anonToken = rotatedToken;
  const anon = await call("GET", `/api/results/${anonToken}`);
  const anonBody = anon.body as { challenge: { participants: string[]; result: { metrics: Array<{ groupBy?: string; series?: Array<{ label: string; key: string }> }> } } };
  assert.ok(anonBody.challenge.participants.every((name) => /^Participante \d+$/.test(name)), JSON.stringify(anonBody.challenge.participants));
  for (const metric of anonBody.challenge.result.metrics) {
    if (metric.groupBy !== "participant" || !metric.series) continue;
    for (const row of metric.series) {
      assert.match(row.label, /^Participante \d+$|^Participante \?$/, JSON.stringify(row));
      assert.doesNotMatch(row.key, /^[0-9a-f-]{36}$/i, "a série não pode manter o user id");
    }
  }

  // Reabrir revoga a publicação atomicamente (o CHECK do banco exige desafio fechado).
  const reopen = await call("POST", `/api/challenges/${challengeId}/transition`, {
    session: owner, body: { status: "active" },
  });
  assert.equal(reopen.response.status, 200, JSON.stringify(reopen.body));
  assert.equal((await call("GET", `/api/results/${anonToken}`)).response.status, 404, "reabrir some com o link público");
  await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "closed" } });
  const republished = await call("POST", `/api/challenges/${challengeId}/results/publish`, { session: owner, body: {} });
  assert.equal(republished.response.status, 200, JSON.stringify(republished.body));
  assert.ok((republished.body as { shareToken: string | null }).shareToken, "reabrir zerou o link, então publicar de novo cunha um token novo");
  assert.notEqual((republished.body as { shareToken: string }).shareToken, anonToken, "e não é o link revogado");

  const crossGroupDuplicate = await call("POST", `/api/challenges/${challengeId}/duplicate`, {
    session: owner, body: { title: "Cópia fora do grupo", targetGroupId: outsiderGroupId },
  });
  assert.equal(crossGroupDuplicate.response.status, 404, "grupo alheio não pode ser descoberto como destino");

  const sameGroupDuplicate = await call("POST", `/api/challenges/${challengeId}/duplicate`, {
    session: owner, body: { title: "Cópia no mesmo grupo", targetGroupId: groupId },
  });
  assert.equal(sameGroupDuplicate.response.status, 400, "a cópia precisa reutilizar o modelo em outro grupo");

  const duplicate = await call("POST", `/api/challenges/${challengeId}/duplicate`, {
    session: owner, body: { title: "Cine — edição 2", targetGroupId },
  });
  assert.equal(duplicate.response.status, 201, JSON.stringify(duplicate.body));
  const duplicateId = (duplicate.body as { id: string }).id;
  const destination = await adminPool.query<{
    group_id: string; status: string; rule_sections: unknown; participants: number; entries: number; values: number; results: number; fields: number; items: number;
  }>(
    `SELECT c.group_id, c.status, c.rule_sections,
      (SELECT count(*)::int FROM challenge_participants WHERE challenge_id=c.id) participants,
      (SELECT count(*)::int FROM entries WHERE challenge_id=c.id) entries,
      (SELECT count(*)::int FROM entry_values WHERE challenge_id=c.id) values,
      (SELECT count(*)::int FROM result_blocks WHERE challenge_id=c.id) results,
      (SELECT count(*)::int FROM challenge_fields WHERE challenge_id=c.id) fields,
      (SELECT count(*)::int FROM challenge_items WHERE challenge_id=c.id) items
     FROM challenges c WHERE c.id=$1`,
    [duplicateId],
  );
  assert.deepEqual(destination.rows[0], {
    group_id: targetGroupId, status: "draft", rule_sections: updatedRules,
    // três campos: os dois do template + "Onde assistiu", adicionado com o desafio ativo.
    participants: 0, entries: 0, values: 0, results: 0, fields: 3, items: 2,
  });
  const duplicationLedger = await adminPool.query<{ source_group_id: string; target_group_id: string }>(
    "SELECT source_group_id,target_group_id FROM challenge_duplications WHERE target_challenge_id=$1",
    [duplicateId],
  );
  assert.deepEqual(duplicationLedger.rows[0], { source_group_id: groupId, target_group_id: targetGroupId });
  const leaked = await adminPool.query<{ leaked: boolean }>(
    `SELECT EXISTS(
      SELECT 1 FROM entry_values ev WHERE ev.challenge_id=$1 AND ev.text_value LIKE '%canario-pessoal%'
    ) AS leaked`, [duplicateId]);
  assert.equal(leaked.rows[0]?.leaked, false);
  const copiedHiddenMetric = await adminPool.query<{ visible: string | null }>(
    `SELECT settings->>'visibleInResults' AS visible FROM challenge_metrics
      WHERE challenge_id=$1 AND label='Contagem reservada'`, [duplicateId]);
  assert.equal(copiedHiddenMetric.rows[0]?.visible, "false", "a duplicação deve preservar configurações da métrica");

  const incompleteDatePair = await call("POST", `/api/groups/${groupId}/challenges`, {
    session: owner,
    body: {
      title: "Período incompleto",
      startsOn: "2026-08-01",
      endsOn: null,
      submissionMode: "item",
      participantIds: [owner.user.id],
      items: [{ title: "Não deve ser criado" }],
      fields: [{ key: "nota", label: "Nota", type: "rating", required: true }],
    },
  });
  assert.equal(incompleteDatePair.response.status, 400, "início e término devem ser informados juntos");
  assert.equal((incompleteDatePair.body as { error: string }).error, "date_pair_required");

  const sessionDb = await adminPool.query<{ token_hash: string }>("SELECT token_hash FROM sessions LIMIT 1");
  assert.ok(!owner.cookie.includes(sessionDb.rows[0]?.token_hash ?? "impossivel"), "token bruto da sessão não pode estar no banco");
});

test("convites distinguem grupo e desafio, e convite por username exige aceite", async () => {
  const owner = await register("Dona Convites", "dona_convites");
  const directMember = await register("Membro Direto", "membro_direto_convites");
  const groupGuest = await register("Convidada do Grupo", "convidada_grupo_convites");
  const challengeGuest = await register("Convidada do Desafio", "convidada_desafio_convites");
  const revokedGuest = await register("Convidado Revogado", "convidado_revogado_convites");

  const groupResponse = await call("POST", "/api/groups", {
    session: owner,
    body: { name: "Grupo dos convites" },
  });
  assert.equal(groupResponse.response.status, 201, JSON.stringify(groupResponse.body));
  const groupId = (groupResponse.body as { id: string }).id;

  const outsiderAdd = await call("POST", `/api/groups/${groupId}/members`, {
    session: directMember,
    body: { username: revokedGuest.user.username },
  });
  assert.equal(outsiderAdd.response.status, 404, "quem não pertence ao grupo não pode convidar por username");

  async function pendingRequestId(userId: string): Promise<string> {
    const row = await adminPool.query<{ id: string }>(
      "SELECT id FROM group_member_requests WHERE group_id = $1 AND user_id = $2 AND status = 'pending'",
      [groupId, userId],
    );
    if (!row.rows[0]) throw new Error("solicitação pendente ausente");
    return row.rows[0].id;
  }

  const invitedByUsername = await call("POST", `/api/groups/${groupId}/members`, {
    session: owner,
    body: { username: "  MEMBRO_DIRETO_CONVITES  " },
  });
  assert.equal(invitedByUsername.response.status, 200, JSON.stringify(invitedByUsername.body));
  assert.deepEqual(invitedByUsername.body, {
    groupId,
    member: {
      id: directMember.user.id,
      name: "Membro Direto",
      username: "membro_direto_convites",
      role: "participant",
    },
    status: "requested",
  });
  const notYetMember = await adminPool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM group_members WHERE group_id = $1 AND user_id = $2 AND removed_at IS NULL",
    [groupId, directMember.user.id],
  );
  assert.equal(notYetMember.rows[0]?.count, 0, "convite por username não adiciona ninguém direto");

  const pendingReplay = await call("POST", `/api/groups/${groupId}/members`, {
    session: owner,
    body: { username: directMember.user.username },
  });
  assert.equal(pendingReplay.response.status, 200, JSON.stringify(pendingReplay.body));
  assert.equal((pendingReplay.body as { status: string }).status, "already_pending");

  const inviteeBootstrap = await call("GET", "/api/bootstrap", { session: directMember });
  const inboxRequests = (inviteeBootstrap.body as {
    memberRequests: Array<{ id: string; groupId: string; groupName: string; invitedBy: string | null; role: string }>;
  }).memberRequests;
  assert.equal(inboxRequests.length, 1);
  assert.deepEqual(
    { groupId: inboxRequests[0].groupId, groupName: inboxRequests[0].groupName, invitedBy: inboxRequests[0].invitedBy, role: inboxRequests[0].role },
    { groupId, groupName: "Grupo dos convites", invitedBy: "Dona Convites", role: "participant" },
  );
  assert.ok(
    !(inviteeBootstrap.body as { groups: Array<{ id: string }> }).groups.some((group) => group.id === groupId),
    "grupo só aparece para o convidado depois do aceite",
  );

  const wrongAccepter = await call("POST", `/api/member-requests/${inboxRequests[0].id}/accept`, {
    session: challengeGuest,
    body: {},
  });
  assert.equal(wrongAccepter.response.status, 404, "só o convidado responde à própria solicitação");

  const declined = await call("POST", `/api/member-requests/${inboxRequests[0].id}/decline`, {
    session: directMember,
    body: {},
  });
  assert.equal(declined.response.status, 200, JSON.stringify(declined.body));
  assert.equal((declined.body as { status: string }).status, "declined");

  await call("POST", `/api/groups/${groupId}/members`, { session: owner, body: { username: directMember.user.username } });
  const accepted = await call("POST", `/api/member-requests/${await pendingRequestId(directMember.user.id)}/accept`, {
    session: directMember,
    body: {},
  });
  assert.equal(accepted.response.status, 200, JSON.stringify(accepted.body));
  assert.equal((accepted.body as { status: string }).status, "accepted");
  const nowMember = await adminPool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM group_members WHERE group_id = $1 AND user_id = $2 AND removed_at IS NULL",
    [groupId, directMember.user.id],
  );
  assert.equal(nowMember.rows[0]?.count, 1, "aceite entra no grupo");
  const acceptedBootstrap = await call("GET", "/api/bootstrap", { session: directMember });
  assert.ok(
    (acceptedBootstrap.body as { groups: Array<{ id: string }> }).groups.some((group) => group.id === groupId),
    "grupo aceito aparece no bootstrap do convidado",
  );
  const acceptedRequestId = await adminPool.query<{ id: string }>(
    "SELECT id FROM group_member_requests WHERE group_id = $1 AND user_id = $2 AND status = 'accepted'",
    [groupId, directMember.user.id],
  );
  const acceptReplay = await call("POST", `/api/member-requests/${acceptedRequestId.rows[0]?.id}/accept`, {
    session: directMember,
    body: {},
  });
  assert.equal(acceptReplay.response.status, 200, JSON.stringify(acceptReplay.body));
  assert.equal((acceptReplay.body as { idempotent: boolean }).idempotent, true, "reenviar aceite é idempotente");

  const participantCannotInvite = await call("POST", `/api/groups/${groupId}/members`, {
    session: directMember,
    body: { username: revokedGuest.user.username },
  });
  assert.equal(participantCannotInvite.response.status, 403, "participante não pode convidar outra conta");

  await adminPool.query(
    "UPDATE group_members SET removed_at = now() WHERE group_id = $1 AND user_id = $2",
    [groupId, directMember.user.id],
  );
  await call("POST", `/api/groups/${groupId}/members`, { session: owner, body: { username: directMember.user.username } });
  const restored = await call("POST", `/api/member-requests/${await pendingRequestId(directMember.user.id)}/accept`, {
    session: directMember,
    body: {},
  });
  assert.equal(restored.response.status, 200, JSON.stringify(restored.body));
  const memberAudit = await adminPool.query<{ action: string }>(
    "SELECT action FROM audit_events WHERE group_id = $1 AND entity_type = 'group_member' AND entity_id = $2",
    [groupId, directMember.user.id],
  );
  assert.deepEqual(
    new Set(memberAudit.rows.map((row) => row.action)),
    new Set(["group.member_added", "group.member_restored"]),
    "aceite e restauração ficam auditados",
  );
  const requestAudit = await adminPool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM audit_events WHERE group_id = $1 AND action = 'group.member_requested'",
    [groupId],
  );
  assert.ok((requestAudit.rows[0]?.count ?? 0) >= 3, "cada convite por username gera auditoria própria");

  const challengeResponse = await call("POST", `/api/groups/${groupId}/challenges`, {
    session: owner,
    body: {
      title: "Desafio com convite próprio",
      startsOn: "2026-09-01",
      endsOn: "2026-09-30",
      submissionMode: "item",
      participantIds: [owner.user.id],
      items: [{ title: "Item único" }],
      fields: [{ key: "nota", label: "Nota", type: "rating", required: true }],
    },
  });
  assert.equal(challengeResponse.response.status, 201, JSON.stringify(challengeResponse.body));
  const challengeId = (challengeResponse.body as { id: string }).id;

  const draftInviteAttempt = await call("POST", `/api/groups/${groupId}/invites`, {
    session: owner,
    body: { expiresInDays: 7, maxUses: 1, challengeId },
  });
  assert.equal(draftInviteAttempt.response.status, 409, "não se convida para um desafio ainda em rascunho");
  assert.equal((draftInviteAttempt.body as { error: string }).error, "challenge_not_active");

  const activation = await call("POST", `/api/challenges/${challengeId}/transition`, {
    session: owner,
    body: { status: "active" },
  });
  assert.equal(activation.response.status, 200, JSON.stringify(activation.body));

  const groupInvite = await call("POST", `/api/groups/${groupId}/invites`, {
    session: owner,
    body: { expiresInDays: 7, maxUses: 1 },
  });
  assert.equal(groupInvite.response.status, 201, JSON.stringify(groupInvite.body));
  assert.equal((groupInvite.body as { kind: string }).kind, "group");
  assert.equal((groupInvite.body as { groupName: string }).groupName, "Grupo dos convites");
  assert.equal((groupInvite.body as { challengeId: string | null }).challengeId, null);
  const groupToken = (groupInvite.body as { token: string }).token;

  const anonymousGroupPreview = await call("GET", `/api/invites/${groupToken}`);
  assert.equal(anonymousGroupPreview.response.status, 200, JSON.stringify(anonymousGroupPreview.body));
  assert.equal((anonymousGroupPreview.body as { accepted: boolean }).accepted, false);
  assert.equal((anonymousGroupPreview.body as { status: string }).status, "valid");

  const acceptedGroup = await call("POST", `/api/invites/${groupToken}`, {
    session: groupGuest,
    body: {},
  });
  assert.equal(acceptedGroup.response.status, 200, JSON.stringify(acceptedGroup.body));
  assert.equal((acceptedGroup.body as { kind: string }).kind, "group");
  const groupOnlyMembership = await adminPool.query<{ group_member: boolean; challenge_participant: boolean }>(
    `SELECT
       EXISTS (SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2 AND removed_at IS NULL) AS group_member,
       EXISTS (SELECT 1 FROM challenge_participants WHERE challenge_id = $3 AND user_id = $2 AND removed_at IS NULL) AS challenge_participant`,
    [groupId, groupGuest.user.id, challengeId],
  );
  assert.deepEqual(groupOnlyMembership.rows[0], { group_member: true, challenge_participant: false });
  const acceptedGroupPreview = await call("GET", `/api/invites/${groupToken}`, { session: groupGuest });
  assert.equal((acceptedGroupPreview.body as { accepted: boolean }).accepted, true);
  assert.equal((acceptedGroupPreview.body as { status: string }).status, "accepted", "aceite pessoal prevalece sobre esgotamento global");

  const challengeInvite = await call("POST", `/api/groups/${groupId}/invites`, {
    session: owner,
    body: { expiresInDays: 7, maxUses: 1, challengeId },
  });
  assert.equal(challengeInvite.response.status, 201, JSON.stringify(challengeInvite.body));
  assert.equal((challengeInvite.body as { kind: string }).kind, "challenge");
  assert.equal((challengeInvite.body as { groupId: string }).groupId, groupId);
  assert.equal((challengeInvite.body as { challengeId: string }).challengeId, challengeId);
  assert.equal((challengeInvite.body as { challengeTitle: string }).challengeTitle, "Desafio com convite próprio");
  const challengeToken = (challengeInvite.body as { token: string }).token;
  const challengeInviteId = (challengeInvite.body as { id: string }).id;
  const targetRow = await adminPool.query<{ group_id: string; challenge_id: string }>(
    "SELECT group_id, challenge_id FROM invite_challenge_targets WHERE invite_id = $1",
    [challengeInviteId],
  );
  assert.deepEqual(targetRow.rows[0], { group_id: groupId, challenge_id: challengeId });

  const beforeChallengePreview = await call("GET", `/api/invites/${challengeToken}`, { session: challengeGuest });
  assert.equal(beforeChallengePreview.response.status, 200, JSON.stringify(beforeChallengePreview.body));
  assert.equal((beforeChallengePreview.body as { kind: string }).kind, "challenge");
  assert.equal((beforeChallengePreview.body as { accepted: boolean }).accepted, false);
  assert.equal((beforeChallengePreview.body as { status: string }).status, "valid");

  const acceptedChallenge = await call("POST", `/api/invites/${challengeToken}`, {
    session: challengeGuest,
    body: {},
  });
  assert.equal(acceptedChallenge.response.status, 200, JSON.stringify(acceptedChallenge.body));
  assert.deepEqual(acceptedChallenge.body, {
    kind: "challenge",
    groupId,
    groupName: "Grupo dos convites",
    challengeId,
    challengeTitle: "Desafio com convite próprio",
    accepted: true,
    idempotent: false,
  });
  const challengeMembership = await adminPool.query<{ group_member: boolean; challenge_participant: boolean }>(
    `SELECT
       EXISTS (SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2 AND removed_at IS NULL) AS group_member,
       EXISTS (SELECT 1 FROM challenge_participants WHERE challenge_id = $3 AND user_id = $2 AND removed_at IS NULL) AS challenge_participant`,
    [groupId, challengeGuest.user.id, challengeId],
  );
  assert.deepEqual(challengeMembership.rows[0], { group_member: true, challenge_participant: true });

  const guestOpensChallenge = await call("GET", `/api/challenges/${challengeId}`, { session: challengeGuest });
  assert.equal(guestOpensChallenge.response.status, 200, "quem aceitou o convite abre o desafio sem erro");
  assert.equal((guestOpensChallenge.body as { isParticipant: boolean }).isParticipant, true);

  const acceptedChallengePreview = await call("GET", `/api/invites/${challengeToken}`, { session: challengeGuest });
  assert.equal((acceptedChallengePreview.body as { accepted: boolean }).accepted, true);
  assert.equal((acceptedChallengePreview.body as { status: string }).status, "accepted");
  const challengeReplay = await call("POST", `/api/invites/${challengeToken}`, {
    session: challengeGuest,
    body: {},
  });
  assert.equal(challengeReplay.response.status, 200, JSON.stringify(challengeReplay.body));
  assert.equal((challengeReplay.body as { idempotent: boolean }).idempotent, true);
  const challengeUses = await adminPool.query<{ use_count: number }>(
    "SELECT use_count FROM group_invites WHERE id = $1",
    [challengeInviteId],
  );
  assert.equal(challengeUses.rows[0]?.use_count, 1, "replay não consome outro uso");

  const revokedInvite = await call("POST", `/api/groups/${groupId}/invites`, {
    session: owner,
    body: { expiresInDays: 7, maxUses: 1, challengeId },
  });
  assert.equal(revokedInvite.response.status, 201, JSON.stringify(revokedInvite.body));
  await adminPool.query("UPDATE group_invites SET revoked_at = now() WHERE id = $1", [
    (revokedInvite.body as { id: string }).id,
  ]);
  const rejected = await call("POST", `/api/invites/${(revokedInvite.body as { token: string }).token}`, {
    session: revokedGuest,
    body: {},
  });
  assert.equal(rejected.response.status, 410, JSON.stringify(rejected.body));
  const partialRows = await adminPool.query<{ group_members: number; challenge_participants: number }>(
    `SELECT
       (SELECT count(*)::int FROM group_members WHERE group_id = $1 AND user_id = $2 AND removed_at IS NULL) AS group_members,
       (SELECT count(*)::int FROM challenge_participants WHERE challenge_id = $3 AND user_id = $2 AND removed_at IS NULL) AS challenge_participants`,
    [groupId, revokedGuest.user.id, challengeId],
  );
  assert.deepEqual(partialRows.rows[0], { group_members: 0, challenge_participants: 0 }, "convite inválido não deixa aceite parcial");

  const missingTarget = await call("POST", `/api/groups/${groupId}/invites`, {
    session: owner,
    body: { challengeId: "desafio-inexistente" },
  });
  assert.equal(missingTarget.response.status, 404, "alvo ausente não cria convite genérico por engano");
});

test("recusa entrar no grupo além do limite de pessoas, por username e por convite", async () => {
  const previousCap = process.env.MAX_MEMBERS_PER_GROUP;
  process.env.MAX_MEMBERS_PER_GROUP = "3";
  try {
    const owner = await register("Dona Lotada", "dona_lotada");
    const second = await register("Segunda Pessoa", "segunda_lotada");
    const third = await register("Terceira Pessoa", "terceira_lotada");
    const byUsername = await register("Quarta por Username", "quarta_lotada");
    const byInvite = await register("Quinta por Convite", "quinta_lotada");

    const groupResponse = await call("POST", "/api/groups", { session: owner, body: { name: "Grupo lotado" } });
    const groupId = (groupResponse.body as { id: string }).id;

    for (const guest of [second, third]) {
      const invited = await call("POST", `/api/groups/${groupId}/members`, {
        session: owner,
        body: { username: guest.user.username },
      });
      assert.equal(invited.response.status, 200, JSON.stringify(invited.body));
      const request = await adminPool.query<{ id: string }>(
        "SELECT id FROM group_member_requests WHERE group_id = $1 AND user_id = $2 AND status = 'pending'",
        [groupId, guest.user.id],
      );
      const acceptedGuest = await call("POST", `/api/member-requests/${request.rows[0]?.id}/accept`, {
        session: guest,
        body: {},
      });
      assert.equal(acceptedGuest.response.status, 200, JSON.stringify(acceptedGuest.body));
    }

    const overflowUsername = await call("POST", `/api/groups/${groupId}/members`, {
      session: owner,
      body: { username: byUsername.user.username },
    });
    assert.equal(overflowUsername.response.status, 403, JSON.stringify(overflowUsername.body));
    assert.equal((overflowUsername.body as { error: string }).error, "group_full");

    const invite = await call("POST", `/api/groups/${groupId}/invites`, {
      session: owner,
      body: { expiresInDays: 7, maxUses: 5 },
    });
    const overflowInvite = await call("POST", `/api/invites/${(invite.body as { token: string }).token}`, {
      session: byInvite,
      body: {},
    });
    assert.equal(overflowInvite.response.status, 403, JSON.stringify(overflowInvite.body));
    assert.equal((overflowInvite.body as { error: string }).error, "group_full");

    const settled = await adminPool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM group_members WHERE group_id = $1 AND removed_at IS NULL",
      [groupId],
    );
    assert.equal(settled.rows[0]?.count, 3, "o grupo para exatamente no limite");
    const inviteUse = await adminPool.query<{ use_count: number }>(
      "SELECT use_count FROM group_invites WHERE id = $1",
      [(invite.body as { id: string }).id],
    );
    assert.equal(inviteUse.rows[0]?.use_count, 0, "aceite recusado não consome o convite");
  } finally {
    if (previousCap === undefined) delete process.env.MAX_MEMBERS_PER_GROUP;
    else process.env.MAX_MEMBERS_PER_GROUP = previousCap;
  }
});

test("limita quantos grupos uma conta pode participar, por aceite e por link", async () => {
  const previousCap = process.env.MAX_GROUPS_PER_MEMBER;
  process.env.MAX_GROUPS_PER_MEMBER = "1";
  try {
    const joiner = await register("Colecionador de Grupos", "colecionador_grupos");
    const hostA = await register("Anfitriã A", "anfitria_a_limite");
    const hostB = await register("Anfitrião B", "anfitriao_b_limite");

    const ownGroup = await call("POST", "/api/groups", { session: joiner, body: { name: "Meu único grupo" } });
    assert.equal(ownGroup.response.status, 201, JSON.stringify(ownGroup.body));

    const groupA = (await call("POST", "/api/groups", { session: hostA, body: { name: "Grupo A" } })).body as { id: string };
    await call("POST", `/api/groups/${groupA.id}/members`, { session: hostA, body: { username: joiner.user.username } });
    const requestA = await adminPool.query<{ id: string }>(
      "SELECT id FROM group_member_requests WHERE group_id = $1 AND user_id = $2 AND status = 'pending'",
      [groupA.id, joiner.user.id],
    );
    const acceptOverLimit = await call("POST", `/api/member-requests/${requestA.rows[0]?.id}/accept`, {
      session: joiner,
      body: {},
    });
    assert.equal(acceptOverLimit.response.status, 403, JSON.stringify(acceptOverLimit.body));
    assert.equal((acceptOverLimit.body as { error: string }).error, "group_membership_limit");

    const groupB = (await call("POST", "/api/groups", { session: hostB, body: { name: "Grupo B" } })).body as { id: string };
    const linkB = await call("POST", `/api/groups/${groupB.id}/invites`, { session: hostB, body: { expiresInDays: 7, maxUses: 1 } });
    const linkOverLimit = await call("POST", `/api/invites/${(linkB.body as { token: string }).token}`, {
      session: joiner,
      body: {},
    });
    assert.equal(linkOverLimit.response.status, 403, JSON.stringify(linkOverLimit.body));
    assert.equal((linkOverLimit.body as { error: string }).error, "group_membership_limit");
  } finally {
    if (previousCap === undefined) delete process.env.MAX_GROUPS_PER_MEMBER;
    else process.env.MAX_GROUPS_PER_MEMBER = previousCap;
  }
});

test("modelos públicos: publica, lista, detalha sem sessão e duplica para um grupo", async () => {
  const admin = await register("Curadora", "curadora_modelos");
  await adminPool.query("UPDATE users SET platform_admin = true WHERE id = $1", [admin.user.id]);
  const adminSession = await login("curadora_modelos");
  const stranger = await register("Estranho", "estranho_modelos");

  const group = await call("POST", "/api/groups", { session: adminSession, body: { name: "Vitrine" } });
  const groupId = (group.body as { id: string }).id;
  const challenge = await call("POST", `/api/groups/${groupId}/challenges`, {
    session: adminSession,
    body: {
      title: "Cine clube do mês", description: "Um cine clube pronto para começar.",
      startsOn: "2026-09-01", endsOn: "2026-09-30", submissionMode: "item",
      participantIds: [admin.user.id], items: [{ title: "Filme 1" }, { title: "Filme 2" }],
      fields: [{ key: "nota", label: "Nota", type: "rating", required: true }],
    },
  });
  assert.equal(challenge.response.status, 201, JSON.stringify(challenge.body));
  const challengeId = (challenge.body as { id: string }).id;

  const refusedPublish = await call("POST", `/api/challenges/${challengeId}/template`, {
    session: stranger,
    body: {},
  });
  assert.equal(refusedPublish.response.status, 403, "quem não é platform admin não publica modelos");

  // Even an admin OF THE CHALLENGE, if not a platform admin, cannot touch the gallery.
  const challengeAdmin = await register("Admin do Desafio", "admin_desafio_modelo");
  const adminInvite = (await call("POST", `/api/groups/${groupId}/invites`, { session: adminSession, body: { expiresInDays: 7, maxUses: 1 } })).body as { token: string };
  await call("POST", `/api/invites/${adminInvite.token}`, { session: challengeAdmin, body: {} });
  await call("PATCH", `/api/groups/${groupId}/members/${challengeAdmin.user.id}`, { session: adminSession, body: { role: "admin" } });
  const refusedByChallengeAdmin = await call("POST", `/api/challenges/${challengeId}/template`, {
    session: challengeAdmin, body: {},
  });
  assert.equal(refusedByChallengeAdmin.response.status, 403, "admin do desafio sem ser admin da plataforma não publica modelo");

  const published = await call("POST", `/api/challenges/${challengeId}/template`, {
    session: adminSession,
    body: {},
  });
  assert.equal(published.response.status, 200, JSON.stringify(published.body));
  assert.equal((published.body as { publishedAsTemplate: boolean }).publishedAsTemplate, true);

  const gallery = await call("GET", "/api/templates");
  assert.equal(gallery.response.status, 200);
  const listed = (gallery.body as { templates: Array<{ id: string; summary: string; itemCount: number; participantCount: number }> }).templates;
  const mine = listed.find((entry) => entry.id === challengeId);
  assert.ok(mine, "o modelo publicado aparece na galeria pública");
  assert.equal(typeof mine?.participantCount, "number", "a galeria diz quantas pessoas participam — só o número");
  assert.ok((mine?.participantCount ?? 0) >= 1);
  // Sem vitrine ainda: a chamada da galeria cai na descrição do desafio.
  assert.equal(mine?.summary, "Um cine clube pronto para começar.");
  assert.equal(mine?.itemCount, 2);

  const detail = await call("GET", `/api/templates/${challengeId}`);
  assert.equal(detail.response.status, 200, JSON.stringify(detail.body));
  const detailBody = detail.body as Record<string, unknown>;
  assert.equal(detailBody.title, "Cine clube do mês");
  assert.ok(Array.isArray(detailBody.fields) && (detailBody.fields as unknown[]).length === 1);
  // The preview is a read-only ChallengeDetail — never the origin group's members,
  // and the Results tab is empty until the origin publishes its showcase.
  assert.deepEqual(detailBody.participants, [], "o detalhe público nunca lista participantes");
  assert.equal(detailBody.result, null, "sem vitrine publicada, o Resultado vem vazio");
  assert.equal(detailBody.isParticipant, false);

  const strangerGroup = await call("POST", "/api/groups", { session: stranger, body: { name: "Meu grupo" } });
  const strangerGroupId = (strangerGroup.body as { id: string }).id;
  const copied = await call("POST", `/api/templates/${challengeId}/duplicate`, {
    session: stranger,
    body: { targetGroupId: strangerGroupId },
  });
  assert.equal(copied.response.status, 201, JSON.stringify(copied.body));
  const copyId = (copied.body as { challengeId: string }).challengeId;
  assert.notEqual(copyId, challengeId);
  const copyRow = await adminPool.query<{ group_id: string; status: string; published_as_template_at: Date | null }>(
    "SELECT group_id, status, published_as_template_at FROM challenges WHERE id = $1",
    [copyId],
  );
  assert.equal(copyRow.rows[0]?.group_id, strangerGroupId);
  assert.equal(copyRow.rows[0]?.status, "draft");
  assert.equal(copyRow.rows[0]?.published_as_template_at, null, "a cópia não herda a flag de modelo");

  const copyItems = await adminPool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM challenge_items WHERE challenge_id = $1 AND archived_at IS NULL",
    [copyId],
  );
  assert.equal(copyItems.rows[0]?.count, 2, "a estrutura foi copiada");

  const notMyGroup = await call("POST", `/api/templates/${challengeId}/duplicate`, {
    session: stranger,
    body: { targetGroupId: groupId },
  });
  assert.equal(notMyGroup.response.status, 404, "não dá para duplicar num grupo que você não administra");

  const unpublished = await call("DELETE", `/api/challenges/${challengeId}/template`, { session: adminSession });
  assert.equal(unpublished.response.status, 200, JSON.stringify(unpublished.body));
  const galleryAfter = await call("GET", "/api/templates");
  assert.ok(
    !(galleryAfter.body as { templates: Array<{ id: string }> }).templates.some((entry) => entry.id === challengeId),
    "modelo despublicado sai da galeria",
  );
  assert.equal((await call("GET", `/api/templates/${challengeId}`)).response.status, 404);
});

test("modelo mostra a vitrine curada ao vivo, mesmo sem nunca ligar a publicação de resultados", async () => {
  const admin = await register("Curadora Vitrine Modelo", "curadora_vitrine_modelo_live");
  await adminPool.query("UPDATE users SET platform_admin = true WHERE id = $1", [admin.user.id]);
  const adminSession = await login("curadora_vitrine_modelo_live");
  const groupId = ((await call("POST", "/api/groups", { session: adminSession, body: { name: "Sala do modelo ao vivo" } })).body as { id: string }).id;
  const challenge = await call("POST", `/api/groups/${groupId}/challenges`, {
    session: adminSession,
    body: {
      recipe: "cinema", title: "Modelo ao vivo", startsOn: "2026-01-01", endsOn: "2026-01-31", submissionMode: "item",
      participantIds: [admin.user.id], items: [{ title: "Filme Único" }],
      fields: [{ key: "nota", label: "Nota", type: "rating", required: true }],
    },
  });
  const challengeId = (challenge.body as { id: string }).id;
  assert.equal((await call("POST", `/api/challenges/${challengeId}/template`, { session: adminSession, body: {} })).response.status, 200);

  // Nada foi curado ainda, e a publicação de resultados nunca foi ligada.
  const beforeClose = (await call("GET", `/api/templates/${challengeId}`)).body as { status: string; result: unknown };
  assert.equal(beforeClose.result, null, "sem desafio encerrado, ainda não há vitrine");

  const detail = (await call("GET", `/api/challenges/${challengeId}`, { session: adminSession })).body as {
    entryTypes: Array<{ id: string; purpose: string; fields: Array<{ id: string; key: string }> }>; items: Array<{ id: string }>;
  };
  const rating = detail.entryTypes.find((t) => t.purpose === "rating")!;
  const nota = rating.fields.find((f) => f.key === "nota")!.id;
  await call("POST", `/api/challenges/${challengeId}/transition`, { session: adminSession, body: { status: "active" } });
  await call("POST", `/api/challenges/${challengeId}/entries`, { session: adminSession, body: { itemId: detail.items[0].id, entryTypeId: rating.id, values: { [nota]: 5 } } });
  await call("POST", `/api/challenges/${challengeId}/transition`, { session: adminSession, body: { status: "closed" } });

  // Curou a vitrine (sem nunca chamar /results/publish) — o modelo já mostra.
  const withHeadline = await call("POST", `/api/challenges/${challengeId}/results`, {
    session: adminSession, body: { headline: "Uma retrospectiva e tanto", summary: "x", metricIds: [], comments: [] },
  });
  assert.equal(withHeadline.response.status, 200, JSON.stringify(withHeadline.body));
  const afterSave = (await call("GET", `/api/templates/${challengeId}`)).body as { result: { headline: string | null } };
  assert.equal(afterSave.result?.headline, "Uma retrospectiva e tanto", "o modelo mostra a curadoria imediatamente, sem publicar resultados");

  // Editar de novo atualiza o modelo de novo, sem nenhum passo extra.
  await call("POST", `/api/challenges/${challengeId}/results`, {
    session: adminSession, body: { headline: "Segunda versão da manchete", summary: "x", metricIds: [], comments: [] },
  });
  const afterSecondSave = (await call("GET", `/api/templates/${challengeId}`)).body as { result: { headline: string | null } };
  assert.equal(afterSecondSave.result?.headline, "Segunda versão da manchete", "a segunda edição também aparece imediatamente");

  // O gabarito de resultados (results_published_at) nunca foi ligado.
  const row = await adminPool.query<{ results_published_at: Date | null }>(
    "SELECT results_published_at FROM challenges WHERE id = $1", [challengeId],
  );
  assert.equal(row.rows[0]?.results_published_at, null, "a publicação de resultados nunca precisou ser ligada");
});

test("apagar um desafio publicado como modelo despublica o modelo junto, sem bloquear a exclusão", async () => {
  const admin = await register("Curador Exclusão", "curador_exclusao_modelo");
  await adminPool.query("UPDATE users SET platform_admin = true WHERE id = $1", [admin.user.id]);
  const adminSession = await login("curador_exclusao_modelo");
  const groupId = ((await call("POST", "/api/groups", { session: adminSession, body: { name: "Sala do modelo" } })).body as { id: string }).id;

  const challenge = await call("POST", `/api/groups/${groupId}/challenges`, {
    session: adminSession,
    body: {
      title: "Modelo a ser apagado", startsOn: "2026-09-01", endsOn: "2026-09-30", submissionMode: "item",
      participantIds: [admin.user.id], items: [{ title: "Filme 1" }],
      fields: [{ key: "nota", label: "Nota", type: "rating", required: true }],
    },
  });
  const challengeId = (challenge.body as { id: string }).id;
  assert.equal((await call("POST", `/api/challenges/${challengeId}/template`, { session: adminSession, body: {} })).response.status, 200);

  const deleted = await call("DELETE", `/api/challenges/${challengeId}`, { session: adminSession });
  assert.equal(deleted.response.status, 200, JSON.stringify(deleted.body));

  const gallery = await call("GET", "/api/templates");
  assert.ok(
    !(gallery.body as { templates: Array<{ id: string }> }).templates.some((entry) => entry.id === challengeId),
    "o modelo some da galeria junto com a exclusão do desafio",
  );

  const row = await adminPool.query<{ published_as_template_at: Date | null; deleted_at: Date | null }>(
    "SELECT published_as_template_at, deleted_at FROM challenges WHERE id = $1", [challengeId],
  );
  assert.equal(row.rows[0]?.published_as_template_at, null, "a flag de modelo foi limpa");
  assert.ok(row.rows[0]?.deleted_at, "o desafio foi mesmo para a lixeira");

  const audit = await adminPool.query<{ action: string }>(
    "SELECT action FROM audit_events WHERE entity_type='challenge' AND entity_id=$1 ORDER BY created_at", [challengeId],
  );
  const actions = audit.rows.map((r) => r.action);
  assert.ok(actions.includes("challenge.template_unpublished"), "a despublicação automática fica na auditoria");
  assert.ok(actions.includes("challenge.deleted"), "a exclusão fica na auditoria");
});

test("modelo com vitrine publicada: o Resultado do preview traz a retrospectiva congelada, sem nomes reais", async () => {
  const admin = await register("Curador Vitrine", "curador_vitrine_modelo");
  await adminPool.query("UPDATE users SET platform_admin = true WHERE id = $1", [admin.user.id]);
  const adminSession = await login("curador_vitrine_modelo");
  const bea = await register("Beatriz Vitrine", "beatriz_vitrine_modelo");
  const groupId = ((await call("POST", "/api/groups", { session: adminSession, body: { name: "Sala" } })).body as { id: string }).id;
  const invite = (await call("POST", `/api/groups/${groupId}/invites`, { session: adminSession, body: { expiresInDays: 7, maxUses: 5 } })).body as { token: string };
  await call("POST", `/api/invites/${invite.token}`, { session: bea, body: {} });

  const challenge = await call("POST", `/api/groups/${groupId}/challenges`, {
    session: adminSession,
    body: {
      title: "Ciclo com resultado", startsOn: "2026-01-05", endsOn: "2026-01-19", submissionMode: "item",
      participantIds: [admin.user.id, bea.user.id], items: [{ title: "Filme Único" }],
      fields: [{ key: "nota", label: "Nota", type: "rating", required: true }],
    },
  });
  const challengeId = (challenge.body as { id: string }).id;
  const detail = (await call("GET", `/api/challenges/${challengeId}`, { session: adminSession })).body as {
    items: Array<{ id: string }>; entryTypes: Array<{ id: string; fields: Array<{ id: string; type: string }> }>;
  };
  const typeId = detail.entryTypes[0].id;
  const notaField = detail.entryTypes[0].fields.find((field) => field.type === "rating")!.id;
  await call("POST", `/api/challenges/${challengeId}/transition`, { session: adminSession, body: { status: "active" } });
  for (const [session, value] of [[adminSession, 5], [bea, 3]] as const) {
    await call("POST", `/api/challenges/${challengeId}/entries`, {
      session, body: { itemId: detail.items[0].id, entryTypeId: typeId, values: { [notaField]: value } },
    });
  }
  await call("POST", `/api/challenges/${challengeId}/transition`, { session: adminSession, body: { status: "closed" } });
  await call("POST", `/api/challenges/${challengeId}/results`, {
    session: adminSession, body: { metricIds: [], comments: [], anonymizeParticipants: true },
  });
  await call("POST", `/api/challenges/${challengeId}/results/publish`, { session: adminSession, body: {} });
  await call("POST", `/api/challenges/${challengeId}/template`, { session: adminSession, body: { summary: "Pronto." } });

  const preview = (await call("GET", `/api/templates/${challengeId}`)).body as {
    result: { blocks?: unknown[]; metrics?: unknown[] } | null;
    participants: unknown[];
  };
  assert.deepEqual(preview.participants, []);
  assert.ok(preview.result, "o preview traz a vitrine publicada");
  assert.ok(
    (preview.result.blocks?.length ?? 0) > 0 || (preview.result.metrics?.length ?? 0) > 0,
    "com métricas/blocos congelados",
  );
  assert.doesNotMatch(JSON.stringify(preview.result), /Beatriz Vitrine|Curador Vitrine/, "sem nomes reais");
});

test("copiar um desafio carrega as semanas, a distribuição dos itens e a duração dos filmes", async () => {
  const owner = await register("Dona Cópia", "dona_copia_cronograma");
  const sourceGroup = ((await call("POST", "/api/groups", { session: owner, body: { name: "Origem" } })).body as { id: string }).id;
  const targetGroup = ((await call("POST", "/api/groups", { session: owner, body: { name: "Destino" } })).body as { id: string }).id;
  const challenge = await call("POST", `/api/groups/${sourceGroup}/challenges`, {
    session: owner,
    body: {
      recipe: "cinema", title: "Ciclo em 3 semanas", startsOn: "2026-03-02", endsOn: "2026-03-22",
      participantIds: [owner.user.id],
      items: [
        { title: "Filme A", year: 2020, runtimeMinutes: 110 },
        { title: "Filme B", year: 2021, runtimeMinutes: 95 },
        { title: "Filme C", year: 2019, runtimeMinutes: 130 },
      ],
    },
  });
  const sourceId = (challenge.body as { id: string }).id;
  const cps = await call("POST", `/api/challenges/${sourceId}/checkpoints`, {
    session: owner,
    body: { checkpoints: [
      { title: "Semana 1", kind: "week", startsAt: "2026-03-02", dueAt: "2026-03-08" },
      { title: "Semana 2", kind: "week", startsAt: "2026-03-09", dueAt: "2026-03-15" },
    ] },
  });
  const [w1, w2] = (cps.body as { checkpoints: Array<{ id: string }> }).checkpoints.map((cp) => cp.id);
  const srcDetail = (await call("GET", `/api/challenges/${sourceId}`, { session: owner })).body as {
    items: Array<{ id: string; title: string }>;
  };
  const byTitle = new Map(srcDetail.items.map((item) => [item.title, item.id]));
  await call("POST", `/api/challenges/${sourceId}/items/assign`, {
    session: owner,
    body: { assignments: [
      { itemId: byTitle.get("Filme A"), checkpointId: w1 },
      { itemId: byTitle.get("Filme B"), checkpointId: w1 },
      { itemId: byTitle.get("Filme C"), checkpointId: w2 },
    ] },
  });

  const copied = await call("POST", `/api/challenges/${sourceId}/duplicate`, {
    session: owner, body: { targetGroupId: targetGroup, title: "Ciclo copiado" },
  });
  assert.equal(copied.response.status, 201, JSON.stringify(copied.body));
  const copyId = (copied.body as { challengeId: string }).challengeId;

  const copyDetail = (await call("GET", `/api/challenges/${copyId}`, { session: owner })).body as {
    startsOn: string | null; endsOn: string | null;
    items: Array<{ id: string; title: string; checkpointId: string | null; catalogItem: { runtimeMinutes: number | null } | null }>;
    checkpoints: Array<{ id: string; title: string; kind: string; itemCount: number; totalRuntimeMinutes: number | null }>;
  };
  // As datas não vêm junto — a cópia nasce sem período.
  assert.equal(copyDetail.startsOn, null);
  assert.equal(copyDetail.endsOn, null);
  // Mas as semanas e a distribuição sim.
  assert.deepEqual(copyDetail.checkpoints.map((cp) => cp.title), ["Semana 1", "Semana 2"]);
  assert.equal(copyDetail.checkpoints.every((cp) => cp.kind === "week"), true);
  const copyW1 = copyDetail.checkpoints.find((cp) => cp.title === "Semana 1")!;
  const copyW2 = copyDetail.checkpoints.find((cp) => cp.title === "Semana 2")!;
  assert.equal(copyW1.itemCount, 2, "Semana 1 mantém os dois filmes");
  assert.equal(copyW2.itemCount, 1, "Semana 2 mantém um filme");
  const copyA = copyDetail.items.find((item) => item.title === "Filme A")!;
  assert.equal(copyA.checkpointId, copyW1.id, "o filme aponta para a semana copiada");
  assert.equal(copyA.catalogItem?.runtimeMinutes, 110, "a duração do filme veio junto");
  assert.equal(copyW1.totalRuntimeMinutes, 205, "e o total da semana soma as durações copiadas");

  // O detalhe público do modelo mostra o cronograma.
  await adminPool.query("UPDATE users SET platform_admin = true WHERE id = $1", [owner.user.id]);
  await call("POST", `/api/challenges/${sourceId}/template`, { session: await login("dona_copia_cronograma"), body: {} });
  const tmpl = (await call("GET", `/api/templates/${sourceId}`)).body as {
    checkpoints: Array<{ title: string; kind: string }>; items: Array<{ title: string }>;
  };
  assert.deepEqual(tmpl.checkpoints.map((cp) => cp.title), ["Semana 1", "Semana 2"]);
  assert.equal(tmpl.items.length, 3);
});

test("o cronograma pode ser escondido da página de resultado sem apagar os checkpoints", async () => {
  const owner = await register("Dona Cronograma Oculto", "dona_crono_oculto");
  const groupId = ((await call("POST", "/api/groups", { session: owner, body: { name: "Ciclo" } })).body as { id: string }).id;
  const challengeId = ((await call("POST", `/api/groups/${groupId}/challenges`, {
    session: owner,
    body: {
      recipe: "cinema", title: "Ciclo com semanas", startsOn: "2026-03-02", endsOn: "2026-03-22",
      participantIds: [owner.user.id], items: [{ title: "Filme A", year: 2020 }, { title: "Filme B", year: 2021 }],
    },
  })).body as { id: string }).id;
  await call("POST", `/api/challenges/${challengeId}/checkpoints`, {
    session: owner,
    body: { checkpoints: [
      { title: "Semana 1", kind: "week", startsAt: "2026-03-02", dueAt: "2026-03-08" },
      { title: "Semana 2", kind: "week", startsAt: "2026-03-09", dueAt: "2026-03-15" },
    ] },
  });
  await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "active" } });
  await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "closed" } });

  const before = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as { showSchedule: boolean; checkpoints: unknown[] };
  assert.equal(before.showSchedule, true, "mostra por padrão");
  assert.equal(before.checkpoints.length, 2);

  assert.equal((await call("POST", `/api/challenges/${challengeId}/results`, { session: owner, body: { showSchedule: false } })).response.status, 200);
  const hidden = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as { showSchedule: boolean; checkpoints: unknown[] };
  assert.equal(hidden.showSchedule, false, "escondido depois de desmarcar");
  assert.equal(hidden.checkpoints.length, 2, "os checkpoints continuam existindo");

  assert.equal((await call("POST", `/api/challenges/${challengeId}/results`, { session: owner, body: { showSchedule: true } })).response.status, 200);
  assert.equal(((await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as { showSchedule: boolean }).showSchedule, true, "volta a mostrar");
});

test("aplica limites de criação por dono e por grupo", async () => {
  const owner = await register("Limite", "limite_dono");

  const groupIds: string[] = [];
  for (let index = 0; index < 6; index += 1) {
    const created = await call("POST", "/api/groups", { session: owner, body: { name: `Grupo ${index + 1}` } });
    assert.equal(created.response.status, 201, JSON.stringify(created.body));
    groupIds.push((created.body as { id: string }).id);
  }

  const overflowGroup = await call("POST", "/api/groups", { session: owner, body: { name: "Grupo 7" } });
  assert.equal(overflowGroup.response.status, 403, "o 7º grupo do mesmo dono deve ser recusado");
  assert.equal((overflowGroup.body as { error: string }).error, "group_limit");

  const groupId = groupIds[0];
  const challengeBody = (title: string) => ({
    title, startsOn: "2026-09-01", endsOn: "2026-09-30", submissionMode: "item",
    participantIds: [owner.user.id], items: [{ title: "Item único" }],
    fields: [{ key: "nota", label: "Nota", type: "rating", required: true }],
  });
  for (let index = 0; index < 6; index += 1) {
    const created = await call("POST", `/api/groups/${groupId}/challenges`, {
      session: owner, body: challengeBody(`Desafio ${index + 1}`),
    });
    assert.equal(created.response.status, 201, JSON.stringify(created.body));
  }

  const overflowChallenge = await call("POST", `/api/groups/${groupId}/challenges`, {
    session: owner, body: challengeBody("Desafio 7"),
  });
  assert.equal(overflowChallenge.response.status, 403, "o 7º desafio do mesmo grupo deve ser recusado");
  assert.equal((overflowChallenge.body as { error: string }).error, "challenge_limit");

  const copySource = await call("POST", `/api/groups/${groupIds[1]}/challenges`, {
    session: owner,
    body: challengeBody("Modelo para copiar"),
  });
  assert.equal(copySource.response.status, 201, JSON.stringify(copySource.body));
  const overflowCopy = await call("POST", `/api/challenges/${(copySource.body as { id: string }).id}/duplicate`, {
    session: owner,
    body: { title: "Não cabe no destino", targetGroupId: groupId },
  });
  assert.equal(overflowCopy.response.status, 403, "a cópia também respeita o limite do grupo de destino");
  assert.equal((overflowCopy.body as { error: string }).error, "challenge_limit");
  const fullGroupCount = await adminPool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM challenges WHERE group_id=$1 AND deleted_at IS NULL",
    [groupId],
  );
  assert.equal(fullGroupCount.rows[0]?.count, 6, "falha de limite não deixa cópia parcial");

  // A binned group keeps its slot — the bin never expires (ROADMAP §13).
  assert.equal((await call("DELETE", `/api/groups/${groupIds[5]}`, { session: owner })).response.status, 200);
  const stillCapped = await call("POST", "/api/groups", { session: owner, body: { name: "Ainda cheio" } });
  assert.equal(stillCapped.response.status, 403, "grupo na lixeira continua ocupando a vaga");

  const bootstrapAfter = await call("GET", "/api/bootstrap", { session: owner });
  const visibleGroups = (bootstrapAfter.body as { groups: Array<{ id: string }> }).groups.map((group) => group.id);
  assert.ok(!visibleGroups.includes(groupIds[5]), "grupo na lixeira não aparece no bootstrap");

  // Permanently deleting it frees the slot.
  const preview = await call("POST", "/api/personal/trash/preview", { session: owner, body: { kind: "group", id: groupIds[5] } });
  assert.equal(preview.response.status, 200, JSON.stringify(preview.body));
  const purge = await call("POST", "/api/personal/trash/purge", {
    session: owner, body: { kind: "group", id: groupIds[5], confirmation: "Grupo 6" },
  });
  assert.equal(purge.response.status, 200, JSON.stringify(purge.body));
  const afterPurge = await call("POST", "/api/groups", { session: owner, body: { name: "Grupo pós-purga" } });
  assert.equal(afterPurge.response.status, 201, "exclusão permanente libera a vaga");
});

test("soft-delete de grupo e desafio pelos endpoints DELETE", async () => {
  const owner = await register("Dono Lixeira", "dono_lixeira");
  const stranger = await register("Estranho", "estranho_lixeira");

  const group = await call("POST", "/api/groups", { session: owner, body: { name: "Grupo descartável" } });
  const groupId = (group.body as { id: string }).id;

  const challenge = await call("POST", `/api/groups/${groupId}/challenges`, {
    session: owner,
    body: {
      title: "Desafio descartável", startsOn: "2026-09-01", endsOn: "2026-09-30", submissionMode: "item",
      participantIds: [owner.user.id], items: [{ title: "Único" }],
      fields: [{ key: "nota", label: "Nota", type: "rating", required: true }],
    },
  });
  const challengeId = (challenge.body as { id: string }).id;

  assert.equal((await call("DELETE", `/api/challenges/${challengeId}`, { session: stranger })).response.status, 404, "estranho não descobre o desafio");
  const deleteChallenge = await call("DELETE", `/api/challenges/${challengeId}`, { session: owner });
  assert.equal(deleteChallenge.response.status, 200, JSON.stringify(deleteChallenge.body));
  assert.equal((await call("GET", `/api/challenges/${challengeId}`, { session: owner })).response.status, 404, "desafio na lixeira responde 404");

  assert.equal((await call("DELETE", `/api/groups/${groupId}`, { session: stranger })).response.status, 404, "estranho não descobre o grupo");
  const deleteGroup = await call("DELETE", `/api/groups/${groupId}`, { session: owner });
  assert.equal(deleteGroup.response.status, 200, JSON.stringify(deleteGroup.body));
  assert.equal((await call("DELETE", `/api/groups/${groupId}`, { session: owner })).response.status, 404, "apagar duas vezes é 404");

  const auditRows = await adminPool.query<{ action: string }>(
    "SELECT action FROM audit_events WHERE group_id = $1 ORDER BY created_at",
    [groupId],
  );
  const actions = auditRows.rows.map((row) => row.action);
  assert.ok(actions.includes("challenge.deleted"), "auditoria registra challenge.deleted");
  assert.ok(actions.includes("group.deleted"), "auditoria registra group.deleted");
});

test("área de administração: acesso, painel agregado e contas (sem lixeira global)", async () => {
  const admin = await register("Plataforma", "plataforma_admin");
  const member = await register("Membro Comum", "membro_comum_admin");
  await adminPool.query("UPDATE users SET platform_admin = true WHERE id = $1", [admin.user.id]);
  // re-login so the session row reflects platform_admin
  const adminSession = await login("plataforma_admin");

  assert.equal((await call("GET", "/api/admin/overview", { session: member })).response.status, 404, "não-admin recebe 404");
  assert.equal((await call("GET", "/api/admin/overview")).response.status, 404, "anônimo recebe 404");

  const overview = await call("GET", "/api/admin/overview", { session: adminSession });
  assert.equal(overview.response.status, 200, JSON.stringify(overview.body));
  const overviewBody = overview.body as { users: { total: number }; storage: { tables: unknown[] } };
  assert.ok(overviewBody.users.total >= 2);
  assert.ok(Array.isArray(overviewBody.storage.tables) && overviewBody.storage.tables.length > 0);

  assert.equal((await call("GET", "/api/admin/users", { session: adminSession })).response.status, 200);
  assert.equal((await call("GET", "/api/admin/audit", { session: adminSession })).response.status, 200);

  // The platform admin has NO global bin — not the list, not purge (ROADMAP §14).
  assert.equal((await call("GET", "/api/admin/trash", { session: adminSession })).response.status, 404, "sem lixeira global no /admin");
  assert.equal(
    (await call("POST", "/api/admin/trash/purge", { session: adminSession, body: { kind: "group", id: "x" } })).response.status,
    404,
    "sem purge de conteúdo de terceiros pelo /admin",
  );

  // The owner runs the bin themselves: bin → it counts in the overview → purge.
  const group = await call("POST", "/api/groups", { session: member, body: { name: "Para purgar" } });
  const groupId = (group.body as { id: string }).id;
  await call("DELETE", `/api/groups/${groupId}`, { session: member });
  const withTrash = await call("GET", "/api/admin/overview", { session: adminSession });
  assert.ok((withTrash.body as { groups: { trashed: number } }).groups.trashed >= 1, "o painel conta grupos na lixeira em agregado");
  const purge = await call("POST", "/api/personal/trash/purge", {
    session: member, body: { kind: "group", id: groupId, confirmation: "Para purgar" },
  });
  assert.equal(purge.response.status, 200, JSON.stringify(purge.body));
  const stillThere = await adminPool.query("SELECT 1 FROM groups WHERE id = $1", [groupId]);
  assert.equal(stillThere.rowCount, 0, "purge remove a linha do grupo de vez");

  // disable a member -> its sessions die and it cannot log back in
  const disable = await call("POST", "/api/admin/users/disable", { session: adminSession, body: { userId: member.user.id, disabled: true } });
  assert.equal(disable.response.status, 200, JSON.stringify(disable.body));
  assert.ok((disable.body as { sessionsRevoked: number }).sessionsRevoked >= 1, "desativar revoga as sessões");
  const blockedLogin = await call("POST", "/api/auth/login", { body: { username: "membro_comum_admin", password: "uma senha segura 123" } });
  assert.equal(blockedLogin.response.status, 401, "conta desativada não faz login");

  const selfDisable = await call("POST", "/api/admin/users/disable", { session: adminSession, body: { userId: admin.user.id, disabled: true } });
  assert.equal(selfDisable.response.status, 400, "admin não desativa a própria conta");
});

test("e-mail, login por e-mail e edição de conta", async () => {
  const admin = await register("Suporte", "suporte_admin");
  await adminPool.query("UPDATE users SET platform_admin = true WHERE id = $1", [admin.user.id]);
  const adminSession = await login("suporte_admin");

  // register carries the e-mail through
  const created = await call("POST", "/api/auth/register", {
    body: { name: "Carla", username: "carla_email", password: "uma senha segura 123", email: "Carla@Example.com" },
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  assert.equal((created.body as { user: { email: string } }).user.email, "Carla@Example.com");

  // a second account cannot claim the same e-mail
  const dupe = await call("POST", "/api/auth/register", {
    body: { name: "Outra", username: "outra_email", password: "uma senha segura 123", email: "carla@example.com" },
  });
  assert.equal(dupe.response.status, 409, JSON.stringify(dupe.body));
  assert.equal((dupe.body as { error: string }).error, "email_taken");

  // login works by e-mail (case-insensitive) and by username
  assert.equal((await call("POST", "/api/auth/login", { body: { username: "CARLA@example.com", password: "uma senha segura 123" } })).response.status, 200, "login por e-mail");
  const relog = await call("POST", "/api/auth/login", { body: { username: "carla_email", password: "uma senha segura 123" } });
  assert.equal(relog.response.status, 200, "login por usuário");

  // Self-service password reset is withdrawn until there is an e-mail channel to
  // deliver the link (ROADMAP §1). The routes simply do not exist.
  assert.equal((await call("POST", "/api/auth/forgot", { body: { email: "carla@example.com" } })).response.status, 404, "sem rota de 'esqueci a senha'");
  assert.equal((await call("POST", "/api/auth/reset", { body: { token: "x".repeat(43), password: "nova senha bem forte 9" } })).response.status, 404, "sem rota de redefinição");
  const users = await call("GET", "/api/admin/users", { session: adminSession });
  assert.ok(
    !("pendingReset" in ((users.body as { users: Array<Record<string, unknown>> }).users[0] ?? {})),
    "o painel não expõe mais um indicador de reset pendente",
  );

  const carla: ClientSession = {
    cookie: (relog.response.headers.get("set-cookie") ?? "").split(";", 1)[0],
    csrf: (relog.body as { csrfToken: string }).csrfToken,
    user: (relog.body as { user: ClientSession["user"] }).user,
  };

  // perfil: só o nome é editável; e-mail e usuário ficam bloqueados por enquanto
  const nameOnly = await call("PATCH", "/api/account", { session: carla, body: { name: "Carla Editada" } });
  assert.equal(nameOnly.response.status, 200, JSON.stringify(nameOnly.body));
  assert.equal((nameOnly.body as { user: { name: string } }).user.name, "Carla Editada");
  assert.equal((await call("PATCH", "/api/account", { session: carla, body: { email: "x@example.com" } })).response.status, 403, "e-mail bloqueado");
  assert.equal((await call("PATCH", "/api/account", { session: carla, body: { username: "carla2" } })).response.status, 403, "usuário bloqueado");

  // password change requires the current password
  assert.equal((await call("PATCH", "/api/account", { session: carla, body: { currentPassword: "errada", newPassword: "mais uma senha 12345" } })).response.status, 403);

  // admin promove e rebaixa outra conta pela API
  async function carlaSession(): Promise<ClientSession> {
    const r = await call("POST", "/api/auth/login", { body: { username: "carla_email", password: "uma senha segura 123" } });
    assert.equal(r.response.status, 200, JSON.stringify(r.body));
    return { cookie: (r.response.headers.get("set-cookie") ?? "").split(";", 1)[0], csrf: (r.body as { csrfToken: string }).csrfToken, user: (r.body as { user: ClientSession["user"] }).user };
  }
  assert.equal((await call("GET", "/api/admin/overview", { session: await carlaSession() })).response.status, 404, "sem promoção: 404");
  const promote = await call("POST", "/api/admin/users/set-admin", { session: adminSession, body: { userId: carla.user.id, platformAdmin: true } });
  assert.equal(promote.response.status, 200, JSON.stringify(promote.body));
  assert.equal((await call("GET", "/api/admin/overview", { session: await carlaSession() })).response.status, 200, "conta promovida enxerga o painel");
  assert.equal((await call("POST", "/api/admin/users/set-admin", { session: adminSession, body: { userId: admin.user.id, platformAdmin: false } })).response.status, 400, "admin não muda o próprio acesso");
  const demote = await call("POST", "/api/admin/users/set-admin", { session: adminSession, body: { userId: carla.user.id, platformAdmin: false } });
  assert.equal(demote.response.status, 200, JSON.stringify(demote.body));
  assert.equal((await call("GET", "/api/admin/overview", { session: await carlaSession() })).response.status, 404, "após rebaixar, volta a 404");
});

test("fase 0: feedback, link de reunião e remoção da própria conta", async () => {
  const host = await register("Marina", "marina_f0");
  const guest = await register("Bruno", "bruno_f0");

  // feedback: logado, deslogado e validação
  assert.equal(
    (await call("POST", "/api/feedback", { session: host, body: { area: "dashboard", goal: "ver meus desafios", impact: "minor", ease: 4 } })).response.status,
    201,
  );
  assert.equal(
    (await call("POST", "/api/feedback", { body: { area: "modelos", goal: "conhecer o app", impact: "idea" } })).response.status,
    201,
    "feedback aceita remetente deslogado",
  );
  assert.equal(
    (await call("POST", "/api/feedback", { session: host, body: { area: "x", goal: "y", impact: "explodiu" } })).response.status,
    400,
  );

  const soloGroup = await call("POST", "/api/groups", { session: host, body: { name: "Clube solo" } });
  const soloGroupId = (soloGroup.body as { id: string }).id;
  const sharedGroup = await call("POST", "/api/groups", { session: host, body: { name: "Clube com gente" } });
  const sharedGroupId = (sharedGroup.body as { id: string }).id;
  const inv = await call("POST", `/api/groups/${sharedGroupId}/invites`, { session: host, body: { expiresInDays: 7, maxUses: 1 } });
  await call("POST", `/api/invites/${(inv.body as { token: string }).token}`, { session: guest, body: {} });

  // remoção permanente da conta: exige senha; grupo solo (e o espaço pessoal) são
  // apagados de vez — nada de órfão; grupo com outra pessoa transfere a posse.
  assert.equal(
    (await call("POST", "/api/account/delete", { session: host, body: { password: "errada" } })).response.status,
    403,
    "exclusão permanente exige a senha certa",
  );
  const removed = await call("POST", "/api/account/delete", { session: host, body: { password: "uma senha segura 123" } });
  assert.equal(removed.response.status, 200, JSON.stringify(removed.body));
  assert.match(removed.response.headers.get("set-cookie") ?? "", /__Host-goa_session=;|Max-Age=0/i);
  assert.equal((await call("GET", "/api/bootstrap", { session: host })).response.status, 200);
  assert.equal(
    (await call("POST", "/api/feedback", { session: host, body: { area: "a", goal: "b", impact: "minor" } })).response.status,
    201,
    "a sessão foi revogada, mas o feedback anônimo ainda funciona",
  );
  const soloGone = await adminPool.query("SELECT 1 FROM groups WHERE id=$1", [soloGroupId]);
  assert.equal(soloGone.rowCount, 0, "grupos solo são apagados de vez ao excluir a conta");
  const personalGone = await adminPool.query("SELECT 1 FROM groups WHERE owner_user_id=$1 AND kind='personal'", [host.user.id]);
  assert.equal(personalGone.rowCount, 0, "o espaço pessoal não fica órfão");
  const sharedTransferred = await adminPool.query<{ owner_user_id: string; deleted_at: Date | null }>(
    "SELECT owner_user_id, deleted_at FROM groups WHERE id = $1",
    [sharedGroupId],
  );
  assert.equal(sharedTransferred.rows[0]?.owner_user_id, guest.user.id, "grupo com outra pessoa transfere a posse em vez de ser bloqueado");
  assert.equal(sharedTransferred.rows[0]?.deleted_at, null, "o grupo transferido continua vivo");
});

test("fase 1a: acervo do grupo, identidade do filme entre rodadas e indicador", async () => {
  const owner = await register("Clara", "clara_cat");
  const friend = await register("Dan", "dan_cat");
  const groupId = (await call("POST", "/api/groups", { session: owner, body: { name: "Cineclube" } })).body as { id: string };
  const gid = groupId.id;
  const invite = await call("POST", `/api/groups/${gid}/invites`, { session: owner, body: { expiresInDays: 7, maxUses: 1 } });
  await call("POST", `/api/invites/${(invite.body as { token: string }).token}`, { session: friend, body: {} });
  const period = { startsOn: "2026-03-01", endsOn: "2026-03-31" };

  const first = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner,
    body: {
      recipe: "cinema", title: "Rodada 1", ...period,
      participantIds: [owner.user.id, friend.user.id],
      fields: [{ key: "nota", label: "Nota", type: "rating", required: true }],
      items: [
        { title: "Aftersun", recommendedByUserId: friend.user.id, year: 2022, mainGenre: "drama" },
        { title: "  perfect days ", year: 2023 },
      ],
    },
  });
  assert.equal(first.response.status, 201, JSON.stringify(first.body));
  const firstId = (first.body as { id: string }).id;

  const catalog = await call("GET", `/api/groups/${gid}/catalog`, { session: friend });
  assert.equal(catalog.response.status, 200);
  const catalogItems = (catalog.body as { items: Array<{ id: string; title: string; year: number | null; mainGenre: string | null; roundCount: number }> }).items;
  assert.equal(catalogItems.length, 2, "dois filmes no acervo");
  const aftersun = catalogItems.find((item) => item.title === "Aftersun");
  assert.ok(aftersun);
  assert.equal(aftersun.year, 2022);
  assert.equal(aftersun.mainGenre, "drama");

  const detail = await call("GET", `/api/challenges/${firstId}`, { session: owner });
  const items = (detail.body as { items: Array<{ title: string; catalogItem: { id: string; year: number | null } | null; recommendedBy: { name: string } | null }> }).items;
  assert.equal(items[0].recommendedBy?.name, "Dan");
  assert.equal(items[0].catalogItem?.id, aftersun.id);

  // segunda rodada reusa o mesmo filme por título → mesma identidade no acervo
  const second = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner,
    body: {
      recipe: "cinema", title: "Rodada 2", ...period,
      participantIds: [owner.user.id],
      fields: [{ key: "nota", label: "Nota", type: "rating", required: true }],
      items: [{ title: "AFTERSUN" }],
    },
  });
  assert.equal(second.response.status, 201, JSON.stringify(second.body));
  const secondDetail = await call("GET", `/api/challenges/${(second.body as { id: string }).id}`, { session: owner });
  assert.equal((secondDetail.body as { items: Array<{ catalogItem: { id: string } | null }> }).items[0].catalogItem?.id, aftersun.id, "mesmo filme, mesma linha do acervo");

  const catalog2 = await call("GET", `/api/groups/${gid}/catalog`, { session: owner });
  assert.equal((catalog2.body as { items: unknown[] }).items.length, 2, "reuso não cria filme novo");
  assert.equal((catalog2.body as { items: Array<{ id: string; roundCount: number }> }).items.find((i) => i.id === aftersun.id)?.roundCount, 2);

  // editar atributos no acervo — gênero principal é um rótulo único
  const patched = await call("PATCH", `/api/catalog/${aftersun.id}`, { session: owner, body: { mainGenre: "coming of age" } });
  assert.equal(patched.response.status, 200, JSON.stringify(patched.body));
  const afterPatch = await call("GET", `/api/challenges/${firstId}`, { session: owner });
  assert.equal((afterPatch.body as { items: Array<{ catalogItem: { mainGenre: string | null } | null }> }).items[0].catalogItem?.mainGenre, "coming of age");

  // filme e série se identificam só pelo título: "Dune (1984)" e "Dune (2021)"
  // são o mesmo item, e o ano avança para o lançamento mais recente.
  const dune = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner,
    body: {
      recipe: "cinema", title: "Duna", ...period,
      participantIds: [owner.user.id],
      fields: [{ key: "nota", label: "Nota", type: "rating", required: true }],
      items: [{ title: "Dune", year: 1984 }, { title: "Dune", year: 2021 }],
    },
  });
  assert.equal(dune.response.status, 201, JSON.stringify(dune.body));
  const duneCatalog = (await call("GET", `/api/groups/${gid}/catalog`, { session: owner })).body as { items: Array<{ title: string; year: number | null }> };
  const dunes = duneCatalog.items.filter((item) => item.title === "Dune");
  assert.equal(dunes.length, 1, "Dune 1984 e Dune 2021 são o mesmo filme");
  assert.equal(dunes[0].year, 2021, "o ano acompanha o lançamento mais recente");

  // indicador precisa ser membro do grupo
  const badRecommender = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner,
    body: {
      recipe: "cinema", title: "Rodada ruim", ...period,
      participantIds: [owner.user.id],
      fields: [{ key: "nota", label: "Nota", type: "rating", required: true }],
      items: [{ title: "Qualquer", recommendedByUserId: "user-que-nao-existe" }],
    },
  });
  assert.equal(badRecommender.response.status, 400);
});

test("acervo: adicionar item direto no catálogo (sem desafio) preserva o casamento de filme/livro e nunca funde 'other' por título", async () => {
  const owner = await register("Léo", "leo_acervo");
  const gid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Acervo direto" } })).body as { id: string }).id;

  // film: comportamento existente preservado — mesmo título reusa a identidade
  const film1 = await call("POST", `/api/groups/${gid}/catalog/items`, { session: owner, body: { kind: "film", title: "Aftersun", year: 2022 } });
  assert.equal(film1.response.status, 201, JSON.stringify(film1.body));
  const film2 = await call("POST", `/api/groups/${gid}/catalog/items`, { session: owner, body: { kind: "film", title: "AFTERSUN" } });
  assert.equal(film2.response.status, 201, JSON.stringify(film2.body));
  assert.equal((film2.body as { id: string }).id, (film1.body as { id: string }).id, "mesmo título, mesma identidade — comportamento preservado");

  // other: título (e até ano) iguais nunca fundem sozinhos — dois jogos distintos
  const matchA = await call("POST", `/api/groups/${gid}/catalog/items`, { session: owner, body: { kind: "other", title: "Barcelona x Real Madrid", year: 2026 } });
  assert.equal(matchA.response.status, 201, JSON.stringify(matchA.body));
  const matchB = await call("POST", `/api/groups/${gid}/catalog/items`, { session: owner, body: { kind: "other", title: "Barcelona x Real Madrid", year: 2026 } });
  assert.equal(matchB.response.status, 201, JSON.stringify(matchB.body));
  assert.notEqual((matchB.body as { id: string }).id, (matchA.body as { id: string }).id, "dois jogos, duas identidades, mesmo com título e ano iguais");

  const search = await call("GET", `/api/groups/${gid}/catalog/search?kind=other&title=barcelona`, { session: owner });
  assert.equal(search.response.status, 200, JSON.stringify(search.body));
  assert.equal((search.body as { items: unknown[] }).items.length, 2, "a busca sugere os dois jogos existentes, sem decidir por conta própria");

  // "usar existente" explícito: nenhuma linha nova é criada
  const reused = await call("POST", `/api/groups/${gid}/catalog/items`, {
    session: owner, body: { kind: "other", title: "Barcelona x Real Madrid", useExistingId: (matchA.body as { id: string }).id },
  });
  assert.equal(reused.response.status, 201, JSON.stringify(reused.body));
  assert.equal((reused.body as { id: string }).id, (matchA.body as { id: string }).id);

  const catalog = await call("GET", `/api/groups/${gid}/catalog`, { session: owner });
  assert.equal((catalog.body as { items: unknown[] }).items.length, 3, "1 filme + 2 jogos — 'usar existente' não criou um terceiro");

  // só owner/admin adiciona direto no acervo
  const member = await register("Bia", "bia_acervo");
  const invite = await call("POST", `/api/groups/${gid}/invites`, { session: owner, body: { expiresInDays: 7, maxUses: 1 } });
  await call("POST", `/api/invites/${(invite.body as { token: string }).token}`, { session: member, body: {} });
  const forbidden = await call("POST", `/api/groups/${gid}/catalog/items`, { session: member, body: { kind: "other", title: "Não deveria existir" } });
  assert.equal(forbidden.response.status, 403);
});

test("acervo pessoal: adicionar item direto materializa a biblioteca sob demanda e escapa entre contas", async () => {
  const owner = await register("Rui", "rui_pessoal");
  const other = await register("Ana", "ana_pessoal");

  const created = await call("POST", "/api/personal/catalog/items", { session: owner, body: { kind: "other", title: "Corrida 10km" } });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  const again = await call("POST", "/api/personal/catalog/items", { session: owner, body: { kind: "other", title: "Corrida 10km" } });
  assert.notEqual((again.body as { id: string }).id, (created.body as { id: string }).id, "acervo pessoal também não funde 'other' por título");

  const otherSearch = await call("GET", "/api/personal/catalog/search?kind=other&title=corrida", { session: other });
  assert.equal(otherSearch.response.status, 200);
  assert.equal((otherSearch.body as { items: unknown[] }).items.length, 0, "o acervo pessoal de uma conta nunca aparece na busca de outra");
});

test("desafio personalizado (fase 3): usa uma biblioteca própria do grupo, sem fundir itens por título", async () => {
  const owner = await register("Marta", "marta_matches");
  const gid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Copa do Mundo" } })).body as { id: string }).id;

  const created = await call("POST", `/api/groups/${gid}/catalog/libraries`, { session: owner, body: { label: "Matches" } });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  const library = created.body as { id: string; kind: string; source: string; label: string | null };
  assert.equal(library.source, "custom");
  assert.equal(library.label, "Matches");
  assert.match(library.kind, /^lib_[a-z0-9]+$/, "kind é opaco, nunca derivado do rótulo");

  const listed = await call("GET", `/api/groups/${gid}/catalog/libraries`, { session: owner });
  assert.equal(listed.response.status, 200);
  assert.ok((listed.body as { libraries: Array<{ id: string }> }).libraries.some((lib) => lib.id === library.id));

  const renamed = await call("PATCH", `/api/catalog/libraries/${library.id}`, { session: owner, body: { label: "Futebol" } });
  assert.equal(renamed.response.status, 200, JSON.stringify(renamed.body));
  assert.equal((renamed.body as { label: string }).label, "Futebol");

  // dois jogos com o mesmo título e a mesma "biblioteca": nunca é o mesmo item
  const challenge = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner,
    body: {
      recipe: "custom", title: "Fase de grupos", libraryId: library.id,
      participantIds: [owner.user.id],
      items: [{ title: "Barcelona x Real Madrid" }, { title: "Barcelona x Real Madrid" }],
    },
  });
  assert.equal(challenge.response.status, 201, JSON.stringify(challenge.body));
  const cid = (challenge.body as { id: string }).id;

  const detail = await call("GET", `/api/challenges/${cid}`, { session: owner });
  const items = (detail.body as { items: Array<{ catalogItem: { id: string } | null }> }).items;
  assert.equal(items.length, 2);
  assert.notEqual(items[0].catalogItem?.id, items[1].catalogItem?.id, "mesmo título, dois jogos distintos");

  // adicionar um terceiro item depois, com o mesmo título, ainda não funde —
  // e usa a biblioteca já estabelecida, não "film" por padrão
  const third = await call("POST", `/api/challenges/${cid}/items`, {
    session: owner, body: { title: "Barcelona x Real Madrid" },
  });
  assert.equal(third.response.status, 201, JSON.stringify(third.body));

  const catalog = await call("GET", `/api/groups/${gid}/catalog`, { session: owner });
  const matches = (catalog.body as { items: Array<{ kind: string; title: string }> }).items
    .filter((item) => item.kind === library.kind);
  assert.equal(matches.length, 3, "três jogos distintos na biblioteca, nenhum fundido por título");
  assert.equal(matches.every((item) => item.title === "Barcelona x Real Madrid"), true);

  // só owner/admin cria uma biblioteca
  const member = await register("Zeca", "zeca_matches");
  const invite = await call("POST", `/api/groups/${gid}/invites`, { session: owner, body: { expiresInDays: 7, maxUses: 1 } });
  await call("POST", `/api/invites/${(invite.body as { token: string }).token}`, { session: member, body: {} });
  const forbidden = await call("POST", `/api/groups/${gid}/catalog/libraries`, { session: member, body: { label: "Não deveria" } });
  assert.equal(forbidden.response.status, 403);
});

test("resposta compartilhada (fase 4): uma vez só, admin corrige, sem duplicar por participante, e conflito de concorrência", async () => {
  const owner = await register("Iris", "iris_shared");
  const friend = await register("Caio", "caio_shared");
  const gid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Copa" } })).body as { id: string }).id;
  const invite = await call("POST", `/api/groups/${gid}/invites`, { session: owner, body: { expiresInDays: 7, maxUses: 1 } });
  await call("POST", `/api/invites/${(invite.body as { token: string }).token}`, { session: friend, body: {} });

  const created = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner,
    body: {
      recipe: "cinema", title: "Fase de grupos", participantIds: [owner.user.id, friend.user.id],
      items: [{ title: "Aftersun" }],
    },
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  const cid = (created.body as { id: string }).id;
  const itemId = ((await call("GET", `/api/challenges/${cid}`, { session: owner })).body as { items: Array<{ id: string }> }).items[0].id;
  await call("POST", `/api/challenges/${cid}/transition`, { session: owner, body: { status: "active" } });

  const sharedType = await call("POST", `/api/challenges/${cid}/entry-types`, {
    session: owner,
    body: {
      name: "Placar final", sharedEditPolicy: "members_fill_admin_corrects",
      field: { key: "placar", label: "Placar final", type: "number", required: true, config: { min: 0, max: 20, step: 1 } },
    },
  });
  assert.equal(sharedType.response.status, 201, JSON.stringify(sharedType.body));
  const typeId = (sharedType.body as { id: string }).id;

  // primeiro preenchimento: qualquer participante pode
  const first = await call("POST", `/api/challenges/${cid}/entries`, {
    session: friend, body: { entryTypeId: typeId, itemId, values: { placar: 2 } },
  });
  assert.equal(first.response.status, 201, JSON.stringify(first.body));
  assert.equal((first.body as { answerScope: string }).answerScope, "shared");
  const entryId = (first.body as { id: string }).id;

  // já preenchida: outro membro comum não pode corrigir
  const blocked = await call("POST", `/api/challenges/${cid}/entries`, {
    session: friend, body: { entryTypeId: typeId, itemId, values: { placar: 3 } },
  });
  assert.equal(blocked.response.status, 403, JSON.stringify(blocked.body));
  assert.equal((blocked.body as { error: string }).error, "shared_locked");

  // um único registro aparece pros dois, não duplicado por participante
  const listedAsOwner = await call("GET", `/api/challenges/${cid}/entries`, { session: owner });
  const listedAsFriend = await call("GET", `/api/challenges/${cid}/entries`, { session: friend });
  const sharedRowsOwner = (listedAsOwner.body as { entries: Array<{ id: string; entryTypeId: string; participantId: string | null }> }).entries
    .filter((entry) => entry.entryTypeId === typeId);
  assert.equal(sharedRowsOwner.length, 1, "uma única linha, não uma por participante");
  assert.equal(sharedRowsOwner[0].participantId, null, "resposta compartilhada não pertence a uma pessoa");
  assert.equal(
    (listedAsFriend.body as { entries: unknown[] }).entries.filter((e) => (e as { entryTypeId: string }).entryTypeId === typeId).length,
    1, "o outro participante vê a mesma linha, também sem duplicar",
  );
  // admin corrige
  const corrected = await call("PATCH", `/api/entries/${entryId}`, { session: owner, body: { values: { placar: 3 } } });
  assert.equal(corrected.response.status, 200, JSON.stringify(corrected.body));

  // conflito de concorrência: quem tenta salvar com um "visto por último" desatualizado recebe 409, não uma sobrescrita silenciosa
  const stale = await call("POST", `/api/challenges/${cid}/entries`, {
    session: owner, body: { entryTypeId: typeId, itemId, values: { placar: 5 }, expectedUpdatedAt: new Date(0).toISOString() },
  });
  assert.equal(stale.response.status, 409, JSON.stringify(stale.body));
  assert.equal((stale.body as { error: string }).error, "shared_conflict");

  // "members_can_edit": qualquer membro elegível preenche e corrige livremente
  const openType = await call("POST", `/api/challenges/${cid}/entry-types`, {
    session: owner,
    body: {
      name: "Clima do jogo", sharedEditPolicy: "members_can_edit",
      field: { key: "clima", label: "Clima do jogo", type: "text", required: false },
    },
  });
  assert.equal(openType.response.status, 201, JSON.stringify(openType.body));
  const openTypeId = (openType.body as { id: string }).id;
  const openFirst = await call("POST", `/api/challenges/${cid}/entries`, {
    session: friend, body: { entryTypeId: openTypeId, itemId, values: { clima: "chuvoso" } },
  });
  assert.equal(openFirst.response.status, 201, JSON.stringify(openFirst.body));
  const openSecond = await call("POST", `/api/challenges/${cid}/entries`, {
    session: friend, body: { entryTypeId: openTypeId, itemId, values: { clima: "ensolarado" } },
  });
  assert.equal(openSecond.response.status, 201, JSON.stringify(openSecond.body));
  assert.equal((openSecond.body as { id: string }).id, (openFirst.body as { id: string }).id, "mesma linha compartilhada, atualizada, não duplicada");

  // avaliação individual do mesmo item continua uma linha por pessoa, sem interferência
  const ratingA = await call("POST", `/api/challenges/${cid}/entries`, { session: owner, body: { itemId, values: { nota: 4, comentario: "" } } });
  const ratingB = await call("POST", `/api/challenges/${cid}/entries`, { session: friend, body: { itemId, values: { nota: 5, comentario: "" } } });
  assert.equal(ratingA.response.status, 201);
  assert.equal(ratingB.response.status, 201);
  assert.notEqual((ratingA.body as { id: string }).id, (ratingB.body as { id: string }).id, "avaliação individual continua uma linha por participante");
});

test("resposta compartilhada: Done, conclusão e métricas respeitam o escopo, e dá para ter só respostas compartilhadas", async () => {
  const owner = await register("Nina", "nina_done");
  const friend = await register("Ivo", "ivo_done");
  const gid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Casal" } })).body as { id: string }).id;
  const invite = await call("POST", `/api/groups/${gid}/invites`, { session: owner, body: { expiresInDays: 7, maxUses: 1 } });
  await call("POST", `/api/invites/${(invite.body as { token: string }).token}`, { session: friend, body: {} });

  const created = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner,
    body: { recipe: "cinema", title: "Jogos", participantIds: [owner.user.id, friend.user.id], items: [{ title: "Jogo 1" }, { title: "Jogo 2" }] },
  });
  const cid = (created.body as { id: string }).id;
  const shared = await call("POST", `/api/challenges/${cid}/entry-types`, {
    session: owner,
    body: { name: "Placar", sharedEditPolicy: "members_can_edit", field: { key: "placar", label: "Placar", type: "number", required: true } },
  });
  const sharedTypeId = (shared.body as { id: string }).id;
  await call("POST", `/api/challenges/${cid}/transition`, { session: owner, body: { status: "active" } });
  const detail = () => call("GET", `/api/challenges/${cid}`, { session: owner }).then((r) => r.body as {
    entryTypes: Array<{ id: string; answerScope: string; sharedEditPolicy: string | null; countsCompletion: boolean; fields: Array<{ id: string; key: string }> }>;
    items: Array<{ id: string }>; metrics: Array<{ key: string; value: number | string | null }>;
  });
  const before = await detail();
  assert.deepEqual(
    before.entryTypes.map((type) => [type.answerScope, type.sharedEditPolicy]).sort(),
    [["individual", null], ["shared", "members_can_edit"]],
    "o detalhe expõe o escopo e a política",
  );
  const [item1] = before.items.map((item) => item.id);
  const completed = async (session: typeof owner) =>
    ((await call("GET", "/api/bootstrap", { session })).body as { challenges: Array<{ id: string; completedCount: number; totalCount: number }> })
      .challenges.find((challenge) => challenge.id === cid)!.completedCount;

  // avaliação individual sozinha não basta: falta a resposta compartilhada obrigatória
  await call("POST", `/api/challenges/${cid}/entries`, { session: friend, body: { itemId: item1, values: { nota: 4 } } });
  assert.equal(await completed(friend), 0);
  // quando o grupo registra o placar, quem já avaliou fica Done — e quem não avaliou continua não
  const first = await call("POST", `/api/challenges/${cid}/entries`, { session: owner, body: { entryTypeId: sharedTypeId, itemId: item1, values: { placar: 2 }, expectedUpdatedAt: null } });
  assert.equal(first.response.status, 201, JSON.stringify(first.body));
  assert.equal(await completed(friend), 1, "resposta individual + compartilhada");
  assert.equal(await completed(owner), 0, "o placar sozinho não conclui para quem não avaliou");

  // criar "do zero" sabendo que já existe é um conflito, não uma sobrescrita silenciosa
  const race = await call("POST", `/api/challenges/${cid}/entries`, { session: friend, body: { entryTypeId: sharedTypeId, itemId: item1, values: { placar: 9 }, expectedUpdatedAt: null } });
  assert.equal(race.response.status, 409);
  assert.equal((race.body as { error: string }).error, "shared_conflict");
  const listed = (await call("GET", `/api/challenges/${cid}/entries`, { session: friend })).body as { entries: Array<{ answerScope: string; lastEditedByName: string | null }> };
  assert.equal(listed.entries.find((entry) => entry.answerScope === "shared")?.lastEditedByName, "Nina", "quem mexeu por último aparece");

  // métricas: uma resposta compartilhada não entra em análise por pessoa
  const placarField = before.entryTypes.find((type) => type.id === sharedTypeId)!.fields[0].id;
  const perPerson = await call("POST", `/api/challenges/${cid}/metrics`, { session: owner, body: { label: "Por pessoa", operation: "average", fieldId: placarField, groupBy: "participant" } });
  assert.equal(perPerson.response.status, 400);
  assert.equal((perPerson.body as { error: string }).error, "shared_metric_unsupported");
  const perItem = await call("POST", `/api/challenges/${cid}/metrics`, { session: owner, body: { label: "Placar por jogo", operation: "average", fieldId: placarField, groupBy: "item" } });
  assert.equal(perItem.response.status, 201, JSON.stringify(perItem.body));

  // só respostas compartilhadas: o tipo individual sai (antes de ter respostas nele não dá, depois de tê-las também não)
  const blocked = await call("DELETE", `/api/challenges/${cid}/entry-types/${before.entryTypes.find((type) => type.answerScope === "individual")!.id}`, { session: owner });
  assert.equal(blocked.response.status, 409, "já há avaliações nesse tipo");

  // remover um tipo com métricas por cima pede confirmação, e leva as métricas junto
  const draftGid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Rascunho" } })).body as { id: string }).id;
  const draftChallenge = await call("POST", `/api/groups/${draftGid}/challenges`, {
    session: owner, body: { recipe: "cinema", title: "Rascunho", participantIds: [owner.user.id], items: [{ title: "A" }] },
  });
  const did = (draftChallenge.body as { id: string }).id;
  await call("POST", `/api/challenges/${did}/entry-types`, {
    session: owner, body: { name: "Placar", sharedEditPolicy: "members_can_edit", field: { key: "placar", label: "Placar", type: "number", required: true } },
  });
  const draftIndividual = ((await call("GET", `/api/challenges/${did}`, { session: owner })).body as { entryTypes: Array<{ id: string; answerScope: string }> })
    .entryTypes.find((type) => type.answerScope === "individual")!.id;
  const needsConfirm = await call("DELETE", `/api/challenges/${did}/entry-types/${draftIndividual}`, { session: owner });
  assert.equal(needsConfirm.response.status, 409);
  assert.equal((needsConfirm.body as { error: string }).error, "entry_type_has_metrics");
  assert.ok(((needsConfirm.body as { details: { metrics: string[] } }).details.metrics).includes("Nota média"), "lista as métricas que iriam junto");
  assert.equal((await call("DELETE", `/api/challenges/${did}/entry-types/${draftIndividual}?archiveMetrics=1`, { session: owner })).response.status, 200);

  // desafio personalizado só com respostas compartilhadas (as suas escolhas, não as da receita)
  const soloOwner = await register("Ana", "ana_done_solo");
  const soloGid = ((await call("POST", "/api/groups", { session: soloOwner, body: { name: "Só placar" } })).body as { id: string }).id;
  const library = (await call("POST", `/api/groups/${soloGid}/catalog/libraries`, { session: soloOwner, body: { label: "Jogos" } })).body as { id: string };
  const soloChallenge = await call("POST", `/api/groups/${soloGid}/challenges`, {
    session: soloOwner, body: { recipe: "custom", libraryId: library.id, title: "Só compartilhado", participantIds: [soloOwner.user.id], items: [{ title: "A" }, { title: "B" }] },
  });
  const sid = (soloChallenge.body as { id: string }).id;
  const soloShared = await call("POST", `/api/challenges/${sid}/entry-types`, {
    session: soloOwner, body: { name: "Placar", sharedEditPolicy: "members_can_edit", field: { key: "placar", label: "Placar", type: "number", required: true } },
  });
  const soloSharedId = (soloShared.body as { id: string }).id;
  const soloDetail = (await call("GET", `/api/challenges/${sid}`, { session: soloOwner })).body as { entryTypes: Array<{ id: string; answerScope: string }> };
  const individualId = soloDetail.entryTypes.find((type) => type.answerScope === "individual")!.id;
  assert.equal((await call("DELETE", `/api/challenges/${sid}/entry-types/${individualId}`, { session: soloOwner })).response.status, 200);
  // recriar um tipo com o mesmo nome depois de remover outro não pode colidir com a chave arquivada
  const again = await call("POST", `/api/challenges/${sid}/entry-types`, {
    session: soloOwner, body: { name: "Placar", sharedEditPolicy: "members_fill_admin_corrects", field: { key: "placar", label: "Placar", type: "number", required: false } },
  });
  assert.equal(again.response.status, 201, JSON.stringify(again.body));
  assert.equal((await call("DELETE", `/api/challenges/${sid}/entry-types/${(again.body as { id: string }).id}`, { session: soloOwner })).response.status, 200);
  assert.equal((await call("DELETE", `/api/challenges/${sid}/entry-types/${soloSharedId}`, { session: soloOwner })).response.status, 409, "o último tipo não sai");

  const soloAfter = (await call("GET", `/api/challenges/${sid}`, { session: soloOwner })).body as {
    entryTypes: Array<{ id: string; answerScope: string; isPrimary: boolean; countsCompletion: boolean; fields: Array<{ id: string }> }>;
  };
  assert.deepEqual(soloAfter.entryTypes.map((type) => [type.answerScope, type.isPrimary, type.countsCompletion]), [["shared", true, true]]);
  const activated = await call("POST", `/api/challenges/${sid}/transition`, { session: soloOwner, body: { status: "active" } });
  assert.equal(activated.response.status, 200, JSON.stringify(activated.body));
  const soloItems = (await call("GET", `/api/challenges/${sid}`, { session: soloOwner })).body as { items: Array<{ id: string }> };
  const soloEntry = await call("POST", `/api/challenges/${sid}/entries`, {
    session: soloOwner, body: { entryTypeId: soloSharedId, itemId: soloItems.items[0].id, values: { [soloAfter.entryTypes[0].fields[0].id]: 3 } },
  });
  assert.equal(soloEntry.response.status, 201, JSON.stringify(soloEntry.body));
  const boot = ((await call("GET", "/api/bootstrap", { session: soloOwner })).body as { challenges: Array<{ id: string; completedCount: number; totalCount: number }> }).challenges.find((c) => c.id === sid)!;
  assert.deepEqual([boot.completedCount, boot.totalCount], [1, 2], "um item concluído pelo placar compartilhado, de dois");
  const rate = ((await call("GET", `/api/challenges/${sid}`, { session: soloOwner })).body as { metrics: Array<{ operation: string; value?: number | string | null }> }).metrics.find((m) => m.operation === "completion_rate");
  assert.equal(Number(rate?.value), 50, "a taxa conta uma resposta compartilhada por item, não uma por pessoa");
});

test("agenda do item (fase 5): data só ou data e hora, nunca um prazo que bloqueia o registro", async () => {
  const owner = await register("Noa", "noa_agenda");
  const gid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Copa" } })).body as { id: string }).id;

  const created = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner,
    body: { recipe: "cinema", title: "Fase de grupos", timeZone: "America/Sao_Paulo", participantIds: [owner.user.id], items: [{ title: "Aftersun" }] },
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  const cid = (created.body as { id: string }).id;
  const detail0 = await call("GET", `/api/challenges/${cid}`, { session: owner });
  assert.equal((detail0.body as { timeZone: string }).timeZone, "America/Sao_Paulo");
  const itemId = (detail0.body as { items: Array<{ id: string }> }).items[0].id;

  // só a data: guarda um instante real, mas com precisão de dia
  const dateOnly = await call("PATCH", `/api/challenges/${cid}/items/${itemId}`, {
    session: owner, body: { opensOn: "2026-06-15" },
  });
  assert.equal(dateOnly.response.status, 200, JSON.stringify(dateOnly.body));
  assert.equal((dateOnly.body as { schedulePrecision: string }).schedulePrecision, "date");
  const storedOpensAt = new Date((dateOnly.body as { opensAt: string }).opensAt);
  // meia-noite em America/Sao_Paulo (UTC-3) é 03:00 UTC
  assert.equal(storedOpensAt.toISOString(), "2026-06-15T03:00:00.000Z");

  // misturar data-só com data-e-hora no mesmo pedido é rejeitado, não adivinhado
  const mixed = await call("PATCH", `/api/challenges/${cid}/items/${itemId}`, {
    session: owner, body: { opensAt: "2026-06-15T15:00:00Z", dueOn: "2026-06-15" },
  });
  assert.equal(mixed.response.status, 400, JSON.stringify(mixed.body));

  // data e hora precisas: passam a valer, sem herdar a data-só anterior
  const dated = await call("PATCH", `/api/challenges/${cid}/items/${itemId}`, {
    session: owner, body: { opensAt: "2026-06-15T18:00:00Z", dueAt: new Date(Date.now() - 60_000).toISOString() },
  });
  assert.equal(dated.response.status, 200, JSON.stringify(dated.body));
  assert.equal((dated.body as { schedulePrecision: string }).schedulePrecision, "datetime");

  await call("POST", `/api/challenges/${cid}/transition`, { session: owner, body: { status: "active" } });
  // o prazo já passou (due_at no passado) — registrar a nota continua funcionando
  const scored = await call("POST", `/api/challenges/${cid}/entries`, {
    session: owner, body: { itemId, values: { nota: 4, comentario: "" } },
  });
  assert.equal(scored.response.status, 201, JSON.stringify(scored.body));
});

test("indicação por nome externo (fase 6): reutilizável, exclusiva, isolada por espaço e fora dos modelos públicos", async () => {
  const admin = await register("Curadora", "curadora_indica");
  await adminPool.query("UPDATE users SET platform_admin = true WHERE id = $1", [admin.user.id]);
  const owner = await login("curadora_indica");
  const other = await register("Outra", "outra_indica");
  const gid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Cine" } })).body as { id: string }).id;
  const otherGid = ((await call("POST", "/api/groups", { session: other, body: { name: "Outro grupo" } })).body as { id: string }).id;

  const saved = await call("POST", `/api/groups/${gid}/catalog/recommenders`, { session: owner, body: { displayName: "Ana do trabalho" } });
  assert.equal(saved.response.status, 201, JSON.stringify(saved.body));
  const anaId = (saved.body as { id: string }).id;
  const foreign = await call("POST", `/api/groups/${otherGid}/catalog/recommenders`, { session: other, body: { displayName: "Gente de outro grupo" } });
  const foreignId = (foreign.body as { id: string }).id;

  const listed = await call("GET", `/api/groups/${gid}/catalog/recommenders`, { session: owner });
  assert.deepEqual((listed.body as { recommenders: Array<{ displayName: string }> }).recommenders.map((r) => r.displayName), ["Ana do trabalho"]);

  const created = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner, body: { recipe: "cinema", title: "Indicados", participantIds: [owner.user.id], items: [{ title: "Aftersun" }] },
  });
  const cid = (created.body as { id: string }).id;
  const itemId = ((await call("GET", `/api/challenges/${cid}`, { session: owner })).body as { items: Array<{ id: string }> }).items[0].id;

  // atribui pela escolha "nome salvo"
  const assigned = await call("PATCH", `/api/challenges/${cid}/items/${itemId}`, { session: owner, body: { recommendedByExternalId: anaId } });
  assert.equal(assigned.response.status, 200, JSON.stringify(assigned.body));
  const inGroup = await call("GET", `/api/challenges/${cid}`, { session: owner });
  assert.deepEqual(
    (inGroup.body as { items: Array<{ recommendedBy: unknown }> }).items[0].recommendedBy,
    { kind: "external", id: anaId, name: "Ana do trabalho" },
  );

  // um nome de outro espaço nunca pode ser atribuído, e as escolhas são exclusivas
  const crossWorkspace = await call("PATCH", `/api/challenges/${cid}/items/${itemId}`, { session: owner, body: { recommendedByExternalId: foreignId } });
  assert.equal(crossWorkspace.response.status, 400, JSON.stringify(crossWorkspace.body));
  const both = await call("PATCH", `/api/challenges/${cid}/items/${itemId}`, {
    session: owner, body: { recommendedByExternalId: anaId, originNote: "achei num artigo" },
  });
  assert.equal(both.response.status, 400, JSON.stringify(both.body));

  // renomear a pessoa não muda a atribuição — só o rótulo
  const renamed = await call("PATCH", `/api/catalog/recommenders/${anaId}`, { session: owner, body: { displayName: "Ana (RH)" } });
  assert.equal(renamed.response.status, 200, JSON.stringify(renamed.body));
  const afterRename = await call("GET", `/api/challenges/${cid}`, { session: owner });
  assert.deepEqual(
    (afterRename.body as { items: Array<{ recommendedBy: { id: string; name: string } | null }> }).items[0].recommendedBy,
    { kind: "external", id: anaId, name: "Ana (RH)" },
  );

  // a recomendação do item do desafio e a do acervo são atribuições independentes
  const catalogItem = await call("POST", `/api/groups/${gid}/catalog/items`, {
    session: owner, body: { kind: "other", title: "Documentário X", catalogRecommendedByExternalId: anaId },
  });
  assert.equal(catalogItem.response.status, 201, JSON.stringify(catalogItem.body));
  const catalog = await call("GET", `/api/groups/${gid}/catalog`, { session: owner });
  const docs = (catalog.body as { items: Array<{ title: string; recommendedBy: { name: string } | null }> }).items.find((item) => item.title === "Documentário X");
  assert.equal(docs?.recommendedBy?.name, "Ana (RH)");
  const aftersunEntry = (catalog.body as { items: Array<{ title: string; recommendedBy: unknown }> }).items.find((item) => item.title === "Aftersun");
  assert.equal(aftersunEntry?.recommendedBy, null, "o item do desafio recomendado por Ana não vira a recomendação do acervo");

  // fora dos modelos públicos: o nome externo nunca aparece
  const published = await call("POST", `/api/challenges/${cid}/template`, { session: owner, body: {} });
  assert.equal(published.response.status, 200, JSON.stringify(published.body));
  const publicDetail = await call("GET", `/api/templates/${cid}`);
  assert.equal(publicDetail.response.status, 200, JSON.stringify(publicDetail.body));
  assert.equal(
    (publicDetail.body as { items: Array<{ recommendedBy: unknown }> }).items[0].recommendedBy, null,
    "o modelo público não expõe o nome externo",
  );
  assert.equal(JSON.stringify(publicDetail.body).includes("Ana"), false, "o nome não vaza em nenhum outro campo do modelo público");

  // desligar a indicação esconde a capacidade, sem apagar o dado
  const disabled = await call("PATCH", `/api/groups/${gid}`, { session: owner, body: { recommendationsEnabled: false } });
  assert.equal(disabled.response.status, 200, JSON.stringify(disabled.body));
  assert.equal((disabled.body as { recommendationsEnabled: boolean }).recommendationsEnabled, false);
  // …a atribuição continua guardada, só deixa de ser mostrada a qualquer pessoa do grupo
  const stored = await adminPool.query<{ recommended_by_external_id: string | null }>(
    "SELECT recommended_by_external_id FROM challenge_items WHERE id = $1", [itemId],
  );
  assert.equal(stored.rows[0].recommended_by_external_id, anaId, "a atribuição continua guardada");
  const hidden = await call("GET", `/api/challenges/${cid}`, { session: owner });
  assert.equal((hidden.body as { recommendationsEnabled: boolean }).recommendationsEnabled, false);
  assert.equal((hidden.body as { items: Array<{ recommendedBy: unknown }> }).items[0].recommendedBy, null, "desligado, o nome não é mais mostrado");
  const hiddenCatalog = await call("GET", `/api/groups/${gid}/catalog`, { session: owner });
  assert.equal(
    (hiddenCatalog.body as { items: Array<{ title: string; recommendedBy: unknown }> }).items.find((item) => item.title === "Documentário X")?.recommendedBy,
    null, "nem no acervo",
  );
  // e enquanto estiver desligado, também não dá para registrar uma nova indicação
  const refused = await call("PATCH", `/api/challenges/${cid}/items/${itemId}`, { session: owner, body: { recommendedByExternalId: anaId } });
  assert.equal(refused.response.status, 409, JSON.stringify(refused.body));
  assert.equal((refused.body as { error: string }).error, "recommendations_disabled");
  const refusedNew = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner, body: { recipe: "cinema", title: "Sem indicação", participantIds: [owner.user.id], items: [{ title: "Solaris", originNote: "um blog" }] },
  });
  assert.equal(refusedNew.response.status, 409, JSON.stringify(refusedNew.body));
  // limpar continua permitido, e religar traz tudo de volta
  const cleared = await call("PATCH", `/api/challenges/${cid}/items/${itemId}`, { session: owner, body: { recommendedByExternalId: "", originNote: "" } });
  assert.equal(cleared.response.status, 200, JSON.stringify(cleared.body));
  await call("PATCH", `/api/groups/${gid}`, { session: owner, body: { recommendationsEnabled: true } });
  const catalogBack = await call("GET", `/api/groups/${gid}/catalog`, { session: owner });
  assert.equal(
    (catalogBack.body as { items: Array<{ title: string; recommendedBy: { name: string } | null }> }).items.find((item) => item.title === "Documentário X")?.recommendedBy?.name,
    "Ana (RH)", "religado, a indicação do acervo volta",
  );
});

test("Tables (fase 7): a biblioteca só existe quando a pessoa a cria, três notas 0–5 e comentário opcional, sem campos forçados", async () => {
  const owner = await register("Bruna", "bruna_tables");
  const gid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Rolês" } })).body as { id: string }).id;

  // workspace em branco: nenhuma biblioteca Tables ainda
  const before = await call("GET", `/api/groups/${gid}/catalog/libraries`, { session: owner });
  assert.equal((before.body as { libraries: Array<{ source: string }> }).libraries.some((lib) => lib.source === "tables"), false);

  // sem a biblioteca, a rodada não sai — e nada é criado por baixo dos panos
  const refused = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner,
    body: { recipe: "tables", title: "Onde comer", participantIds: [owner.user.id], items: [{ title: "Cantina do Zé" }] },
  });
  assert.equal(refused.response.status, 409, JSON.stringify(refused.body));
  assert.equal((refused.body as { error: string }).error, "library_missing");
  const untouched = await call("GET", `/api/groups/${gid}/catalog/libraries`, { session: owner });
  assert.equal((untouched.body as { libraries: Array<{ source: string }> }).libraries.some((lib) => lib.source === "tables"), false, "recusar não cria a biblioteca");

  assert.equal((await call("POST", `/api/groups/${gid}/catalog/libraries`, { session: owner, body: { source: "tables" } })).response.status, 201);
  const created = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner,
    body: { recipe: "tables", title: "Onde comer", participantIds: [owner.user.id], items: [{ title: "Cantina do Zé" }, { title: "Cantina do Zé" }] },
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  const cid = (created.body as { id: string }).id;

  const libs = (await call("GET", `/api/groups/${gid}/catalog/libraries`, { session: owner })).body as {
    libraries: Array<{ source: string; label: string | null; kind: string }>;
  };
  const tablesLibs = libs.libraries.filter((lib) => lib.source === "tables");
  assert.equal(tablesLibs.length, 1, "uma biblioteca Tables, a que a pessoa criou");
  assert.equal(tablesLibs[0].label, null, "o nome padrão fica por conta do idioma, não gravado");

  // um segundo desafio reaproveita a mesma biblioteca em vez de criar outra
  const second = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner, body: { recipe: "tables", title: "Cafés", participantIds: [owner.user.id], items: [{ title: "Café da esquina" }] },
  });
  assert.equal(second.response.status, 201, JSON.stringify(second.body));
  const libsAfter = (await call("GET", `/api/groups/${gid}/catalog/libraries`, { session: owner })).body as { libraries: Array<{ source: string }> };
  assert.equal(libsAfter.libraries.filter((lib) => lib.source === "tables").length, 1);

  // títulos iguais são lugares distintos, nunca fundidos
  const catalog = (await call("GET", `/api/groups/${gid}/catalog`, { session: owner })).body as { items: Array<{ kind: string; title: string }> };
  assert.equal(catalog.items.filter((item) => item.kind === tablesLibs[0].kind && item.title === "Cantina do Zé").length, 2);

  const detail = (await call("GET", `/api/challenges/${cid}`, { session: owner })).body as { fields: Array<{ key: string; type: string; required: boolean }> };
  assert.deepEqual(
    detail.fields.map((field) => [field.key, field.type, field.required]),
    [["comida", "rating", true], ["ambiente_atendimento", "rating", true], ["custo_beneficio", "rating", true], ["comentario", "text", false]],
  );

  await call("POST", `/api/challenges/${cid}/transition`, { session: owner, body: { status: "active" } });
  const itemId = ((await call("GET", `/api/challenges/${cid}`, { session: owner })).body as { items: Array<{ id: string }> }).items[0].id;
  const incomplete = await call("POST", `/api/challenges/${cid}/entries`, { session: owner, body: { itemId, values: { comida: 4 } } });
  assert.equal(incomplete.response.status, 400, "as três notas são obrigatórias");
  const complete = await call("POST", `/api/challenges/${cid}/entries`, {
    session: owner, body: { itemId, values: { comida: 4.5, ambiente_atendimento: 3, custo_beneficio: 5 } },
  });
  assert.equal(complete.response.status, 201, JSON.stringify(complete.body));
});

test("Tables: a Nota geral média as três notas por lugar, e sobrevive a uma cópia do desafio", async () => {
  const owner = await register("Duda", "duda_tables_geral");
  const gid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Rolês 2" } })).body as { id: string }).id;
  await call("POST", `/api/groups/${gid}/catalog/libraries`, { session: owner, body: { source: "tables" } });
  const created = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner,
    body: {
      recipe: "tables", title: "Onde comer", participantIds: [owner.user.id],
      items: [{ title: "Cantina do Zé" }, { title: "Boteco da Ana" }],
    },
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  const cid = (created.body as { id: string }).id;

  const detail = (await call("GET", `/api/challenges/${cid}`, { session: owner })).body as {
    items: Array<{ id: string; title: string }>;
    metrics: Array<{ key: string; fieldId: string | null }>;
  };
  assert.deepEqual(
    detail.metrics.map((metric) => metric.key),
    ["media_comida", "media_ambiente_atendimento", "media_custo_beneficio", "nota_geral", "taxa_conclusao"],
    "a receita semeia as três médias, a nota geral combinada e a conclusão",
  );
  assert.ok(detail.metrics.find((metric) => metric.key === "nota_geral")!.fieldId, "a métrica combinada ainda aponta um campo, para a checagem do banco");
  const cantina = detail.items.find((item) => item.title === "Cantina do Zé")!.id;
  const boteco = detail.items.find((item) => item.title === "Boteco da Ana")!.id;

  await call("POST", `/api/challenges/${cid}/transition`, { session: owner, body: { status: "active" } });
  // Cantina: (5+5+5)/3 = 5. Boteco: (1+2+3)/3 = 2. A nota geral é a média por lugar dessas três, não a soma bruta.
  await call("POST", `/api/challenges/${cid}/entries`, { session: owner, body: { itemId: cantina, values: { comida: 5, ambiente_atendimento: 5, custo_beneficio: 5 } } });
  await call("POST", `/api/challenges/${cid}/entries`, { session: owner, body: { itemId: boteco, values: { comida: 1, ambiente_atendimento: 2, custo_beneficio: 3 } } });

  const withEntries = (await call("GET", `/api/challenges/${cid}`, { session: owner })).body as {
    metrics: Array<{ key: string; value: number | null; series?: Array<{ label: string; value: number | null }> }>;
  };
  const notaGeral = withEntries.metrics.find((metric) => metric.key === "nota_geral")!;
  assert.equal(notaGeral.value, 3.5, "média das duas notas combinadas, (5 + 2) / 2");
  assert.deepEqual(
    [...notaGeral.series ?? []].sort((a, b) => a.label.localeCompare(b.label)).map((entry) => [entry.label, entry.value]),
    [["Boteco da Ana", 2], ["Cantina do Zé", 5]],
  );
  // As três médias individuais continuam corretas e independentes da combinada.
  assert.equal(withEntries.metrics.find((metric) => metric.key === "media_comida")!.value, 3, "(5 + 1) / 2");

  // Uma cópia do desafio (mesmo sem entradas ainda) precisa remapear os três campos da métrica combinada
  // para os campos NOVOS — não os do desafio de origem — ou a nota geral fica muda no destino.
  const dstGid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Rolês 2 (cópia)" } })).body as { id: string }).id;
  const duplicated = await call("POST", `/api/challenges/${cid}/duplicate`, { session: owner, body: { targetGroupId: dstGid } });
  assert.equal(duplicated.response.status, 201, JSON.stringify(duplicated.body));
  const dcid = (duplicated.body as { id: string }).id;
  const dupDetail = (await call("GET", `/api/challenges/${dcid}`, { session: owner })).body as {
    items: Array<{ id: string; title: string }>;
  };
  const dupItemId = dupDetail.items[0].id;
  // A duplicate starts with no participants of its own (the destination group may not be the same
  // people) — pick them again before the round can take entries.
  await call("POST", `/api/challenges/${dcid}/participants`, { session: owner, body: { participantIds: [owner.user.id] } });
  await call("POST", `/api/challenges/${dcid}/transition`, { session: owner, body: { status: "active" } });
  const dupEntry = await call("POST", `/api/challenges/${dcid}/entries`, { session: owner, body: { itemId: dupItemId, values: { comida: 4, ambiente_atendimento: 4, custo_beneficio: 4 } } });
  assert.equal(dupEntry.response.status, 201, JSON.stringify(dupEntry.body));
  const dupWithEntry = (await call("GET", `/api/challenges/${dcid}`, { session: owner })).body as {
    metrics: Array<{ key: string; value: number | null }>;
  };
  assert.equal(dupWithEntry.metrics.find((metric) => metric.key === "nota_geral")!.value, 4, "a métrica combinada da cópia lê os campos da cópia");
});

test("cópia de modelo (fase 7): só a estrutura ou com itens, o escopo compartilhado fica, nada privado atravessa", async () => {
  const admin = await register("Curador", "curador_copia");
  await adminPool.query("UPDATE users SET platform_admin = true WHERE id = $1", [admin.user.id]);
  const owner = await login("curador_copia");
  const srcGid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Origem" } })).body as { id: string }).id;
  const dstGid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Destino" } })).body as { id: string }).id;

  const library = (await call("POST", `/api/groups/${srcGid}/catalog/libraries`, { session: owner, body: { label: "Futebol" } })).body as { id: string; kind: string };
  const ana = (await call("POST", `/api/groups/${srcGid}/catalog/recommenders`, { session: owner, body: { displayName: "Ana do trabalho" } })).body as { id: string };
  const created = await call("POST", `/api/groups/${srcGid}/challenges`, {
    session: owner,
    body: { recipe: "custom", title: "Copa", libraryId: library.id, participantIds: [owner.user.id], items: [{ title: "Brasil x Argentina" }] },
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  const cid = (created.body as { id: string }).id;
  const itemId = ((await call("GET", `/api/challenges/${cid}`, { session: owner })).body as { items: Array<{ id: string }> }).items[0].id;
  await call("PATCH", `/api/challenges/${cid}/items/${itemId}`, { session: owner, body: { recommendedByExternalId: ana.id } });
  const shared = await call("POST", `/api/challenges/${cid}/entry-types`, {
    session: owner,
    body: { name: "Placar", sharedEditPolicy: "members_can_edit", field: { key: "placar", label: "Placar", type: "number", required: true } },
  });
  assert.equal(shared.response.status, 201, JSON.stringify(shared.body));
  await call("POST", `/api/challenges/${cid}/transition`, { session: owner, body: { status: "active" } });
  await call("POST", `/api/challenges/${cid}/entries`, { session: owner, body: { itemId, values: { nota: 4, comentario: "segredo do grupo" } } });
  await call("POST", `/api/challenges/${cid}/entries`, { session: owner, body: { entryTypeId: (shared.body as { id: string }).id, itemId, values: { placar: 2 } } });

  // um desafio personalizado também pode virar modelo público
  const published = await call("POST", `/api/challenges/${cid}/template`, { session: owner, body: {} });
  assert.equal(published.response.status, 200, JSON.stringify(published.body));
  const gallery = (await call("GET", "/api/templates")).body as { templates: Array<{ id: string }> };
  assert.ok(gallery.templates.some((template) => template.id === cid), "o modelo personalizado aparece na galeria");

  const bad = await call("POST", `/api/templates/${cid}/duplicate`, { session: owner, body: { targetGroupId: dstGid, mode: "tudo" } });
  assert.equal(bad.response.status, 400);

  const structureOnly = await call("POST", `/api/templates/${cid}/duplicate`, { session: owner, body: { targetGroupId: dstGid, mode: "structure" } });
  assert.equal(structureOnly.response.status, 201, JSON.stringify(structureOnly.body));
  const soId = (structureOnly.body as { id: string }).id;

  const withItems = await call("POST", `/api/templates/${cid}/duplicate`, { session: owner, body: { targetGroupId: dstGid, mode: "structure_and_items" } });
  assert.equal(withItems.response.status, 201, JSON.stringify(withItems.body));
  const wiId = (withItems.body as { id: string }).id;

  const count = async (sql: string, id: string) => Number((await adminPool.query<{ n: string }>(sql, [id])).rows[0].n);
  assert.equal(await count("SELECT count(*) AS n FROM challenge_items WHERE challenge_id = $1", soId), 0, "só a estrutura: nenhum item");
  assert.equal(await count("SELECT count(*) AS n FROM challenge_items WHERE challenge_id = $1", wiId), 1, "estrutura + itens: o item veio");
  for (const id of [soId, wiId]) {
    assert.equal(await count("SELECT count(*) AS n FROM entries WHERE challenge_id = $1", id), 0, "nenhuma resposta atravessa");
    assert.equal(await count("SELECT count(*) AS n FROM challenge_participants WHERE challenge_id = $1", id), 0, "nenhum participante atravessa");
    assert.equal(
      await count("SELECT count(*) AS n FROM entry_types WHERE challenge_id = $1 AND answer_scope = 'shared' AND shared_edit_policy = 'members_can_edit'", id),
      1, "a resposta compartilhada continua compartilhada, com a mesma política",
    );
    assert.equal(await count("SELECT count(*) AS n FROM challenge_items WHERE challenge_id = $1 AND (recommended_by_user_id IS NOT NULL OR recommended_by_external_id IS NOT NULL OR origin_note IS NOT NULL)", id), 0, "nenhuma indicação atravessa");
  }
  // o nome externo e as recomendações não vazam para o espaço de destino
  assert.equal(await count("SELECT count(*) AS n FROM catalog_recommenders WHERE group_id = $1", dstGid), 0);
  assert.equal(await count("SELECT count(*) AS n FROM catalog_items WHERE group_id = $1 AND (recommended_by_user_id IS NOT NULL OR recommended_by_external_id IS NOT NULL OR origin_note IS NOT NULL)", dstGid), 0);
  // a biblioteca própria vai junto, com o mesmo nome — separada da original
  const dstLibs = (await call("GET", `/api/groups/${dstGid}/catalog/libraries`, { session: owner })).body as { libraries: Array<{ label: string | null; kind: string }> };
  const copied = dstLibs.libraries.find((lib) => lib.kind === library.kind);
  assert.equal(copied?.label, "Futebol");
  const renamedCopy = await call("PATCH", `/api/catalog/libraries/${(await adminPool.query<{ id: string }>("SELECT id FROM catalog_libraries WHERE group_id = $1 AND kind = $2", [dstGid, library.kind])).rows[0].id}`, { session: owner, body: { label: "Só no destino" } });
  assert.equal(renamedCopy.response.status, 200);
  const srcLibs = (await call("GET", `/api/groups/${srcGid}/catalog/libraries`, { session: owner })).body as { libraries: Array<{ label: string | null; kind: string }> };
  assert.equal(srcLibs.libraries.find((lib) => lib.kind === library.kind)?.label, "Futebol", "renomear a cópia não mexe na original");

  // duplicar um desafio comum aceita o mesmo modo
  const plain = await call("POST", `/api/challenges/${cid}/duplicate`, { session: owner, body: { targetGroupId: dstGid, mode: "structure" } });
  assert.equal(plain.response.status, 201, JSON.stringify(plain.body));
  assert.equal(await count("SELECT count(*) AS n FROM challenge_items WHERE challenge_id = $1", (plain.body as { id: string }).id), 0);
});

test("insights da administração (fase 8): só contagens confirmadas, sem a equipe e sem conteúdo privado", async () => {
  const admin = await register("Equipe", "equipe_insights");
  await adminPool.query("UPDATE users SET platform_admin = true WHERE id = $1", [admin.user.id]);
  const staff = await login("equipe_insights");
  type Insights = {
    includesStaff: boolean;
    definitions: Record<string, string>;
    overview: { challengesInProgress: number; accountsNewInWindow: number; weekly: unknown[] };
    creation: {
      challengesCreated: number; copiedFromChallenge: number; byRecipe: Array<{ recipe: string; count: number }>;
      firstRecord: { challengesCreated: number; withFirstRecord: number };
    };
  };
  const insights = async (query = "") => {
    const result = await call("GET", `/api/admin/insights${query}`, { session: staff });
    assert.equal(result.response.status, 200, JSON.stringify(result.body));
    return result.body as Insights;
  };
  const cinema = (body: Insights) => body.creation.byRecipe.find((row) => row.recipe === "cinema")?.count ?? 0;
  const before = await insights();

  const person = await register("Pessoa Comum", "pessoa_insights");
  const denied = await call("GET", "/api/admin/insights", { session: person });
  assert.equal(denied.response.status, 404, "quem não é da administração não vê os insights");

  const gid = ((await call("POST", "/api/groups", { session: person, body: { name: "Grupo Confidencial" } })).body as { id: string }).id;
  const otherGid = ((await call("POST", "/api/groups", { session: person, body: { name: "Outro Grupo" } })).body as { id: string }).id;
  const created = await call("POST", `/api/groups/${gid}/challenges`, {
    session: person, body: { recipe: "cinema", title: "Título Secreto", participantIds: [person.user.id], items: [{ title: "Filme Secreto" }] },
  });
  const cid = (created.body as { id: string }).id;
  await call("POST", `/api/challenges/${cid}/transition`, { session: person, body: { status: "active" } });
  const itemId = ((await call("GET", `/api/challenges/${cid}`, { session: person })).body as { items: Array<{ id: string }> }).items[0].id;
  await call("POST", `/api/challenges/${cid}/entries`, { session: person, body: { itemId, values: { nota: 5, comentario: "Comentário Secreto" } } });
  await call("POST", `/api/challenges/${cid}/duplicate`, { session: person, body: { targetGroupId: otherGid } });

  // atividade da própria equipe não entra por padrão
  const staffGid = ((await call("POST", "/api/groups", { session: staff, body: { name: "Teste da equipe" } })).body as { id: string }).id;
  await call("POST", `/api/groups/${staffGid}/challenges`, {
    session: staff, body: { recipe: "cinema", title: "Demo", participantIds: [staff.user.id], items: [{ title: "F" }] },
  });

  const after = await insights();
  assert.equal(after.creation.challengesCreated - before.creation.challengesCreated, 1, "conta o desafio da pessoa, não o da equipe");
  assert.equal(after.creation.copiedFromChallenge - before.creation.copiedFromChallenge, 1);
  assert.equal(cinema(after) - cinema(before), 2, "o original e a cópia entram por modelo; o da equipe não");
  assert.equal(after.creation.firstRecord.challengesCreated - before.creation.firstRecord.challengesCreated, 2);
  assert.equal(after.creation.firstRecord.withFirstRecord - before.creation.firstRecord.withFirstRecord, 1, "só o original recebeu o primeiro registro");
  assert.equal(after.overview.challengesInProgress - before.overview.challengesInProgress, 1);
  assert.equal(after.overview.accountsNewInWindow - before.overview.accountsNewInWindow, 1);
  assert.equal(after.overview.weekly.length, 8);
  assert.equal(after.includesStaff, false);
  assert.ok(after.definitions.confirmed.includes("Tentativas"), "explica que só ações confirmadas são contadas");

  const withStaff = await insights("?includeStaff=1");
  assert.equal(withStaff.includesStaff, true);
  assert.ok(withStaff.creation.challengesCreated >= after.creation.challengesCreated + 1, "incluindo a equipe, o desafio de teste aparece");

  const serialized = JSON.stringify(after);
  for (const secret of ["Título Secreto", "Filme Secreto", "Comentário Secreto", "Grupo Confidencial", "pessoa_insights", "Pessoa Comum"]) {
    assert.equal(serialized.includes(secret), false, `"${secret}" não pode vazar para os insights`);
  }
});

test("propriedades da biblioteca: renomear e ocultar, nativa ou personalizada, pela mesma interface — sem perder dado nem métrica", async () => {
  const owner = await register("Paula", "paula_props");
  const member = await register("Davi", "davi_props");
  const gid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Cineclube" } })).body as { id: string }).id;
  const invite = await call("POST", `/api/groups/${gid}/invites`, { session: owner, body: { expiresInDays: 7, maxUses: 1 } });
  await call("POST", `/api/invites/${(invite.body as { token: string }).token}`, { session: member, body: {} });

  const challenge = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner,
    body: {
      recipe: "cinema", title: "Por ano", participantIds: [owner.user.id],
      items: [{ title: "Filme A 2026", year: 2026, mainGenre: "drama" }, { title: "Filme B 2025", year: 2025 }],
    },
  });
  const cid = (challenge.body as { id: string }).id;
  await call("POST", `/api/challenges/${cid}/transition`, { session: owner, body: { status: "active" } });
  const detail = (await call("GET", `/api/challenges/${cid}`, { session: owner })).body as {
    entryTypes: Array<{ id: string; fields: Array<{ id: string; key: string }> }>; items: Array<{ id: string; title: string }>;
  };
  const notaField = detail.entryTypes[0].fields.find((field) => field.key === "nota")!.id;
  for (const item of detail.items) {
    await call("POST", `/api/challenges/${cid}/entries`, { session: owner, body: { itemId: item.id, entryTypeId: detail.entryTypes[0].id, values: { [notaField]: 4 } } });
  }
  const metric = await call("POST", `/api/challenges/${cid}/metrics`, {
    session: owner, body: { label: "Nota por ano", operation: "average", fieldId: notaField, groupBy: "catalog_year" },
  });
  assert.equal(metric.response.status, 201, JSON.stringify(metric.body));
  const metricId = (metric.body as { id: string }).id;
  const seriesKeys = async () =>
    ((await call("GET", `/api/challenges/${cid}`, { session: owner })).body as { metrics: Array<{ id: string; series?: Array<{ key: string }> }> })
      .metrics.find((entry) => entry.id === metricId)!.series!.map((row) => row.key).sort();
  assert.deepEqual(await seriesKeys(), ["2025", "2026"]);

  const libraries = (await call("GET", `/api/groups/${gid}/catalog/libraries`, { session: owner })).body as { libraries: Array<{ id: string; kind: string; source: string }> };
  const screens = libraries.libraries.find((library) => library.kind === "film")!;
  const props = async (libraryId: string) =>
    (await call("GET", `/api/catalog/libraries/${libraryId}/properties`, { session: owner })).body as {
      properties: Array<{ key: string; storage: string; label: string | null; hidden: boolean; canHide: boolean }>;
    };

  const initial = await props(screens.id);
  assert.deepEqual(initial.properties.map((property) => property.key), ["title", "year", "main_genre", "runtime_minutes", "scheduled_at"]);
  assert.equal(initial.properties.every((property) => property.storage === "native" && property.label === null), true);
  assert.deepEqual(initial.properties.filter((property) => property.hidden).map((property) => property.key), ["scheduled_at"], "só a data do evento nasce desligada");
  assert.equal(initial.properties[0].canHide, false, "o nome do item nunca fica oculto");

  // renomear e ocultar uma propriedade nativa — dado e métrica seguem intactos
  const renamed = await call("PATCH", `/api/catalog/libraries/${screens.id}/properties/year`, { session: owner, body: { label: "Ano de estreia" } });
  assert.equal(renamed.response.status, 200, JSON.stringify(renamed.body));
  const hiddenYear = await call("PATCH", `/api/catalog/libraries/${screens.id}/properties/year`, { session: owner, body: { hidden: true } });
  assert.deepEqual(
    (hiddenYear.body as { property: { label: string; hidden: boolean } }).property,
    { key: "year", storage: "native", label: "Ano de estreia", type: "number", hidden: true, position: 1, canHide: true },
  );
  const catalog = (await call("GET", `/api/groups/${gid}/catalog`, { session: owner })).body as { items: Array<{ title: string; year: number | null; mainGenre: string | null }> };
  assert.equal(catalog.items.find((item) => item.title === "Filme A 2026")?.year, 2026, "ocultar não apaga o valor");
  assert.deepEqual(await seriesKeys(), ["2025", "2026"], "a métrica por ano continua funcionando com a propriedade oculta");

  // o título: pode ganhar outro rótulo, nunca pode sumir
  assert.equal((await call("PATCH", `/api/catalog/libraries/${screens.id}/properties/title`, { session: owner, body: { hidden: true } })).response.status, 400);
  assert.equal((await call("PATCH", `/api/catalog/libraries/${screens.id}/properties/title`, { session: owner, body: { label: "Filme" } })).response.status, 200);

  // voltar ao padrão remove a sobrescrita em vez de guardar uma linha vazia
  await call("PATCH", `/api/catalog/libraries/${screens.id}/properties/year`, { session: owner, body: { label: null, hidden: false } });
  const overrides = await adminPool.query<{ property_key: string }>("SELECT property_key FROM catalog_native_property_configs WHERE library_id = $1", [screens.id]);
  assert.deepEqual(overrides.rows.map((row) => row.property_key), ["title"]);

  // uma propriedade personalizada usa exatamente a mesma chamada
  const def = await call("POST", `/api/groups/${gid}/catalog-attributes`, { session: owner, body: { kind: "film", label: "Diretor" } });
  assert.equal(def.response.status, 201, JSON.stringify(def.body));
  const defId = (def.body as { id: string; key: string }).id;
  const defKey = (def.body as { id: string; key: string }).key;
  const filmId = catalog.items.length && ((await adminPool.query<{ id: string }>("SELECT id FROM catalog_items WHERE group_id = $1 AND title = 'Filme A 2026'", [gid])).rows[0].id);
  await call("PATCH", `/api/catalog/${filmId}`, { session: owner, body: { attributes: { [defKey]: "Sofia Coppola" } } });
  const withDef = await props(screens.id);
  assert.equal(withDef.properties.find((property) => property.key === defId)?.storage, "attribute");
  await call("PATCH", `/api/catalog/libraries/${screens.id}/properties/${defId}`, { session: owner, body: { label: "Direção", hidden: true } });
  const afterHide = (await props(screens.id)).properties.find((property) => property.key === defId)!;
  assert.deepEqual([afterHide.label, afterHide.hidden], ["Direção", true]);
  const formAttrs = (await call("GET", `/api/groups/${gid}/catalog-attributes?kind=film`, { session: owner })).body as { attributes: unknown[] };
  assert.equal(formAttrs.attributes.length, 0, "oculta: fora dos formulários do dia a dia");
  const valueCount = await adminPool.query<{ n: string }>("SELECT count(*) AS n FROM catalog_attribute_values WHERE attribute_def_id = $1", [defId]);
  assert.equal(Number(valueCount.rows[0].n), 1, "o valor continua guardado");

  // só administrador personaliza; qualquer membro consulta
  assert.equal((await call("PATCH", `/api/catalog/libraries/${screens.id}/properties/year`, { session: member, body: { label: "Não" } })).response.status, 403);
  assert.equal((await call("GET", `/api/catalog/libraries/${screens.id}/properties`, { session: member })).response.status, 200);
});

test("capa da biblioteca: uma biblioteca sem ano nem nota escolhe o que aparece no topo e pode esconder o selo de nota", async () => {
  const owner = await register("Rafa", "rafa_capa");
  const member = await register("Iris", "iris_capa");
  const gid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Treinos" } })).body as { id: string }).id;
  const invite = await call("POST", `/api/groups/${gid}/invites`, { session: owner, body: { expiresInDays: 7, maxUses: 1 } });
  await call("POST", `/api/invites/${(invite.body as { token: string }).token}`, { session: member, body: {} });

  const lib = await call("POST", `/api/groups/${gid}/catalog/libraries`, { session: owner, body: { label: "Sessões de treino" } });
  assert.equal(lib.response.status, 201, JSON.stringify(lib.body));
  const library = lib.body as { id: string; coverTopProperty: string | null; coverBadgeHidden: boolean };
  assert.deepEqual([library.coverTopProperty, library.coverBadgeHidden], [null, false], "nasce no padrão: sem escolha própria");

  const def = await call("POST", `/api/groups/${gid}/catalog-attributes`, { session: owner, body: { libraryId: library.id, label: "Séries x repetições" } });
  assert.equal(def.response.status, 201, JSON.stringify(def.body));
  const attrKey = (def.body as { key: string }).key;

  // uma chave que não existe nesta biblioteca é recusada
  const invalid = await call("PATCH", `/api/catalog/libraries/${library.id}`, { session: owner, body: { coverTopProperty: "nao_existe" } });
  assert.equal(invalid.response.status, 400, JSON.stringify(invalid.body));

  // a chave semântica do atributo — a mesma que os itens usam — é aceita
  const setTop = await call("PATCH", `/api/catalog/libraries/${library.id}`, { session: owner, body: { coverTopProperty: attrKey } });
  assert.equal(setTop.response.status, 200, JSON.stringify(setTop.body));
  assert.equal((setTop.body as { coverTopProperty: string }).coverTopProperty, attrKey);

  const setBadge = await call("PATCH", `/api/catalog/libraries/${library.id}`, { session: owner, body: { coverBadgeHidden: true } });
  assert.equal(setBadge.response.status, 200, JSON.stringify(setBadge.body));
  assert.deepEqual(
    [(setBadge.body as { coverTopProperty: string; coverBadgeHidden: boolean }).coverTopProperty, (setBadge.body as { coverBadgeHidden: boolean }).coverBadgeHidden],
    [attrKey, true],
    "mudar um não reseta o outro",
  );

  const libraries = (await call("GET", `/api/groups/${gid}/catalog/libraries`, { session: owner })).body as {
    libraries: Array<{ id: string; coverTopProperty: string | null; coverBadgeHidden: boolean }>;
  };
  assert.deepEqual(
    [libraries.libraries.find((entry) => entry.id === library.id)?.coverTopProperty, libraries.libraries.find((entry) => entry.id === library.id)?.coverBadgeHidden],
    [attrKey, true],
    "a lista de bibliotecas devolve a escolha salva",
  );

  // "nenhum" é uma escolha explícita, diferente de voltar ao padrão (null)
  const setNone = await call("PATCH", `/api/catalog/libraries/${library.id}`, { session: owner, body: { coverTopProperty: "none" } });
  assert.equal((setNone.body as { coverTopProperty: string }).coverTopProperty, "none");
  const back = await call("PATCH", `/api/catalog/libraries/${library.id}`, { session: owner, body: { coverTopProperty: null } });
  assert.equal((back.body as { coverTopProperty: string | null }).coverTopProperty, null);

  // só administrador escolhe; qualquer membro só lê
  assert.equal((await call("PATCH", `/api/catalog/libraries/${library.id}`, { session: member, body: { coverBadgeHidden: false } })).response.status, 403);
});

test("propriedades da biblioteca: Tables nasce só com o nome e cada biblioteca tem as suas", async () => {
  const owner = await register("Tiago", "tiago_props");
  const gid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Rolês" } })).body as { id: string }).id;

  await call("POST", `/api/groups/${gid}/catalog/libraries`, { session: owner, body: { source: "tables" } });
  await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner, body: { recipe: "tables", title: "Onde comer", participantIds: [owner.user.id], items: [{ title: "Cantina" }] },
  });
  const matches = (await call("POST", `/api/groups/${gid}/catalog/libraries`, { session: owner, body: { label: "Matches" } })).body as { id: string };
  const libs = (await call("GET", `/api/groups/${gid}/catalog/libraries`, { session: owner })).body as { libraries: Array<{ id: string; source: string }> };
  const tables = libs.libraries.find((library) => library.source === "tables")!;
  const list = async (libraryId: string) =>
    (await call("GET", `/api/catalog/libraries/${libraryId}/properties`, { session: owner })).body as { properties: Array<{ key: string; storage: string; label: string | null }> };

  const starter = await list(tables.id);
  assert.deepEqual(starter.properties.filter((p) => p.storage === "attribute"), [], "nenhuma propriedade de partida além das nativas");
  assert.deepEqual(starter.properties.filter((p) => p.storage === "native").map((p) => p.key), ["title", "scheduled_at"], "fora film/book só o título e a data do evento são nativos");

  // "Kickoff" numa biblioteca Matches não aparece em Tables
  const kickoff = await call("POST", `/api/groups/${gid}/catalog-attributes`, { session: owner, body: { libraryId: matches.id, label: "Kickoff", type: "date" } });
  assert.equal(kickoff.response.status, 201, JSON.stringify(kickoff.body));
  const kickoffKey = (kickoff.body as { key: string }).key;
  assert.equal((await list(tables.id)).properties.some((p) => p.label === "Kickoff"), false);
  assert.deepEqual((await list(matches.id)).properties.filter((p) => p.storage === "attribute").map((p) => p.label), ["Kickoff"]);
  const forms = (await call("GET", `/api/groups/${gid}/catalog-attributes?libraryId=${matches.id}`, { session: owner })).body as { attributes: Array<{ label: string }> };
  assert.deepEqual(forms.attributes.map((a) => a.label), ["Kickoff"]);

  // e o valor entra ao criar o item da biblioteca
  const item = await call("POST", `/api/groups/${gid}/catalog/items`, {
    session: owner, body: { libraryId: matches.id, title: "Brasil x Argentina", attributes: { [kickoffKey]: "2026-06-15" } },
  });
  assert.equal(item.response.status, 201, JSON.stringify(item.body));
  const catalog = (await call("GET", `/api/groups/${gid}/catalog`, { session: owner })).body as { items: Array<{ title: string; attributes: Array<{ label: string; value: unknown }> }> };
  assert.deepEqual(catalog.items.find((entry) => entry.title === "Brasil x Argentina")?.attributes.map((a) => [a.label, a.value]), [["Kickoff", "2026-06-15"]]);
});

test("modelo de registros: um filme aceita mais de um tipo de registro por pessoa", async () => {
  const owner = await register("Íris", "iris_rec");
  const gid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Clube do modelo" } })).body as { id: string }).id;

  const challenge = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner,
    body: {
      recipe: "cinema", title: "Curadoria", startsOn: "2026-08-01", endsOn: "2026-12-31",
      participantIds: [owner.user.id],
      fields: [{ key: "nota", label: "Nota", type: "rating", required: true }],
      items: [{ title: "Aftersun" }, { title: "Petite Maman" }],
    },
  });
  const challengeId = (challenge.body as { id: string }).id;

  // um 2º entry_type ("expectativa") com seu próprio campo, direto no banco
  const expTypeId = "exp-type-iris";
  await adminPool.query(
    `INSERT INTO entry_types (id, challenge_id, semantic_key, name, submission_mode, created_at, updated_at)
     VALUES ($1, $2, 'expectativa', 'Expectativa', 'item', now(), now())`,
    [expTypeId, challengeId],
  );
  await adminPool.query(
    `INSERT INTO challenge_fields
       (id, challenge_id, entry_type_id, semantic_key, label, kind, required, position,
        number_scale, min_scaled, max_scaled, step_scaled, settings, created_at, updated_at)
     VALUES ($1, $2, $3, 'hype', 'Expectativa', 'rating', true, 0, 1, 0, 50, 5, '{}'::jsonb, now(), now())`,
    ["exp-field-iris", challengeId, expTypeId],
  );

  assert.equal((await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "active" } })).response.status, 200);

  const detail = await call("GET", `/api/challenges/${challengeId}`, { session: owner });
  const items = (detail.body as { items: Array<{ id: string; title: string }> }).items;
  const aftersun = items.find((item) => item.title === "Aftersun")!;

  // avaliação e expectativa do MESMO filme, pela MESMA pessoa, coexistem
  const rating = await call("POST", `/api/challenges/${challengeId}/entries`, { session: owner, body: { itemId: aftersun.id, values: { nota: 4 } } });
  assert.equal(rating.response.status, 201, JSON.stringify(rating.body));
  const expectation = await call("POST", `/api/challenges/${challengeId}/entries`, { session: owner, body: { itemId: aftersun.id, entryTypeId: expTypeId, values: { hype: 5 } } });
  assert.equal(expectation.response.status, 201, JSON.stringify(expectation.body));

  const rows = await adminPool.query<{ entry_type_id: string }>(
    "SELECT entry_type_id FROM entries WHERE item_id=$1 AND participant_user_id=$2 AND deleted_at IS NULL",
    [aftersun.id, owner.user.id],
  );
  assert.equal(rows.rows.length, 2, "dois registros de tipos diferentes no mesmo filme");

  // qualquer filme pode ser avaliado primeiro; nenhum checkpoint envolvido
  const petite = items.find((item) => item.title === "Petite Maman")!;
  assert.equal((await call("POST", `/api/challenges/${challengeId}/entries`, { session: owner, body: { itemId: petite.id, values: { nota: 3 } } })).response.status, 201);
  const checkpoints = await adminPool.query("SELECT id FROM challenge_checkpoints WHERE challenge_id=$1", [challengeId]);
  assert.equal(checkpoints.rows.length, 0, "cine não usa checkpoints");

  // "assistido no futuro" é recusado
  const future = await call("POST", `/api/challenges/${challengeId}/entries`, { session: owner, body: { itemId: petite.id, occurredOn: "2099-01-01", values: { nota: 2 } } });
  assert.equal(future.response.status, 409);
  assert.equal((future.body as { error: string }).error, "watch_in_future");
});

type DetailType = { id: string; purpose: string; semanticKey: string; cardinality: string; countsCompletion?: boolean };
type DetailItem = { id: string; title: string };

/**
 * The wizard's two recipes never seed an "expectation" type, but the surprise
 * metric and the expectation lock are generic machinery. Tests that exercise
 * them add the type straight in the database, the same way an admin add-on would.
 */
async function addExpectationType(challengeId: string, fieldKey = "expectativa"): Promise<string> {
  const typeId = crypto.randomUUID();
  await adminPool.query(
    `INSERT INTO entry_types
       (id, challenge_id, semantic_key, name, submission_mode, purpose, target_policy, cardinality, schedule_policy, created_at, updated_at)
     VALUES ($1, $2, 'expectativa', 'Expectativa', 'item', 'expectation', 'required', 'once_per_item', 'while_active', now(), now())`,
    [typeId, challengeId],
  );
  await adminPool.query(
    `INSERT INTO challenge_fields
       (id, challenge_id, entry_type_id, semantic_key, label, kind, required, position,
        number_scale, min_scaled, max_scaled, step_scaled, settings, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'Expectativa', 'rating', true, 0, 1, 0, 50, 5, '{}'::jsonb, now(), now())`,
    [crypto.randomUUID(), challengeId, typeId, fieldKey],
  );
  return typeId;
}

test("data do registro é opcional: uma rodada aceita registro sem data, mas o diário não", async () => {
  const owner = await register("Nina", "nina_semdata");
  const gid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Sem data" } })).body as { id: string }).id;
  const today = dateKeyInTimeZone(new Date(), "America/Sao_Paulo");

  const challenge = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner,
    body: {
      recipe: "cinema", title: "Cine livre", startsOn: "2026-08-01", endsOn: "2026-12-31",
      participantIds: [owner.user.id],
      fields: [{ key: "nota", label: "Nota", type: "rating", required: true }],
      items: [{ title: "Sem data" }, { title: "Vazio" }, { title: "Padrão hoje" }],
    },
  });
  const challengeId = (challenge.body as { id: string }).id;
  assert.equal((await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "active" } })).response.status, 200);
  const items = ((await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as { items: DetailItem[] }).items;
  const byTitle = (title: string) => items.find((item) => item.title === title)!;

  // `occurredOn: null` e `""` salvam o registro sem data
  const nullDate = await call("POST", `/api/challenges/${challengeId}/entries`, {
    session: owner, body: { itemId: byTitle("Sem data").id, occurredOn: null, values: { nota: 4 } },
  });
  assert.equal(nullDate.response.status, 201, JSON.stringify(nullDate.body));
  assert.equal((nullDate.body as { occurredOn: string | null }).occurredOn, null);
  const emptyDate = await call("POST", `/api/challenges/${challengeId}/entries`, {
    session: owner, body: { itemId: byTitle("Vazio").id, occurredOn: "", values: { nota: 3 } },
  });
  assert.equal(emptyDate.response.status, 201, JSON.stringify(emptyDate.body));
  assert.equal((emptyDate.body as { occurredOn: string | null }).occurredOn, null);

  // omitir a chave mantém o padrão "hoje"
  const omitted = await call("POST", `/api/challenges/${challengeId}/entries`, {
    session: owner, body: { itemId: byTitle("Padrão hoje").id, values: { nota: 5 } },
  });
  assert.equal(omitted.response.status, 201, JSON.stringify(omitted.body));
  assert.equal((omitted.body as { occurredOn: string }).occurredOn, today);

  const rows = await adminPool.query<{ occurred_on: string | null }>(
    "SELECT occurred_on::text AS occurred_on FROM entries WHERE challenge_id=$1 AND deleted_at IS NULL",
    [challengeId],
  );
  assert.equal(rows.rows.filter((row) => row.occurred_on === null).length, 2);

  // o histórico devolve o registro sem data sem quebrar
  const listed = ((await call("GET", `/api/challenges/${challengeId}/entries`, { session: owner })).body as {
    entries: Array<{ itemId: string | null; occurredOn: string | null }>;
  }).entries;
  assert.equal(listed.find((entry) => entry.itemId === byTitle("Sem data").id)?.occurredOn, null);

  // o progresso diário da Library ignora o "sem data" e cai no hoje
  const daily = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner,
    body: {
      recipe: "library", title: "Hábito", startsOn: "2026-08-01", endsOn: "2026-12-31",
      participantIds: [owner.user.id],
      items: [{ title: "Diário de leitura", author: "Nina" }],
    },
  });
  const dailyId = (daily.body as { id: string }).id;
  assert.equal((await call("POST", `/api/challenges/${dailyId}/transition`, { session: owner, body: { status: "active" } })).response.status, 200);
  const dailyDetail = (await call("GET", `/api/challenges/${dailyId}`, { session: owner })).body as {
    entryTypes: DetailType[]; items: DetailItem[]; fields: Array<{ id: string }>;
  };
  const progressType = dailyDetail.entryTypes.find((type) => type.purpose === "progress")!;
  const pagesField = dailyDetail.fields[0].id;
  const dailyEntry = await call("POST", `/api/challenges/${dailyId}/entries`, {
    session: owner,
    body: { itemId: dailyDetail.items[0].id, entryTypeId: progressType.id, occurredOn: null, values: { [pagesField]: 12 } },
  });
  assert.equal(dailyEntry.response.status, 201, JSON.stringify(dailyEntry.body));
  assert.equal((dailyEntry.body as { occurredOn: string }).occurredOn, today);
});

test("registros podem ser excluídos apenas pelo próprio autor, só com o desafio ativo", async () => {
  const owner = await register("Bea", "bea_entrydel");
  const author = await register("Caio", "caio_entrydel");
  const other = await register("Dora", "dora_entrydel");
  const stranger = await register("Edu", "edu_entrydel");
  const gid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Exclusão" } })).body as { id: string }).id;
  for (const member of [author, other]) {
    const invite = (await call("POST", `/api/groups/${gid}/invites`, {
      session: owner, body: { expiresInDays: 7, maxUses: 1 },
    })).body as { token: string };
    assert.equal((await call("POST", `/api/invites/${invite.token}`, { session: member, body: {} })).response.status, 200);
  }

  const challenge = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner,
    body: {
      recipe: "cinema", title: "Sessão exclusão", startsOn: "2026-08-01", endsOn: "2026-12-31",
      participantIds: [owner.user.id, author.user.id, other.user.id],
      fields: [{ key: "nota", label: "Nota", type: "rating", required: true }],
      items: [{ title: "Filme A" }, { title: "Filme B" }],
    },
  });
  assert.equal(challenge.response.status, 201, JSON.stringify(challenge.body));
  const challengeId = (challenge.body as { id: string }).id;
  assert.equal((await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "active" } })).response.status, 200);
  const items = ((await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as { items: DetailItem[] }).items;

  const mine = await call("POST", `/api/challenges/${challengeId}/entries`, {
    session: author, body: { itemId: items[0].id, values: { nota: 4 } },
  });
  const myEntryId = (mine.body as { id: string }).id;

  // um estranho não descobre o registro; outro participante não apaga registro alheio
  assert.equal((await call("DELETE", `/api/entries/${myEntryId}`, { session: stranger })).response.status, 404);
  assert.equal((await call("DELETE", `/api/entries/${myEntryId}`, { session: other })).response.status, 404);

  // o autor apaga o próprio e recria (o índice único liberou)
  assert.equal((await call("DELETE", `/api/entries/${myEntryId}`, { session: author })).response.status, 200);
  const again = await call("POST", `/api/challenges/${challengeId}/entries`, {
    session: author, body: { itemId: items[0].id, values: { nota: 2 } },
  });
  assert.equal(again.response.status, 201, "o índice único liberou após a exclusão");
  const againId = (again.body as { id: string }).id;
  assert.equal((await call("DELETE", `/api/entries/${againId}`, { session: author })).response.status, 200);
  assert.equal(
    ((await call("GET", `/api/challenges/${challengeId}/entries`, { session: owner })).body as { entries: unknown[] }).entries.length,
    0,
    "some das listagens após a exclusão",
  );

  // desafio encerrado não aceita exclusão
  const late = await call("POST", `/api/challenges/${challengeId}/entries`, {
    session: author, body: { itemId: items[0].id, values: { nota: 3 } },
  });
  const lateId = (late.body as { id: string }).id;
  await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "closed" } });
  const blocked = await call("DELETE", `/api/entries/${lateId}`, { session: author });
  assert.equal(blocked.response.status, 409);
  assert.equal((blocked.body as { error: string }).error, "challenge_not_active");
});

test("um participante comum vê os registros de todo mundo, não só os próprios", async () => {
  const owner = await register("Bia Registros", "bia_registros_todos");
  const first = await register("Caio Registros", "caio_registros_todos");
  const second = await register("Dara Registros", "dara_registros_todos");
  const outsider = await register("Estranho Registros", "estranho_registros_todos");
  const gid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Grupo Transparente" } })).body as { id: string }).id;
  for (const member of [first, second]) {
    const invite = (await call("POST", `/api/groups/${gid}/invites`, { session: owner, body: { expiresInDays: 7, maxUses: 1 } })).body as { token: string };
    assert.equal((await call("POST", `/api/invites/${invite.token}`, { session: member, body: {} })).response.status, 200);
  }

  const challenge = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner,
    body: {
      recipe: "cinema", title: "Sessão transparente", startsOn: "2026-08-01", endsOn: "2026-12-31",
      participantIds: [owner.user.id, first.user.id, second.user.id],
      fields: [{ key: "nota", label: "Nota", type: "rating", required: true }],
      items: [{ title: "Filme Único" }],
    },
  });
  const challengeId = (challenge.body as { id: string }).id;
  assert.equal((await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "active" } })).response.status, 200);
  const items = ((await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as { items: DetailItem[] }).items;

  await call("POST", `/api/challenges/${challengeId}/entries`, { session: first, body: { itemId: items[0].id, values: { nota: 5 } } });
  await call("POST", `/api/challenges/${challengeId}/entries`, { session: second, body: { itemId: items[0].id, values: { nota: 2 } } });

  const seenBySecond = (await call("GET", `/api/challenges/${challengeId}/entries`, { session: second })).body as { entries: Array<{ participantName: string }> };
  assert.equal(seenBySecond.entries.length, 2, "um participante comum vê os registros de todo mundo, não só o próprio");
  assert.ok(seenBySecond.entries.some((entry) => entry.participantName === "Caio Registros"), "inclui a nota de outra pessoa");

  assert.equal((await call("GET", `/api/challenges/${challengeId}/entries`, { session: outsider })).response.status, 404, "quem não participa continua sem acesso");
});

test("fundação: dois livros no mesmo dia, conclusão e nota sem comentário", async () => {
  const owner = await register("Lúcia", "lucia_found");
  const gid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Clube de leitura" } })).body as { id: string }).id;

  const period = { startsOn: "2024-05-01", endsOn: "2024-06-30" };

  // livro sem autor é recusado — autor é obrigatório para a Library
  const noAuthor = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner,
    body: {
      recipe: "library", title: "Sem autor", ...period, participantIds: [owner.user.id],
      items: [{ title: "Norwegian Wood" }],
    },
  });
  assert.equal(noAuthor.response.status, 400, "livro precisa de autor");
  assert.equal((noAuthor.body as { error: string }).error, "invalid_item");

  const created = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner,
    body: {
      recipe: "library", title: "Temporada 1", ...period, participantIds: [owner.user.id],
      items: [
        { title: "Norwegian Wood", author: "Haruki Murakami" },
        { title: "Kafka à Beira-Mar", author: "Haruki Murakami" },
      ],
    },
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  const challengeId = (created.body as { id: string }).id;
  assert.equal((await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "active" } })).response.status, 200);

  const detail = await call("GET", `/api/challenges/${challengeId}`, { session: owner });
  const types = (detail.body as { entryTypes: DetailType[] }).entryTypes;
  const items = (detail.body as { items: DetailItem[] }).items;
  const progress = types.find((type) => type.purpose === "progress")!;
  const completion = types.find((type) => type.purpose === "completion")!;
  assert.equal(progress.cardinality, "once_per_item_day");
  assert.equal(completion.countsCompletion, true);
  const norwegian = items.find((item) => item.title === "Norwegian Wood")!;
  const kafka = items.find((item) => item.title === "Kafka à Beira-Mar")!;

  const day = "2024-05-10";
  for (const book of [norwegian, kafka]) {
    const res = await call("POST", `/api/challenges/${challengeId}/entries`, {
      session: owner,
      body: { itemId: book.id, entryTypeId: progress.id, occurredOn: day, values: { paginas: 40 } },
    });
    assert.equal(res.response.status, 201, JSON.stringify(res.body));
  }
  // "Terminei" is an event; the nota rides along, no comment required.
  assert.equal((await call("POST", `/api/challenges/${challengeId}/entries`, {
    session: owner, body: { itemId: norwegian.id, entryTypeId: completion.id, values: { nota: 5 } },
  })).response.status, 201);

  const rows = await adminPool.query<{ purpose: string; item_id: string; occurred_on: string }>(
    `SELECT t.purpose, e.item_id, e.occurred_on::text AS occurred_on
       FROM entries e JOIN entry_types t ON t.id = e.entry_type_id
      WHERE e.challenge_id = $1 AND e.deleted_at IS NULL
      ORDER BY t.purpose, e.item_id`,
    [challengeId],
  );
  const byPurpose = (name: string) => rows.rows.filter((row) => row.purpose === name);
  assert.equal(byPurpose("progress").length, 2, "um progresso por livro no mesmo dia");
  assert.deepEqual(byPurpose("progress").map((row) => row.occurred_on), [day, day]);
  assert.equal(byPurpose("completion").length, 1, "uma conclusão, no livro certo");
  assert.equal(byPurpose("completion")[0].item_id, norwegian.id);

  const commentValues = await adminPool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM entry_values ev
       JOIN challenge_fields f ON f.id = ev.field_id
      WHERE ev.challenge_id = $1 AND f.kind = 'text'`,
    [challengeId],
  );
  assert.equal(commentValues.rows[0].count, 0, "o sistema soube de qual livro sem exigir comentário");

  // progresso no mesmo livro e dia atualiza em vez de duplicar
  const again = await call("POST", `/api/challenges/${challengeId}/entries`, {
    session: owner, body: { itemId: norwegian.id, entryTypeId: progress.id, occurredOn: day, values: { paginas: 55 } },
  });
  assert.equal((again.body as { updated?: boolean }).updated, true);

  // #9c: a nota do livro fica no tipo `completion`; a memória do acervo enxerga.
  const bookCatalog = (await call("GET", `/api/groups/${gid}/catalog`, { session: owner })).body as {
    items: Array<{ title: string; author: string | null; ratingAvg: number | null; ratingCount: number }>;
  };
  const norwegianCatalog = bookCatalog.items.find((entry) => entry.title === "Norwegian Wood");
  assert.equal(norwegianCatalog?.ratingCount, 1, "avaliação de livro no tipo completion conta no acervo");
  assert.equal(norwegianCatalog?.ratingAvg, 5);
  assert.equal(norwegianCatalog?.author, "Haruki Murakami", "autor do livro fica no acervo");
  assert.equal(
    (detail.body as { items: Array<{ title: string; catalogItem: { author: string | null } | null }> })
      .items.find((item) => item.title === "Norwegian Wood")?.catalogItem?.author,
    "Haruki Murakami",
    "autor aparece no item do desafio",
  );
});

test("expectativa e avaliação coexistem, e a expectativa trava ao avaliar", async () => {
  const owner = await register("Théo", "theo_cur");
  const gid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Curadoria" } })).body as { id: string }).id;

  const created = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner,
    body: {
      recipe: "cinema", title: "Ciclo Lynch", startsOn: "2026-08-01", endsOn: "2026-12-31",
      participantIds: [owner.user.id],
      items: [{ title: "Mulholland Drive" }],
    },
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  const challengeId = (created.body as { id: string }).id;
  await addExpectationType(challengeId);
  assert.equal((await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "active" } })).response.status, 200);

  const detail = await call("GET", `/api/challenges/${challengeId}`, { session: owner });
  const types = (detail.body as { entryTypes: DetailType[] }).entryTypes;
  const items = (detail.body as { items: DetailItem[] }).items;
  const expectation = types.find((type) => type.purpose === "expectation")!;
  const rating = types.find((type) => type.purpose === "rating")!;
  const film = items[0];

  assert.equal((await call("POST", `/api/challenges/${challengeId}/entries`, {
    session: owner, body: { itemId: film.id, entryTypeId: expectation.id, values: { expectativa: 5 } },
  })).response.status, 201);
  assert.equal((await call("POST", `/api/challenges/${challengeId}/entries`, {
    session: owner, body: { itemId: film.id, entryTypeId: rating.id, values: { nota: 3 } },
  })).response.status, 201);

  const coexist = await adminPool.query<{ purpose: string }>(
    `SELECT t.purpose FROM entries e JOIN entry_types t ON t.id = e.entry_type_id
      WHERE e.item_id = $1 AND e.deleted_at IS NULL ORDER BY t.purpose`,
    [film.id],
  );
  assert.deepEqual(coexist.rows.map((row) => row.purpose), ["expectation", "rating"]);

  // a expectativa não pode mais mudar depois da avaliação
  const locked = await call("POST", `/api/challenges/${challengeId}/entries`, {
    session: owner, body: { itemId: film.id, entryTypeId: expectation.id, values: { expectativa: 1 } },
  });
  assert.equal(locked.response.status, 409);
  assert.equal((locked.body as { error: string }).error, "expectation_locked");

  const expEntry = await adminPool.query<{ id: string }>(
    `SELECT e.id FROM entries e JOIN entry_types t ON t.id = e.entry_type_id
      WHERE e.item_id = $1 AND t.purpose = 'expectation' AND e.deleted_at IS NULL`,
    [film.id],
  );
  const patchLocked = await call("PATCH", `/api/entries/${expEntry.rows[0].id}`, {
    session: owner, body: { values: { expectativa: 2 } },
  });
  assert.equal(patchLocked.response.status, 409);
});

test("cópia: carrega a receita, zera a agenda e remapeia o acervo do destino", async () => {
  const owner = await register("Ravi", "ravi_copy");
  const source = ((await call("POST", "/api/groups", { session: owner, body: { name: "Origem" } })).body as { id: string }).id;
  const target = ((await call("POST", "/api/groups", { session: owner, body: { name: "Destino" } })).body as { id: string }).id;

  const created = await call("POST", `/api/groups/${source}/challenges`, {
    session: owner,
    body: {
      recipe: "cinema", title: "Sessão", startsOn: "2026-08-01", endsOn: "2026-12-31",
      participantIds: [owner.user.id],
      items: [{ title: "Stalker", year: 1979, mainGenre: "ficção científica" }],
    },
  });
  const sourceId = (created.body as { id: string }).id;
  await addExpectationType(sourceId);

  const copy = await call("POST", `/api/challenges/${sourceId}/duplicate`, {
    session: owner, body: { title: "Sessão — bis", targetGroupId: target },
  });
  assert.equal(copy.response.status, 201, JSON.stringify(copy.body));
  const copyId = (copy.body as { id: string }).id;

  const row = await adminPool.query<{
    recipe_key: string; start_date: string | null; checkpoints: number;
    purposes: string[]; catalog_group: string | null; recommender: string | null; catalog_title: string | null;
  }>(
    `SELECT c.recipe_key, c.start_date::text AS start_date,
            (SELECT count(*)::int FROM challenge_checkpoints WHERE challenge_id = c.id) AS checkpoints,
            (SELECT array_agg(t.purpose ORDER BY t.purpose) FROM entry_types t WHERE t.challenge_id = c.id) AS purposes,
            (SELECT ci.group_id FROM challenge_items i JOIN catalog_items ci ON ci.id = i.catalog_item_id
              WHERE i.challenge_id = c.id LIMIT 1) AS catalog_group,
            (SELECT ci.title FROM challenge_items i JOIN catalog_items ci ON ci.id = i.catalog_item_id
              WHERE i.challenge_id = c.id LIMIT 1) AS catalog_title,
            (SELECT i.recommended_by_user_id FROM challenge_items i WHERE i.challenge_id = c.id LIMIT 1) AS recommender
       FROM challenges c WHERE c.id = $1`,
    [copyId],
  );
  assert.equal(row.rows[0].recipe_key, "cinema");
  assert.equal(row.rows[0].start_date, null);
  assert.equal(row.rows[0].checkpoints, 0);
  assert.deepEqual(row.rows[0].purposes, ["expectation", "rating"]);
  assert.equal(row.rows[0].catalog_group, target, "o item aponta para o acervo do grupo de destino");
  assert.equal(row.rows[0].catalog_title, "Stalker");
  assert.equal(row.rows[0].recommender, null, "o indicador do grupo de origem não é copiado");
});

type SeriesRow = {
  key: string; label: string; value: number | null; sampleSize: number;
  recommendedBy?: string | null; year?: number | null; rawValue?: number | null; rawFormattedValue?: string;
};
type ApiMetric = { id: string; label: string; operation: string; groupBy: string; minSample?: number; value: number | null; series?: SeriesRow[] };

test("motor de análise: ranking ajustado, surpresa, viés e vitrine automática", async () => {
  const owner = await register("Ana", "ana_an");
  const bob = await register("Bruno", "bruno_an");
  const carol = await register("Carla", "carla_an");
  const gid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Cineclube" } })).body as { id: string }).id;
  for (const person of [bob, carol]) {
    await adminPool.query(
      "INSERT INTO group_members (group_id, user_id, role, added_by_user_id, joined_at) VALUES ($1,$2,'participant',$3,now()) ON CONFLICT DO NOTHING",
      [gid, person.user.id, owner.user.id],
    );
  }

  const created = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner,
    body: {
      recipe: "cinema", title: "Ciclo 1", startsOn: "2026-08-01", endsOn: "2026-12-31",
      participantIds: [owner.user.id, bob.user.id, carol.user.id],
      items: [
        { title: "Solaris", recommendedByUserId: owner.user.id },
        { title: "Persona" },
      ],
    },
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  const challengeId = (created.body as { id: string }).id;
  await addExpectationType(challengeId);

  const detail0 = await call("GET", `/api/challenges/${challengeId}`, { session: owner });
  const types = (detail0.body as { entryTypes: Array<{ id: string; purpose: string; fields: Array<{ id: string; key: string }> }> }).entryTypes;
  const items = (detail0.body as { items: Array<{ id: string; title: string }> }).items;
  const expType = types.find((t) => t.purpose === "expectation")!.id;
  const ratingEntryType = types.find((t) => t.purpose === "rating")!;
  const ratingType = ratingEntryType.id;
  const notaFieldId = ratingEntryType.fields.find((field) => field.key === "nota")!.id;
  const surpriseMetric = await call("POST", `/api/challenges/${challengeId}/metrics`, {
    session: owner,
    body: { label: "Surpresa × decepção", operation: "surprise", fieldId: notaFieldId, groupBy: "item", minSample: 2 },
  });
  assert.equal(surpriseMetric.response.status, 201, JSON.stringify(surpriseMetric.body));
  assert.equal((await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "active" } })).response.status, 200);
  const solaris = items.find((i) => i.title === "Solaris")!.id;
  const persona = items.find((i) => i.title === "Persona")!.id;

  const log = (session: ClientSession, itemId: string, typeId: string, values: Record<string, number>) =>
    call("POST", `/api/challenges/${challengeId}/entries`, { session, body: { itemId, entryTypeId: typeId, values } });

  // Solaris: high expectations, delivered. Persona: only Ana rates it (thin sample).
  await log(owner, solaris, expType, { expectativa: 3 });
  await log(bob, solaris, expType, { expectativa: 3 });
  await log(carol, solaris, expType, { expectativa: 3 });
  await log(owner, solaris, ratingType, { nota: 5 });
  await log(bob, solaris, ratingType, { nota: 5 });
  await log(carol, solaris, ratingType, { nota: 4 });
  await log(owner, persona, ratingType, { nota: 2 });

  assert.equal((await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "closed" } })).response.status, 200);

  const detail = await call("GET", `/api/challenges/${challengeId}`, { session: owner });
  const metrics = (detail.body as { metrics: ApiMetric[] }).metrics;

  const ranking = metrics.find((m) => m.operation === "bayesian_average")!;
  assert.ok(Array.isArray(ranking.series), "ranking traz série");
  assert.equal(ranking.series![0].label, "Solaris", "Solaris no topo do ranking ajustado");
  const personaRow = ranking.series!.find((s) => s.label === "Persona")!;
  assert.equal(personaRow.value, null, "Persona abaixo do mínimo de amostra (minSample 2) fica sem valor");
  assert.equal(personaRow.sampleSize, 1);

  const surprise = metrics.find((m) => m.operation === "surprise")!;
  const solarisSurprise = surprise.series!.find((s) => s.label === "Solaris")!;
  assert.ok(solarisSurprise.value !== null && solarisSurprise.value > 0, "Solaris superou a expectativa");

  const bias = metrics.find((m) => m.operation === "indicator_bias")!;
  const anaBias = bias.series!.find((s) => s.label === "Ana");
  assert.ok(anaBias && anaBias.value !== null, "viés do indicador calculado para quem indicou");

  // a vitrine foi gerada sozinha ao encerrar — só os blocos derivados (métricas,
  // rankings, comentários). Nenhum texto é gerado: nem manchete, nem resumo.
  const blocks = await adminPool.query<{ kind: string; heading: string | null }>(
    "SELECT kind, heading FROM result_blocks WHERE challenge_id=$1 ORDER BY position",
    [challengeId],
  );
  assert.ok(!blocks.rows.some((b) => b.kind === "text"), "nenhum texto (manchete/resumo) é gerado automaticamente");
  assert.ok(blocks.rows.some((b) => b.kind === "metric"), "vitrine automática tem blocos de métrica");

  // o admin escreve a manchete e o resumo na aba Vitrine
  assert.equal((await call("POST", `/api/challenges/${challengeId}/results`, {
    session: owner, body: { headline: "O ano em que Solaris venceu", summary: "Três pessoas, dois filmes, muita conversa." },
  })).response.status, 200);

  // reabrir e fechar de novo NÃO apaga o texto do admin — só recalcula as métricas
  assert.equal((await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "active" } })).response.status, 200);
  assert.equal((await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "closed" } })).response.status, 200);
  const afterReopen = await adminPool.query<{ kind: string; heading: string | null; body_snapshot: string | null }>(
    "SELECT kind, heading, body_snapshot FROM result_blocks WHERE challenge_id=$1 AND kind='text' ORDER BY position",
    [challengeId],
  );
  assert.deepEqual(
    afterReopen.rows.map((b) => [b.heading, b.body_snapshot]),
    [["headline", "O ano em que Solaris venceu"], ["summary", "Três pessoas, dois filmes, muita conversa."]],
    "manchete e resumo sobrevivem ao ciclo reabrir/fechar",
  );

});

test("memória do acervo: um filme reconhecido em duas rodadas encerradas", async () => {
  const owner = await register("Dora", "dora_mem");
  const gid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Memória" } })).body as { id: string }).id;

  async function runRound(title: string, notas: number[]) {
    const res = await call("POST", `/api/groups/${gid}/challenges`, {
      session: owner,
      body: {
        recipe: "cinema", title, startsOn: "2026-08-01", endsOn: "2026-12-31",
        participantIds: [owner.user.id], items: [{ title: "Stalker", year: 1979 }],
      },
    });
    const cid = (res.body as { id: string }).id;
    assert.equal((await call("POST", `/api/challenges/${cid}/transition`, { session: owner, body: { status: "active" } })).response.status, 200);
    const item = ((await call("GET", `/api/challenges/${cid}`, { session: owner })).body as { items: Array<{ id: string }> }).items[0].id;
    for (const nota of notas) {
      // one participant, so update the same entry — use distinct rounds instead
      await call("POST", `/api/challenges/${cid}/entries`, { session: owner, body: { itemId: item, values: { nota } } });
    }
    await call("POST", `/api/challenges/${cid}/transition`, { session: owner, body: { status: "closed" } });
    return cid;
  }

  await runRound("Ciclo A", [4]);
  await runRound("Ciclo B", [2]);

  const list = (await call("GET", `/api/groups/${gid}/catalog`, { session: owner })).body as {
    items: Array<{ id: string; title: string; roundCount: number; ratingAvg: number | null; ratingCount: number }>;
  };
  const stalker = list.items.find((i) => i.title === "Stalker")!;
  assert.equal(stalker.roundCount, 2, "o mesmo filme aparece em 2 rodadas");
  assert.equal(stalker.ratingCount, 2);
  assert.equal(stalker.ratingAvg, 3, "média histórica das duas notas");

  const detail = (await call("GET", `/api/groups/${gid}/catalog/${stalker.id}`, { session: owner })).body as {
    rounds: Array<{ title: string; ratingAvg: number | null; ratingCount: number }>;
  };
  assert.deepEqual(detail.rounds.map((r) => r.title), ["Ciclo A", "Ciclo B"]);
  assert.deepEqual(detail.rounds.map((r) => r.ratingAvg), [4, 2]);
});

test("excluir do acervo: bloqueado enquanto o desafio corre, permitido depois, e escondido do seletor", async () => {
  const owner = await register("Bea", "bea_del");
  const member = await register("Caio", "caio_del");
  const gid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Curadoria" } })).body as { id: string }).id;
  const inv = (await call("POST", `/api/groups/${gid}/invites`, { session: owner, body: { expiresInDays: 7, maxUses: 1 } })).body as { token: string };
  await call("POST", `/api/invites/${inv.token}`, { session: member, body: {} });

  const created = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner,
    body: {
      recipe: "cinema", title: "Ciclo Herzog", startsOn: "2026-08-01", endsOn: "2026-12-31",
      participantIds: [owner.user.id], items: [{ title: "Fitzcarraldo", year: 1982 }, { title: "Stroszek", year: 1977 }],
    },
  });
  const challengeId = (created.body as { id: string }).id;
  assert.equal((await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "active" } })).response.status, 200);

  const catalog = (await call("GET", `/api/groups/${gid}/catalog`, { session: owner })).body as { items: Array<{ id: string; title: string }> };
  const fitz = catalog.items.find((i) => i.title === "Fitzcarraldo")!;

  const member403 = await call("DELETE", `/api/catalog/${fitz.id}`, { session: member });
  assert.equal(member403.response.status, 403, "participante comum não exclui do acervo");

  const blocked = await call("DELETE", `/api/catalog/${fitz.id}`, { session: owner });
  assert.equal(blocked.response.status, 409, JSON.stringify(blocked.body));
  assert.equal((blocked.body as { error: string }).error, "catalog_item_in_use");

  assert.equal((await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "closed" } })).response.status, 200);

  const gone = await call("DELETE", `/api/catalog/${fitz.id}`, { session: owner });
  assert.equal(gone.response.status, 200, JSON.stringify(gone.body));
  assert.equal((gone.body as { archived: boolean }).archived, true);

  const after = (await call("GET", `/api/groups/${gid}/catalog`, { session: owner })).body as { items: Array<{ title: string }> };
  assert.deepEqual(after.items.map((i) => i.title), ["Stroszek"], "só o item excluído sai da lista");
  assert.equal((await call("GET", `/api/groups/${gid}/catalog/${fitz.id}`, { session: owner })).response.status, 404, "a página do item excluído some");
  const challengeDetail = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    items: Array<{ catalogItem: { title: string } | null }>;
  };
  assert.ok(
    challengeDetail.items.some((it) => it.catalogItem?.title === "Fitzcarraldo"),
    "a rodada encerrada continua mostrando o filme",
  );
  assert.equal((await call("DELETE", `/api/catalog/${fitz.id}`, { session: owner })).response.status, 404, "excluir de novo é 404");

  const auditRows = await adminPool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM audit_events WHERE group_id=$1 AND action='catalog.item_archived'",
    [gid],
  );
  assert.equal(auditRows.rows[0].count, 1);

  // acervo pessoal: a lista viva (sem datas) nasce ativa e o item é sempre removível
  const personal = await call("POST", "/api/personal/challenges", {
    session: owner,
    body: { recipe: "cinema", title: "Minha lista", startsOn: null, endsOn: null, items: [{ title: "Aguirre", year: 1972 }] },
  });
  const personalId = (personal.body as { id: string }).id;
  assert.equal((personal.body as { status: string }).status, "active", "lista pessoal sem datas nasce ativa");
  assert.equal((personal.body as { kind: string }).kind, "list", "e vira uma categoria kind='list', não só um status");
  const noClose = await call("POST", `/api/challenges/${personalId}/transition`, { session: owner, body: { status: "closed" } });
  assert.equal(noClose.response.status, 409, "uma lista viva não é encerrada");
  assert.equal((noClose.body as { error: string }).error, "living_list_no_close");

  const personalCatalog = (await call("GET", "/api/personal/catalog", { session: owner })).body as { items: Array<{ id: string; title: string }> };
  const aguirre = personalCatalog.items.find((i) => i.title === "Aguirre")!;
  assert.equal((await call("DELETE", `/api/personal/catalog/${aguirre.id}`, { session: owner })).response.status, 200, "o acervo pessoal de uma lista viva é podável mesmo ativa");
  assert.deepEqual(
    ((await call("GET", "/api/personal/catalog", { session: owner })).body as { items: unknown[] }).items,
    [],
    "acervo pessoal fica vazio",
  );
});

test("apagar um desafio arquiva do acervo só os itens órfãos, mantendo os que outra rodada ainda usa", async () => {
  const owner = await register("Dona Acervo Órfão", "dona_acervo_orfao");
  const groupId = ((await call("POST", "/api/groups", { session: owner, body: { name: "Clube Órfão" } })).body as { id: string }).id;

  const first = await call("POST", `/api/groups/${groupId}/challenges`, {
    session: owner,
    body: {
      recipe: "cinema", title: "Rodada 1", startsOn: "2026-01-01", endsOn: "2026-02-01",
      participantIds: [owner.user.id],
      items: [{ title: "Filme Compartilhado", year: 2000 }, { title: "Só da Rodada 1", year: 2001 }],
    },
  });
  assert.equal(first.response.status, 201, JSON.stringify(first.body));

  const second = await call("POST", `/api/groups/${groupId}/challenges`, {
    session: owner,
    body: {
      recipe: "cinema", title: "Rodada 2", startsOn: "2026-03-01", endsOn: "2026-04-01",
      participantIds: [owner.user.id],
      items: [{ title: "Filme Compartilhado", year: 2000 }, { title: "Só da Rodada 2", year: 2002 }],
    },
  });
  const secondId = (second.body as { id: string }).id;
  assert.equal(second.response.status, 201, JSON.stringify(second.body));

  const catalogBefore = (await call("GET", `/api/groups/${groupId}/catalog`, { session: owner })).body as { items: Array<{ title: string }> };
  assert.deepEqual(
    catalogBefore.items.map((item) => item.title).sort(),
    ["Filme Compartilhado", "Só da Rodada 1", "Só da Rodada 2"],
    "as três entradas convivem no acervo antes de qualquer exclusão",
  );

  assert.equal((await call("DELETE", `/api/challenges/${secondId}`, { session: owner })).response.status, 200);

  const catalogAfter = (await call("GET", `/api/groups/${groupId}/catalog`, { session: owner })).body as { items: Array<{ title: string }> };
  assert.deepEqual(
    catalogAfter.items.map((item) => item.title).sort(),
    ["Filme Compartilhado", "Só da Rodada 1"],
    "só o item exclusivo da rodada apagada some; o compartilhado com a rodada 1 continua",
  );

  const orphanAudit = await adminPool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM audit_events WHERE group_id = $1 AND action = 'catalog.item_archived' AND metadata->>'reason' = 'challenge_deleted'",
    [groupId],
  );
  assert.equal(orphanAudit.rows[0]?.count, 1, "a limpeza automática de órfãos fica auditada");
});

test("item + checkpoint são ortogonais: um registro carrega filme e sessão", async () => {
  const owner = await register("Ícaro", "icaro_ortho");
  const gid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Sessões" } })).body as { id: string }).id;

  // Nenhuma receita do wizard produz checkpoints materializados + itens ao mesmo
  // tempo; montamos a combinação à mão sobre um desafio de Cinema para provar que
  // um registro carrega os dois eixos.
  const created = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner,
    body: {
      recipe: "cinema", title: "Ciclo de sessões",
      startsOn: "2024-03-01", endsOn: "2024-03-03",
      participantIds: [owner.user.id],
      fields: [{ key: "nota", label: "Nota", type: "rating", required: true }],
      items: [{ title: "placeholder" }],
    },
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  const challengeId = (created.body as { id: string }).id;

  const sessionIds: string[] = [];
  for (let day = 0; day < 3; day += 1) {
    const id = crypto.randomUUID();
    sessionIds.push(id);
    await adminPool.query(
      `INSERT INTO challenge_checkpoints
         (id, challenge_id, semantic_key, title, position, starts_at, due_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz, now(), now())`,
      [id, challengeId, `dia_${day + 1}`, `Sessão ${day + 1}`, day,
        `2024-03-0${day + 1} 00:00:00-03`, `2024-03-0${day + 1} 23:59:59-03`],
    );
  }
  const sessionId = sessionIds[0];
  await adminPool.query(
    `UPDATE entry_types SET submission_mode='daily', schedule_policy='checkpoint',
       cardinality='once_per_item_day', target_policy='required'
      WHERE challenge_id=$1`,
    [challengeId],
  );
  const itemId = crypto.randomUUID();
  await adminPool.query(
    `INSERT INTO challenge_items (id, challenge_id, checkpoint_id, semantic_key, title, position, metadata, created_at, updated_at)
     VALUES ($1,$2,$3,'sessao_1','Solaris',1,'{}'::jsonb,now(),now())`,
    [itemId, challengeId, sessionId]);

  assert.equal((await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "active" } })).response.status, 200);
  const detailBody = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    fields: Array<{ id: string }>;
    items: Array<{ id: string; checkpointId: string | null }>;
    checkpoints: Array<{ id: string }>;
  };
  assert.equal(detailBody.checkpoints.length, 3, "o detalhe traz checkpoints como array próprio");
  assert.equal(detailBody.items.find((i) => i.id === itemId)?.checkpointId, sessionId, "o item aponta para a sessão");
  const field = detailBody.fields[0].id;

  const saved = await call("POST", `/api/challenges/${challengeId}/entries`, {
    session: owner, body: { itemId, checkpointId: sessionId, values: { [field]: 4 } },
  });
  assert.equal(saved.response.status, 201, JSON.stringify(saved.body));
  assert.equal((saved.body as { itemId: string }).itemId, itemId);
  assert.equal((saved.body as { checkpointId: string }).checkpointId, sessionId);

  const entryRow = await adminPool.query<{ item_id: string | null; checkpoint_id: string | null }>(
    "SELECT item_id, checkpoint_id FROM entries WHERE challenge_id=$1 AND deleted_at IS NULL", [challengeId]);
  assert.equal(entryRow.rows[0].item_id, itemId, "item_id persistido");
  assert.equal(entryRow.rows[0].checkpoint_id, sessionId, "checkpoint_id persistido, sem exclusão mútua");
});

test("o console da plataforma não vê texto privado: auditoria redigida e nada de conteúdo pessoal", async () => {
  const admin = await register("Plataforma", "plataforma_admin_priv");
  await adminPool.query("UPDATE users SET platform_admin = true WHERE id = $1", [admin.user.id]);
  const adminSession = await login("plataforma_admin_priv");

  const owner = await register("Dono Privado", "dono_privado_console");
  const gid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Grupo Público de Nome" } })).body as { id: string }).id;
  const challenge = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner,
    body: {
      recipe: "cinema",
      title: "Desafio de Grupo",
      description: "Uma descrição bem longa e cheia de detalhes privados que o admin da plataforma jamais deveria ler na auditoria de jeito nenhum.",
      participantIds: [owner.user.id], items: [{ title: "Persona" }],
    },
  });
  const challengeId = (challenge.body as { id: string }).id;
  await call("PATCH", `/api/challenges/${challengeId}`, {
    session: owner,
    body: { description: "Segunda versão da descrição privada, também longa o bastante para ser considerada prosa e portanto redigida." },
  });

  const audit = (await call("GET", `/api/admin/audit?groupId=${gid}`, { session: adminSession })).body as {
    events: Array<{ before: unknown; after: unknown }>;
  };
  const dump = JSON.stringify(audit.events);
  assert.doesNotMatch(dump, /detalhes privados|descrição privada/, "a prosa da descrição não aparece na auditoria da plataforma");
  assert.match(dump, /texto omitido/, "o campo que mudou continua visível, só o texto é substituído");

  // The platform admin has no bin listing at all.
  assert.equal((await call("GET", "/api/admin/trash", { session: adminSession })).response.status, 404);

  // A personal challenge's audit rows carry no title/text for the platform admin.
  const personal = await call("POST", "/api/personal/challenges", {
    session: owner,
    body: { recipe: "cinema", title: "Meu Diário Secreto de Filmes", startsOn: null, endsOn: null, items: [{ title: "Stalker" }] },
  });
  const personalId = (personal.body as { id: string }).id;
  await call("DELETE", `/api/challenges/${personalId}`, { session: owner });

  const allAudit = (await call("GET", "/api/admin/audit", { session: adminSession })).body as {
    events: Array<{ action: string; personalScope?: boolean; before: unknown; after: unknown; challengeId: string | null }>;
  };
  assert.doesNotMatch(JSON.stringify(allAudit.events), /Diário Secreto/, "o título do desafio pessoal não aparece na auditoria da plataforma");
  const personalEvents = allAudit.events.filter((event) => event.personalScope);
  assert.ok(personalEvents.length > 0, "eventos do espaço pessoal ainda aparecem — só sem conteúdo");
  assert.ok(personalEvents.every((event) => event.before === null && event.after === null && event.challengeId === null),
    "eventos pessoais chegam sem before/after nem IDs de conteúdo");
});

test("homepage: fixar, marcar cor e reordenar são preferências privadas do usuário", async () => {
  const owner = await register("Dona Home", "dona_home_v1");
  const stranger = await register("Estranho Home", "estranho_home_v1");
  const groupId = ((await call("POST", "/api/groups", { session: owner, body: { name: "Clube Home" } })).body as { id: string }).id;
  const mk = async (title: string) =>
    ((await call("POST", `/api/groups/${groupId}/challenges`, {
      session: owner,
      body: { recipe: "cinema", title, participantIds: [owner.user.id], items: [{ title: "Filme" }] },
    })).body as { id: string }).id;
  const a = await mk("Alfa");
  const b = await mk("Beta");
  const c = await mk("Gama");

  // Pin one, colour another.
  assert.equal((await call("PATCH", `/api/challenges/${a}/prefs`, { session: owner, body: { pinned: true } })).response.status, 200);
  assert.equal((await call("PATCH", `/api/challenges/${b}/prefs`, { session: owner, body: { colorTag: "green" } })).response.status, 200);
  assert.equal(
    (await call("PATCH", `/api/challenges/${b}/prefs`, { session: owner, body: { colorTag: "chartreuse" } })).response.status,
    400,
    "cor fora do conjunto é recusada",
  );

  const home = (await call("GET", "/api/bootstrap", { session: owner })).body as {
    challenges: Array<{ id: string; pinned?: boolean; colorTag?: string | null; sortIndex?: number | null }>;
  };
  assert.equal(home.challenges.find((x) => x.id === a)?.pinned, true);
  assert.equal(home.challenges.find((x) => x.id === b)?.colorTag, "green");
  assert.notEqual(home.challenges.find((x) => x.id === a)?.pinned, home.challenges.find((x) => x.id === c)?.pinned);

  // The preferences are the viewer's own — a stranger sees none of it, and
  // cannot set prefs on a challenge they can't even see.
  const strangerHome = (await call("GET", "/api/bootstrap", { session: stranger })).body as { challenges: unknown[] };
  assert.equal(strangerHome.challenges.length, 0);
  assert.equal((await call("PATCH", `/api/challenges/${a}/prefs`, { session: stranger, body: { pinned: true } })).response.status, 404);

  // Reorder: c, a, b.
  assert.equal((await call("PATCH", "/api/challenges/prefs/order", { session: owner, body: { ids: [c, a, b] } })).response.status, 200);
  const reordered = (await call("GET", "/api/bootstrap", { session: owner })).body as {
    challenges: Array<{ id: string; sortIndex?: number | null }>;
  };
  const byId = new Map(reordered.challenges.map((x) => [x.id, x.sortIndex]));
  assert.equal(byId.get(c), 0);
  assert.equal(byId.get(a), 1);
  assert.equal(byId.get(b), 2);

  // Purging the challenge drops its pref rows.
  await call("POST", `/api/challenges/${a}/transition`, { session: owner, body: { status: "active" } });
  await call("POST", `/api/challenges/${a}/transition`, { session: owner, body: { status: "closed" } });
  await call("DELETE", `/api/challenges/${a}`, { session: owner });
  const preview = await call("POST", `/api/groups/${groupId}/trash/preview`, { session: owner, body: { kind: "challenge", id: a } });
  const entryCount = (preview.body as { dependencies: Array<{ type: string; count: number }> }).dependencies.find((d) => d.type === "entries")?.count ?? 0;
  await call("POST", `/api/groups/${groupId}/trash/purge`, { session: owner, body: { kind: "challenge", id: a, confirmation: String(entryCount) } });
  const gone = await adminPool.query("SELECT 1 FROM challenge_user_prefs WHERE challenge_id = $1", [a]);
  assert.equal(gone.rowCount, 0, "a purga do desafio leva junto as preferências de quem o organizou");
});

test("desafio pessoal: workspace criado sob demanda, invisível como grupo e reusado", async () => {
  const owner = await register("Solange", "sol_personal");
  const outsider = await register("Rita", "rita_personal_out");

  const before = await call("GET", "/api/bootstrap", { session: owner });
  assert.equal((before.body as { personalWorkspaceId: string | null }).personalWorkspaceId, null);
  const groupsBefore = (before.body as { groups: Array<{ id: string }> }).groups.length;

  const first = await call("POST", "/api/personal/challenges", {
    session: owner,
    body: {
      recipe: "cinema",
      title: "Minha maratona",
      startsOn: "2026-01-01",
      endsOn: "2026-12-31",
      participantIds: [owner.user.id, outsider.user.id],
      items: [{ title: "Stalker", year: 1979 }],
    },
  });
  assert.equal(first.response.status, 201, JSON.stringify(first.body));
  const firstId = (first.body as { id: string }).id;

  const after = await call("GET", "/api/bootstrap", { session: owner });
  const workspaceId = (after.body as { personalWorkspaceId: string | null }).personalWorkspaceId;
  assert.ok(workspaceId, "workspace pessoal existe depois do primeiro desafio");
  const groups = (after.body as { groups: Array<{ id: string; kind?: string }> }).groups;
  assert.equal(groups.length, groupsBefore, "workspace técnico não aparece na lista de grupos");
  assert.equal(groups.some((group) => group.id === workspaceId), false);
  const challenges = (after.body as { challenges: Array<{ id: string; groupId: string }> }).challenges;
  assert.equal(challenges.find((challenge) => challenge.id === firstId)?.groupId, workspaceId);
  const firstDetail = await call("GET", `/api/challenges/${firstId}`, { session: owner });
  assert.deepEqual(
    (firstDetail.body as { participants: Array<{ id: string }> }).participants.map((participant) => participant.id),
    [owner.user.id],
    "participantIds enviados pelo cliente não transformam desafio pessoal em grupo",
  );

  for (const blocked of [
    await call("POST", `/api/groups/${workspaceId}/members`, {
      session: owner,
      body: { username: outsider.user.username },
    }),
    await call("POST", `/api/groups/${workspaceId}/invites`, {
      session: owner,
      body: { expiresInDays: 7, maxUses: 1 },
    }),
    await call("POST", `/api/groups/${workspaceId}/challenges`, {
      session: owner,
      body: {
        recipe: "cinema",
        title: "Atalho indevido",
        startsOn: "2026-01-01",
        endsOn: "2026-12-31",
        items: [{ title: "Solaris" }],
      },
    }),
    await call("PATCH", `/api/groups/${workspaceId}`, {
      session: owner,
      body: { name: "Grupo disfarçado" },
    }),
    await call("DELETE", `/api/groups/${workspaceId}`, { session: owner }),
  ]) {
    assert.equal(blocked.response.status, 404, JSON.stringify(blocked.body));
  }

  const participantChange = await call("POST", `/api/challenges/${firstId}/participants`, {
    session: owner,
    body: { replace: true, participantIds: [owner.user.id, outsider.user.id] },
  });
  assert.equal(participantChange.response.status, 400, "participantes extras não entram depois da criação");

  // segundo desafio pessoal reusa o mesmo workspace — e sem datas: uma lista de
  // hábitos de leitura, aberta, com registro por dia inclusive no passado.
  const second = await call("POST", "/api/personal/challenges", {
    session: owner,
    body: {
      recipe: "library",
      title: "Registros de leitura",
      startsOn: null,
      endsOn: null,
      items: [{ title: "A hora da estrela", author: "Clarice Lispector" }],
    },
  });
  assert.equal(second.response.status, 201, JSON.stringify(second.body));
  const secondId = (second.body as { id: string }).id;
  assert.equal((second.body as { status: string }).status, "active", "lista pessoal sem datas nasce ativa, sem passo de ativação");
  assert.equal(
    (await call("POST", `/api/challenges/${secondId}/transition`, { session: owner, body: { status: "closed" } })).response.status,
    409,
    "e não pode ser encerrada",
  );
  const secondDetail = (await call("GET", `/api/challenges/${secondId}`, { session: owner })).body as {
    startsOn: string | null; entryTypes: Array<{ id: string; purpose: string }>; items: Array<{ id: string }>; fields: Array<{ id: string }>;
  };
  assert.equal(secondDetail.startsOn, null);
  const progressType = secondDetail.entryTypes.find((type) => type.purpose === "progress")!;
  const pageEntry = await call("POST", `/api/challenges/${secondId}/entries`, {
    session: owner,
    body: { itemId: secondDetail.items[0].id, entryTypeId: progressType.id, occurredOn: "2023-11-20", values: { [secondDetail.fields[0].id]: 30 } },
  });
  assert.equal(pageEntry.response.status, 201, JSON.stringify(pageEntry.body));
  assert.equal((pageEntry.body as { occurredOn: string }).occurredOn, "2023-11-20", "hábito sem prazo aceita uma data passada");
  const afterSecond = await call("GET", "/api/bootstrap", { session: owner });
  assert.equal((afterSecond.body as { personalWorkspaceId: string }).personalWorkspaceId, workspaceId);
  assert.equal((afterSecond.body as { groups: unknown[] }).groups.length, groupsBefore, "sem grupo visível novo");

  // Mesmo que um dado legado associe outra pessoa ao workspace técnico, a
  // autorização pessoal usa o proprietário, não a membership genérica.
  await adminPool.query(
    `INSERT INTO group_members (group_id, user_id, role, added_by_user_id, joined_at)
     VALUES ($1, $2, 'participant', $3, now())`,
    [workspaceId, outsider.user.id, owner.user.id],
  );
  const outsiderBootstrap = await call("GET", "/api/bootstrap", { session: outsider });
  assert.equal((outsiderBootstrap.body as { personalWorkspaceId: string | null }).personalWorkspaceId, null);
  assert.equal(
    (outsiderBootstrap.body as { challenges: Array<{ id: string }> }).challenges.some((challenge) => challenge.id === firstId),
    false,
  );
  assert.equal(
    (await call("GET", `/api/challenges/${firstId}`, { session: outsider })).response.status,
    404,
    "membership legada não concede acesso ao escopo pessoal",
  );
  assert.equal(
    (await call("GET", `/api/groups/${workspaceId}/catalog`, { session: outsider })).response.status,
    404,
    "membership legada também não abre o acervo pessoal",
  );

  // o workspace pessoal não conta contra o limite de grupos do dono
  for (let index = 0; index < 6; index += 1) {
    const group = await call("POST", "/api/groups", { session: owner, body: { name: `Grupo ${index}` } });
    assert.equal(group.response.status, 201, `grupo ${index}: ${JSON.stringify(group.body)}`);
  }
});

test("estante pessoal: só nota, sem data no registro, sem métricas de grupo, ranking por média simples", async () => {
  const owner = await register("Manuel", "manu_shelf");

  const created = await call("POST", "/api/personal/challenges", {
    session: owner,
    body: {
      recipe: "bookshelf",
      title: "Já li",
      items: [
        { title: "O deserto dos tártaros", author: "Dino Buzzati", year: 1940, mainGenre: "romance" },
        { title: "Pedro Páramo", author: "Juan Rulfo", year: 1955, mainGenre: "romance" },
      ],
    },
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  const cid = (created.body as { id: string }).id;
  assert.equal((created.body as { status: string }).status, "active", "a estante sem datas é uma lista viva, nasce ativa");

  const detail = (await call("GET", `/api/challenges/${cid}`, { session: owner })).body as {
    scope: string;
    collectsEntryDate: boolean;
    entryTypes: Array<{ id: string; purpose: string; fields: Array<{ id: string; key: string }> }>;
    metrics: ApiMetric[];
    items: Array<{ id: string; title: string }>;
  };
  assert.equal(detail.scope, "personal");
  assert.equal(detail.collectsEntryDate, false, "a estante não coleta data por registro");
  assert.deepEqual(detail.entryTypes.map((type) => type.purpose), ["rating"], "só avaliação — sem progresso, sem conclusão");
  assert.equal(detail.metrics.some((metric) => metric.operation === "indicator_bias"), false, "sem viés do indicador num desafio solo");
  assert.equal(detail.metrics.some((metric) => metric.operation === "spread"), false, "sem polarização num desafio solo");
  const ranking = detail.metrics.find((metric) => metric.label.toLowerCase().includes("ranking"))!;
  assert.equal(ranking.operation, "average", "ranking solo é média simples, sem encolhimento bayesiano");

  const ratingEntryType = detail.entryTypes[0];
  const notaField = ratingEntryType.fields.find((field) => field.key === "nota")!.id;
  const ratingType = ratingEntryType.id;
  for (const [item, nota] of [[detail.items[0], 5], [detail.items[1], 3]] as const) {
    const entry = await call("POST", `/api/challenges/${cid}/entries`, {
      session: owner,
      body: { itemId: item.id, entryTypeId: ratingType, values: { [notaField]: nota } },
    });
    assert.equal(entry.response.status, 201, JSON.stringify(entry.body));
  }

  const rated = (await call("GET", `/api/challenges/${cid}`, { session: owner })).body as { metrics: ApiMetric[] };
  const topRow = rated.metrics
    .find((metric) => metric.label.toLowerCase().includes("ranking"))!
    .series!.find((row) => row.value !== null)!;
  assert.equal(topRow.value, 5, "com uma nota por livro, a média é a própria nota");

  const cannotClose = await call("POST", `/api/challenges/${cid}/transition`, { session: owner, body: { status: "closed" } });
  assert.equal(cannotClose.response.status, 409, "uma estante-lista não é encerrada");
});

test("membro sai do grupo, opcionalmente apagando seus dados; o responsável não sai", async () => {
  const owner = await register("Dona Saída", "dona_saida");
  const keeper = await register("Fica O Registro", "fica_o_registro");
  const purger = await register("Some O Registro", "some_o_registro");

  const group = await call("POST", "/api/groups", { session: owner, body: { name: "Grupo com porta" } });
  const groupId = (group.body as { id: string }).id;
  const invite = await call("POST", `/api/groups/${groupId}/invites`, {
    session: owner,
    body: { expiresInDays: 7, maxUses: 5 },
  });
  const token = (invite.body as { token: string }).token;
  await call("POST", `/api/invites/${token}`, { session: keeper, body: {} });
  await call("POST", `/api/invites/${token}`, { session: purger, body: {} });

  const challenge = await call("POST", `/api/groups/${groupId}/challenges`, {
    session: owner,
    body: {
      title: "Rodada com três",
      submissionMode: "item",
      participantIds: [owner.user.id, keeper.user.id, purger.user.id],
      items: [{ title: "Primeiro filme", recommendedByUserId: keeper.user.id }],
      fields: [{ key: "nota", label: "Nota", type: "rating", required: true }],
    },
  });
  const challengeId = (challenge.body as { id: string }).id;
  await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "active" } });

  const detail = (await call("GET", `/api/challenges/${challengeId}`, { session: keeper })).body as {
    entryTypes: Array<{ id: string; fields: Array<{ id: string; key: string }> }>;
    items: Array<{ id: string }>;
  };
  const notaField = detail.entryTypes[0].fields.find((field) => field.key === "nota")!.id;
  const typeId = detail.entryTypes[0].id;
  const itemId = detail.items[0].id;
  for (const [session, nota] of [[keeper, 4], [purger, 2]] as const) {
    const submitted = await call("POST", `/api/challenges/${challengeId}/entries`, {
      session,
      body: { itemId, entryTypeId: typeId, values: { [notaField]: nota } },
    });
    assert.equal(submitted.response.status, 201, JSON.stringify(submitted.body));
  }
  const byPersonMetric = await call("POST", `/api/challenges/${challengeId}/metrics`, {
    session: owner,
    body: { label: "Nota por pessoa", operation: "average", fieldId: notaField, groupBy: "participant" },
  });
  assert.equal(byPersonMetric.response.status, 201, JSON.stringify(byPersonMetric.body));

  // The owner cannot walk away — no ownership transfer yet.
  const ownerLeaves = await call("POST", `/api/groups/${groupId}/leave`, { session: owner, body: {} });
  assert.equal(ownerLeaves.response.status, 409, JSON.stringify(ownerLeaves.body));
  assert.equal((ownerLeaves.body as { error: string }).error, "owner_cannot_leave");

  // Leaving asks nothing — it just happens: membership and participation close,
  // the entry stays (the round's history stays intact).
  const left = await call("POST", `/api/groups/${groupId}/leave`, { session: keeper, body: {} });
  assert.equal(left.response.status, 200, JSON.stringify(left.body));
  assert.deepEqual(left.body, { groupId, left: true });

  const afterLeave = await adminPool.query<{ members: number; parts: number; live_entries: number }>(
    `SELECT
       (SELECT count(*)::int FROM group_members WHERE group_id = $1 AND user_id = $2 AND removed_at IS NULL) AS members,
       (SELECT count(*)::int FROM challenge_participants WHERE challenge_id = $3 AND user_id = $2 AND removed_at IS NULL) AS parts,
       (SELECT count(*)::int FROM entries WHERE challenge_id = $3 AND participant_user_id = $2 AND deleted_at IS NULL) AS live_entries`,
    [groupId, keeper.user.id, challengeId],
  );
  assert.deepEqual(afterLeave.rows[0], { members: 0, parts: 0, live_entries: 1 }, "o registro de quem saiu permanece");

  const groupGone = (await call("GET", "/api/bootstrap", { session: keeper })).body as { groups: Array<{ id: string }> };
  assert.ok(!groupGone.groups.some((entry) => entry.id === groupId), "o grupo some do bootstrap de quem saiu");

  // Anonymity instead of a question: the item this person recommended loses the
  // byline, and their row in the per-person metric loses the name (not the value).
  const detailAfterLeave = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    items: Array<{ recommendedBy: { name: string } | null }>;
    metrics: ApiMetric[];
  };
  assert.equal(detailAfterLeave.items[0].recommendedBy, null, "indicação de quem saiu não aparece mais");
  const byPersonSeries = detailAfterLeave.metrics.find((metric) => metric.label === "Nota por pessoa")!.series!;
  const keeperRow = byPersonSeries.find((row) => row.value === 4)!;
  assert.equal(keeperRow.label, "Quem já saiu", "a nota de quem saiu continua contando, sem o nome");

  const leftAudit = await adminPool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM audit_events WHERE group_id = $1 AND action = 'group.member_left'",
    [groupId],
  );
  assert.equal(leftAudit.rows[0]?.count, 1, "a saída fica auditada");
});

test("apagar a conta também encerra a participação em desafios de outros grupos", async () => {
  const owner = await register("Dona Encerra", "dona_encerra_conta");
  const member = await register("Sai Ao Apagar", "sai_ao_apagar_conta");

  const group = await call("POST", "/api/groups", { session: owner, body: { name: "Grupo que fica" } });
  const groupId = (group.body as { id: string }).id;
  const invite = await call("POST", `/api/groups/${groupId}/invites`, { session: owner, body: { expiresInDays: 7, maxUses: 1 } });
  await call("POST", `/api/invites/${(invite.body as { token: string }).token}`, { session: member, body: {} });

  const challenge = await call("POST", `/api/groups/${groupId}/challenges`, {
    session: owner,
    body: {
      title: "Rodada de outra pessoa",
      submissionMode: "item",
      participantIds: [owner.user.id, member.user.id],
      items: [{ title: "Um filme" }],
      fields: [{ key: "nota", label: "Nota", type: "rating", required: true }],
    },
  });
  const challengeId = (challenge.body as { id: string }).id;
  await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "active" } });

  assert.equal(
    (await call("POST", "/api/account/delete", { session: member, body: { password: "uma senha segura 123" } })).response.status,
    200,
  );

  const stillParticipant = await adminPool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM challenge_participants WHERE challenge_id = $1 AND user_id = $2 AND removed_at IS NULL",
    [challengeId, member.user.id],
  );
  assert.equal(stillParticipant.rows[0]?.count, 0, "apagar a conta fecha a participação, não só a membresia do grupo");
});

test("mais de um admin por grupo: só o dono promove e rebaixa, com as guardas certas", async () => {
  const owner = await register("Dona Admins", "dona_admins");
  const promoted = await register("Vira Admin", "vira_admin");
  const other = await register("Fica Participante", "fica_participante");

  const group = await call("POST", "/api/groups", { session: owner, body: { name: "Grupo com dois admins" } });
  const groupId = (group.body as { id: string }).id;
  const invite = await call("POST", `/api/groups/${groupId}/invites`, { session: owner, body: { expiresInDays: 7, maxUses: 5 } });
  const token = (invite.body as { token: string }).token;
  await call("POST", `/api/invites/${token}`, { session: promoted, body: {} });
  await call("POST", `/api/invites/${token}`, { session: other, body: {} });

  const deniedByParticipant = await call("PATCH", `/api/groups/${groupId}/members/${promoted.user.id}`, {
    session: other,
    body: { role: "admin" },
  });
  assert.equal(deniedByParticipant.response.status, 403, JSON.stringify(deniedByParticipant.body));

  const promote = await call("PATCH", `/api/groups/${groupId}/members/${promoted.user.id}`, {
    session: owner,
    body: { role: "admin" },
  });
  assert.equal(promote.response.status, 200, JSON.stringify(promote.body));
  assert.deepEqual(promote.body, { groupId, userId: promoted.user.id, role: "admin" });

  const bootAfterPromote = (await call("GET", "/api/bootstrap", { session: owner })).body as {
    groups: Array<{ id: string; members?: Array<{ id: string; role: string }> }>;
  };
  const groupAfterPromote = bootAfterPromote.groups.find((entry) => entry.id === groupId)!;
  assert.equal(groupAfterPromote.members?.find((member) => member.id === promoted.user.id)?.role, "admin");

  // A group can have more than one admin, but promoting/demoting is still owner-only.
  const deniedByAdmin = await call("PATCH", `/api/groups/${groupId}/members/${other.user.id}`, {
    session: promoted,
    body: { role: "admin" },
  });
  assert.equal(deniedByAdmin.response.status, 403, JSON.stringify(deniedByAdmin.body));

  const selfChange = await call("PATCH", `/api/groups/${groupId}/members/${owner.user.id}`, {
    session: owner,
    body: { role: "admin" },
  });
  assert.equal(selfChange.response.status, 400, JSON.stringify(selfChange.body));
  assert.equal((selfChange.body as { error: string }).error, "cannot_change_self");

  const invalidRole = await call("PATCH", `/api/groups/${groupId}/members/${other.user.id}`, {
    session: owner,
    body: { role: "owner" },
  });
  assert.equal(invalidRole.response.status, 400, JSON.stringify(invalidRole.body));
  assert.equal((invalidRole.body as { error: string }).error, "invalid_role");

  const demote = await call("PATCH", `/api/groups/${groupId}/members/${promoted.user.id}`, {
    session: owner,
    body: { role: "participant" },
  });
  assert.equal(demote.response.status, 200, JSON.stringify(demote.body));
  assert.deepEqual(demote.body, { groupId, userId: promoted.user.id, role: "participant" });

  const roleAudit = await adminPool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM audit_events WHERE group_id = $1 AND action = 'group.member_role_changed'",
    [groupId],
  );
  assert.equal(roleAudit.rows[0]?.count, 2, "promoção e rebaixamento ficam auditados");
});

test("apagar a conta transfere a posse do grupo: admin mais antigo, ou membro mais antigo sem admin", async () => {
  const ownerA = await register("Dona Transfere A", "dona_transfere_a");
  const admin = await register("Admin Mais Antigo", "admin_mais_antigo");
  const memberA = await register("Membro Recente A", "membro_recente_a");

  const groupA = await call("POST", "/api/groups", { session: ownerA, body: { name: "Grupo com admin" } });
  const groupAId = (groupA.body as { id: string }).id;
  const inviteA = await call("POST", `/api/groups/${groupAId}/invites`, { session: ownerA, body: { expiresInDays: 7, maxUses: 5 } });
  const tokenA = (inviteA.body as { token: string }).token;
  await call("POST", `/api/invites/${tokenA}`, { session: admin, body: {} });
  await call("POST", `/api/invites/${tokenA}`, { session: memberA, body: {} });
  await call("PATCH", `/api/groups/${groupAId}/members/${admin.user.id}`, { session: ownerA, body: { role: "admin" } });

  assert.equal(
    (await call("POST", "/api/account/delete", { session: ownerA, body: { password: "uma senha segura 123" } })).response.status,
    200,
  );

  const groupAAfter = await adminPool.query<{ owner_user_id: string; role: string }>(
    `SELECT g.owner_user_id, gm.role FROM groups g
       JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = g.owner_user_id
      WHERE g.id = $1`,
    [groupAId],
  );
  assert.equal(groupAAfter.rows[0]?.owner_user_id, admin.user.id, "o admin mais antigo herda o grupo");
  assert.equal(groupAAfter.rows[0]?.role, "owner");

  const ownerARowGone = await adminPool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM group_members WHERE group_id = $1 AND user_id = $2 AND removed_at IS NULL",
    [groupAId, ownerA.user.id],
  );
  assert.equal(ownerARowGone.rows[0]?.count, 0, "quem apagou a conta sai do grupo");

  const transferAudit = await adminPool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM audit_events WHERE group_id = $1 AND action = 'group.ownership_transferred'",
    [groupAId],
  );
  assert.equal(transferAudit.rows[0]?.count, 1, "a transferência de posse fica auditada");

  // No admin at all: the oldest remaining participant inherits instead.
  const ownerB = await register("Dona Transfere B", "dona_transfere_b");
  const olderMember = await register("Membro Mais Velho B", "membro_mais_velho_b");
  const newerMember = await register("Membro Mais Novo B", "membro_mais_novo_b");

  const groupB = await call("POST", "/api/groups", { session: ownerB, body: { name: "Grupo sem admin" } });
  const groupBId = (groupB.body as { id: string }).id;
  const inviteB = await call("POST", `/api/groups/${groupBId}/invites`, { session: ownerB, body: { expiresInDays: 7, maxUses: 5 } });
  const tokenB = (inviteB.body as { token: string }).token;
  await call("POST", `/api/invites/${tokenB}`, { session: olderMember, body: {} });
  await call("POST", `/api/invites/${tokenB}`, { session: newerMember, body: {} });

  assert.equal(
    (await call("POST", "/api/account/delete", { session: ownerB, body: { password: "uma senha segura 123" } })).response.status,
    200,
  );

  const groupBAfter = await adminPool.query<{ owner_user_id: string }>(
    "SELECT owner_user_id FROM groups WHERE id = $1",
    [groupBId],
  );
  assert.equal(groupBAfter.rows[0]?.owner_user_id, olderMember.user.id, "sem admin, o membro mais antigo herda o grupo");
});

test("hábito: sem catálogo, um campo numérico que o próprio usuário criou vira a base de uma métrica própria", async () => {
  const owner = await register("Estuda Sozinho", "estuda_habito");

  const created = await call("POST", "/api/personal/challenges", {
    session: owner,
    body: {
      recipe: "habit",
      title: "Estudos",
      fields: [
        { key: "materia", label: "Matéria", type: "text", required: false },
        { key: "minutos", label: "Minutos estudados", type: "number", required: true, config: { min: 0, step: 1 } },
      ],
    },
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  assert.equal((created.body as { status: string }).status, "active", "hábito pessoal sem datas nasce ativo, sem passo de ativação");
  assert.equal((created.body as { kind: string }).kind, "list", "e é uma lista viva, não uma rodada com estado");
  const challengeId = (created.body as { id: string }).id;

  const detail = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    entryTypes: Array<{ id: string; purpose: string; fields: Array<{ id: string; key: string }> }>;
    items: unknown[];
  };
  assert.deepEqual(detail.items, [], "hábito não cria nenhum item de acervo — não é filme, não é livro");
  assert.deepEqual(detail.entryTypes.map((type) => type.purpose), ["checkin"]);
  const typeId = detail.entryTypes[0].id;
  const minutosField = detail.entryTypes[0].fields.find((field) => field.key === "minutos")!.id;
  assert.ok(minutosField, "o campo criado pelo próprio usuário substitui o campo padrão da receita");

  for (const [occurredOn, minutos] of [["2026-01-01", 30], ["2026-01-02", 50], ["2026-01-03", 40]] as const) {
    const entry = await call("POST", `/api/challenges/${challengeId}/entries`, {
      session: owner,
      body: { entryTypeId: typeId, occurredOn, values: { [minutosField]: minutos } },
    });
    assert.equal(entry.response.status, 201, JSON.stringify(entry.body));
  }

  const metric = await call("POST", `/api/challenges/${challengeId}/metrics`, {
    session: owner,
    body: { label: "Média de minutos", operation: "average", fieldId: minutosField, groupBy: "none" },
  });
  assert.equal(metric.response.status, 201, JSON.stringify(metric.body));

  const withMetric = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as { metrics: ApiMetric[] };
  const avg = withMetric.metrics.find((entry) => entry.label === "Média de minutos")!;
  assert.equal(avg.value, 40, "a métrica calcula certo sobre um campo que não veio de receita nenhuma");
});

test("atributo de acervo tipado: nomeado pelo grupo, preenchido num item, travado enquanto tiver dado", async () => {
  const owner = await register("Cataloga Tudo", "cataloga_atributos");
  const member = await register("So Participa", "so_participa_atributos");

  const group = await call("POST", "/api/groups", { session: owner, body: { name: "Cineclube atributos" } });
  const groupId = (group.body as { id: string }).id;
  const invite = await call("POST", `/api/groups/${groupId}/invites`, { session: owner, body: { expiresInDays: 7, maxUses: 1 } });
  await call("POST", `/api/invites/${(invite.body as { token: string }).token}`, { session: member, body: {} });

  // só admin/dono define atributos, não qualquer participante
  const blocked = await call("POST", `/api/groups/${groupId}/catalog-attributes`, {
    session: member,
    body: { kind: "film", label: "Diretor", type: "text" },
  });
  assert.equal(blocked.response.status, 403, "participante comum não pode criar atributo de acervo");

  const created = await call("POST", `/api/groups/${groupId}/catalog-attributes`, {
    session: owner,
    body: { kind: "film", label: "Diretor", type: "text" },
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  const attr = created.body as { id: string; kind: string; key: string; label: string; type: string };
  assert.equal(attr.kind, "film");
  assert.equal(attr.key, "diretor", "a chave é derivada do rótulo");
  assert.equal(attr.type, "text");

  const listed = (await call("GET", `/api/groups/${groupId}/catalog-attributes?kind=film`, { session: member })).body as {
    attributes: Array<{ id: string; key: string }>;
  };
  assert.ok(listed.attributes.some((a) => a.id === attr.id), "qualquer participante pode ver a forma do acervo (só não definir)");

  const challenge = await call("POST", `/api/groups/${groupId}/challenges`, {
    session: owner,
    body: {
      recipe: "cinema",
      title: "Com atributo próprio",
      items: [{ title: "Duna", attributes: { [attr.key]: "Denis Villeneuve" } }],
    },
  });
  assert.equal(challenge.response.status, 201, JSON.stringify(challenge.body));

  const catalog = (await call("GET", `/api/groups/${groupId}/catalog`, { session: owner })).body as {
    items: Array<{ id: string; title: string; attributes: Array<{ key: string; label: string; type: string; value: unknown }> }>;
  };
  const duna = catalog.items.find((item) => item.title === "Duna")!;
  assert.deepEqual(duna.attributes, [{ key: "diretor", label: "Diretor", type: "text", value: "Denis Villeneuve" }]);

  const detail = (await call("GET", `/api/groups/${groupId}/catalog/${duna.id}`, { session: owner })).body as {
    attributes: Array<{ key: string; value: unknown }>;
  };
  assert.deepEqual(detail.attributes, [{ key: "diretor", label: "Diretor", type: "text", value: "Denis Villeneuve" }]);

  const cannotArchive = await call("DELETE", `/api/groups/${groupId}/catalog-attributes/${attr.id}`, { session: owner });
  assert.equal(cannotArchive.response.status, 409, "atributo com valor preenchido não pode ser removido");
  assert.equal((cannotArchive.body as { error: string }).error, "attribute_has_data");

  const empty = await call("POST", `/api/groups/${groupId}/catalog-attributes`, {
    session: owner,
    body: { kind: "film", label: "Estúdio", type: "text" },
  });
  const emptyId = (empty.body as { id: string }).id;
  const canArchive = await call("DELETE", `/api/groups/${groupId}/catalog-attributes/${emptyId}`, { session: owner });
  assert.equal(canArchive.response.status, 200, "sem nenhum valor preenchido, o atributo é removível");

  // acervo pessoal: mesma forma, workspace próprio
  const personalAttr = await call("POST", "/api/personal/catalog-attributes", {
    session: owner,
    body: { kind: "book", label: "Editora", type: "text" },
  });
  assert.equal(personalAttr.response.status, 201, JSON.stringify(personalAttr.body));
  const personalKey = (personalAttr.body as { key: string }).key;
  const personalChallenge = await call("POST", "/api/personal/challenges", {
    session: owner,
    body: {
      recipe: "bookshelf",
      title: "Minha estante com atributo",
      items: [{ title: "Duna", author: "Frank Herbert", attributes: { [personalKey]: "Aleph" } }],
    },
  });
  assert.equal(personalChallenge.response.status, 201, JSON.stringify(personalChallenge.body));
  const personalCatalog = (await call("GET", "/api/personal/catalog", { session: owner })).body as {
    items: Array<{ title: string; attributes: Array<{ key: string; value: unknown }> }>;
  };
  const personalDuna = personalCatalog.items.find((item) => item.title === "Duna")!;
  assert.deepEqual(personalDuna.attributes, [{ key: "editora", label: "Editora", type: "text", value: "Aleph" }]);
});

test("métricas: editar e remover uma existente, e agrupar por ano/autor do acervo", async () => {
  const owner = await register("Mede Tudo", "mede_tudo_metricas");
  const participant = await register("So Vota", "so_vota_metricas");

  const group = await call("POST", "/api/groups", { session: owner, body: { name: "Cineclube métricas" } });
  const groupId = (group.body as { id: string }).id;
  const invite = await call("POST", `/api/groups/${groupId}/invites`, { session: owner, body: { expiresInDays: 7, maxUses: 1 } });
  await call("POST", `/api/invites/${(invite.body as { token: string }).token}`, { session: participant, body: {} });

  const challenge = await call("POST", `/api/groups/${groupId}/challenges`, {
    session: owner,
    body: {
      recipe: "cinema",
      title: "Melhores do ano",
      participantIds: [owner.user.id, participant.user.id],
      items: [
        { title: "Filme A 2026", year: 2026 },
        { title: "Filme B 2026", year: 2026 },
        { title: "Filme C 2025", year: 2025 },
      ],
    },
  });
  const challengeId = (challenge.body as { id: string }).id;
  await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "active" } });

  const detail = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    entryTypes: Array<{ id: string; fields: Array<{ id: string; key: string }> }>;
    items: Array<{ id: string; title: string }>;
  };
  const notaField = detail.entryTypes[0].fields.find((field) => field.key === "nota")!.id;
  const typeId = detail.entryTypes[0].id;
  const itemByTitle = new Map(detail.items.map((item) => [item.title, item.id]));
  for (const [title, nota] of [["Filme A 2026", 5], ["Filme B 2026", 3], ["Filme C 2025", 4]] as const) {
    const submitted = await call("POST", `/api/challenges/${challengeId}/entries`, {
      session: owner,
      body: { itemId: itemByTitle.get(title), entryTypeId: typeId, values: { [notaField]: nota } },
    });
    assert.equal(submitted.response.status, 201, JSON.stringify(submitted.body));
  }

  // Agrupar por ano do acervo: "melhores filmes de 2026 pra esse desafio".
  const byYear = await call("POST", `/api/challenges/${challengeId}/metrics`, {
    session: owner,
    body: { label: "Nota por ano", operation: "average", fieldId: notaField, groupBy: "catalog_year" },
  });
  assert.equal(byYear.response.status, 201, JSON.stringify(byYear.body));
  const metricId = (byYear.body as { id: string }).id;

  const withByYear = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as { metrics: ApiMetric[] };
  const yearSeries = withByYear.metrics.find((metric) => metric.id === metricId)!.series!;
  const year2026 = yearSeries.find((row) => row.key === "2026")!;
  const year2025 = yearSeries.find((row) => row.key === "2025")!;
  assert.equal(year2026.value, 4, "média de 5 e 3 nos dois filmes de 2026");
  assert.equal(year2025.value, 4, "único filme de 2025");

  // Participante comum não edita nem remove métrica.
  assert.equal(
    (await call("PATCH", `/api/challenges/${challengeId}/metrics/${metricId}`, {
      session: participant, body: { label: "Hackeado", operation: "average", fieldId: notaField, groupBy: "none" },
    })).response.status,
    403,
  );
  assert.equal((await call("DELETE", `/api/challenges/${challengeId}/metrics/${metricId}`, { session: participant })).response.status, 403);

  // Dono edita: rótulo e agrupamento mudam, sem perder o cálculo.
  const edited = await call("PATCH", `/api/challenges/${challengeId}/metrics/${metricId}`, {
    session: owner,
    body: { label: "Nota geral", operation: "average", fieldId: notaField, groupBy: "none" },
  });
  assert.equal(edited.response.status, 200, JSON.stringify(edited.body));
  const afterEdit = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as { metrics: ApiMetric[] };
  const editedMetric = afterEdit.metrics.find((metric) => metric.id === metricId)!;
  assert.equal(editedMetric.label, "Nota geral");
  assert.equal(editedMetric.groupBy, "none");
  assert.equal(editedMetric.series, undefined, "sem groupBy, some a série");

  // Dono remove: a métrica desaparece do desafio.
  const removed = await call("DELETE", `/api/challenges/${challengeId}/metrics/${metricId}`, { session: owner });
  assert.equal(removed.response.status, 200, JSON.stringify(removed.body));
  const afterRemove = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as { metrics: ApiMetric[] };
  assert.ok(!afterRemove.metrics.some((metric) => metric.id === metricId), "métrica removida some da lista");

  // Agrupar por autor: dois livros do mesmo autor, um de outro.
  const bookGroup = await call("POST", "/api/groups", { session: owner, body: { name: "Clube de leitura métricas" } });
  const bookGroupId = (bookGroup.body as { id: string }).id;
  const bookChallenge = await call("POST", `/api/groups/${bookGroupId}/challenges`, {
    session: owner,
    body: {
      recipe: "bookshelf",
      title: "Melhores autores",
      participantIds: [owner.user.id],
      items: [
        { title: "Livro 1", author: "Autora X" },
        { title: "Livro 2", author: "Autora X" },
        { title: "Livro 3", author: "Autor Y" },
      ],
    },
  });
  const bookChallengeId = (bookChallenge.body as { id: string }).id;
  await call("POST", `/api/challenges/${bookChallengeId}/transition`, { session: owner, body: { status: "active" } });
  const bookDetail = (await call("GET", `/api/challenges/${bookChallengeId}`, { session: owner })).body as {
    entryTypes: Array<{ id: string; fields: Array<{ id: string; key: string }> }>;
    items: Array<{ id: string; title: string }>;
  };
  const bookNotaField = bookDetail.entryTypes[0].fields.find((field) => field.key === "nota")!.id;
  const bookTypeId = bookDetail.entryTypes[0].id;
  const bookItemByTitle = new Map(bookDetail.items.map((item) => [item.title, item.id]));
  for (const [title, nota] of [["Livro 1", 5], ["Livro 2", 3], ["Livro 3", 2]] as const) {
    await call("POST", `/api/challenges/${bookChallengeId}/entries`, {
      session: owner,
      body: { itemId: bookItemByTitle.get(title), entryTypeId: bookTypeId, values: { [bookNotaField]: nota } },
    });
  }
  const byAuthor = await call("POST", `/api/challenges/${bookChallengeId}/metrics`, {
    session: owner,
    body: { label: "Nota por autor", operation: "average", fieldId: bookNotaField, groupBy: "catalog_author" },
  });
  assert.equal(byAuthor.response.status, 201, JSON.stringify(byAuthor.body));
  const withByAuthor = (await call("GET", `/api/challenges/${bookChallengeId}`, { session: owner })).body as { metrics: ApiMetric[] };
  const authorSeries = withByAuthor.metrics.find((metric) => metric.label === "Nota por autor")!.series!;
  assert.equal(authorSeries.find((row) => row.key === "Autora X")!.value, 4, "média dos dois livros da mesma autora");
  assert.equal(authorSeries.find((row) => row.key === "Autor Y")!.value, 2);
});

test("amostra mínima de uma métrica é configurável — um grupo pequeno pode baixá-la pra 2", async () => {
  const owner = await register("Dona Amostra", "dona_amostra_minima");
  const participant = await register("Participa Amostra", "participa_amostra_minima");
  const groupId = ((await call("POST", "/api/groups", { session: owner, body: { name: "Dupla" } })).body as { id: string }).id;
  const invite = (await call("POST", `/api/groups/${groupId}/invites`, { session: owner, body: { expiresInDays: 7, maxUses: 1 } })).body as { token: string };
  await call("POST", `/api/invites/${invite.token}`, { session: participant, body: {} });

  const challenge = await call("POST", `/api/groups/${groupId}/challenges`, {
    session: owner,
    body: {
      recipe: "cinema", title: "Dupla avalia", participantIds: [owner.user.id, participant.user.id],
      items: [{ title: "Só um voto" }, { title: "Os dois votam" }],
    },
  });
  const challengeId = (challenge.body as { id: string }).id;
  await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "active" } });
  const detail = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    entryTypes: Array<{ id: string; fields: Array<{ id: string; key: string }> }>;
    items: Array<{ id: string; title: string }>;
  };
  const notaField = detail.entryTypes[0].fields.find((field) => field.key === "nota")!.id;
  const typeId = detail.entryTypes[0].id;
  const itemByTitle = new Map(detail.items.map((item) => [item.title, item.id]));
  await call("POST", `/api/challenges/${challengeId}/entries`, { session: owner, body: { itemId: itemByTitle.get("Só um voto"), entryTypeId: typeId, values: { [notaField]: 5 } } });
  await call("POST", `/api/challenges/${challengeId}/entries`, { session: owner, body: { itemId: itemByTitle.get("Os dois votam"), entryTypeId: typeId, values: { [notaField]: 4 } } });
  await call("POST", `/api/challenges/${challengeId}/entries`, { session: participant, body: { itemId: itemByTitle.get("Os dois votam"), entryTypeId: typeId, values: { [notaField]: 2 } } });

  const ranking = await call("POST", `/api/challenges/${challengeId}/metrics`, {
    session: owner,
    body: { label: "Ranking a dois", operation: "average", fieldId: notaField, groupBy: "item", minSample: 2 },
  });
  assert.equal(ranking.response.status, 201, JSON.stringify(ranking.body));
  const metricId = (ranking.body as { id: string }).id;

  const withMinSample = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as { metrics: ApiMetric[] };
  const metric = withMinSample.metrics.find((entry) => entry.id === metricId)!;
  assert.equal(metric.minSample, 2, "a amostra mínima escolhida é devolvida junto com a métrica");
  const series = metric.series!;
  assert.equal(series.find((row) => row.label === "Só um voto")!.value, null, "um voto só fica abaixo da amostra mínima de 2");
  assert.equal(series.find((row) => row.label === "Os dois votam")!.value, 3, "com os dois votos, a média conta");

  // Editar reduzindo pra 1 faz o item de voto único voltar a valer.
  const lowered = await call("PATCH", `/api/challenges/${challengeId}/metrics/${metricId}`, {
    session: owner,
    body: { label: "Ranking a dois", operation: "average", fieldId: notaField, groupBy: "item", minSample: 1 },
  });
  assert.equal(lowered.response.status, 200, JSON.stringify(lowered.body));
  const afterLowering = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as { metrics: ApiMetric[] };
  const loweredSeries = afterLowering.metrics.find((entry) => entry.id === metricId)!.series!;
  assert.equal(loweredSeries.find((row) => row.label === "Só um voto")!.value, 5, "com amostra mínima 1, o voto único já conta");
});

test("um ranking por item traz quem indicou, o ano do catálogo e a média crua ao lado da nota ajustada", async () => {
  const owner = await register("Dona Ranking Rico", "dona_ranking_rico");
  const keeper = await register("Indica Filme", "indica_filme_rico");
  const groupId = ((await call("POST", "/api/groups", { session: owner, body: { name: "Ranking Rico" } })).body as { id: string }).id;
  const invite = (await call("POST", `/api/groups/${groupId}/invites`, { session: owner, body: { expiresInDays: 7, maxUses: 1 } })).body as { token: string };
  await call("POST", `/api/invites/${invite.token}`, { session: keeper, body: {} });

  const challenge = await call("POST", `/api/groups/${groupId}/challenges`, {
    session: owner,
    body: {
      recipe: "cinema", title: "Ranking rico", participantIds: [owner.user.id, keeper.user.id],
      items: [
        { title: "Aftersun", year: 2022, recommendedByUserId: keeper.user.id },
        { title: "Filme Contraponto", year: 2020 },
      ],
    },
  });
  const challengeId = (challenge.body as { id: string }).id;
  await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "active" } });
  const detail = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    entryTypes: Array<{ id: string; fields: Array<{ id: string; key: string }> }>;
    items: Array<{ id: string; title: string }>;
  };
  const notaField = detail.entryTypes[0].fields.find((field) => field.key === "nota")!.id;
  const typeId = detail.entryTypes[0].id;
  const itemByTitle = new Map(detail.items.map((item) => [item.title, item.id]));
  // A second, lower-rated item pulls the challenge's overall mean away from
  // Aftersun's own rating, so its single-vote bayesian average visibly shrinks.
  await call("POST", `/api/challenges/${challengeId}/entries`, { session: owner, body: { itemId: itemByTitle.get("Aftersun"), entryTypeId: typeId, values: { [notaField]: 5 } } });
  await call("POST", `/api/challenges/${challengeId}/entries`, { session: owner, body: { itemId: itemByTitle.get("Filme Contraponto"), entryTypeId: typeId, values: { [notaField]: 1 } } });

  // A custom metric with minSample:1 — the recipe's own "Ranking dos filmes"
  // defaults to minSample:2, which would null out both numbers with just one
  // vote per item and hide the shrinkage this test is actually after.
  const customRanking = await call("POST", `/api/challenges/${challengeId}/metrics`, {
    session: owner,
    body: { label: "Ranking com 1 voto", operation: "bayesian_average", fieldId: notaField, groupBy: "item", minSample: 1 },
  });
  assert.equal(customRanking.response.status, 201, JSON.stringify(customRanking.body));

  const withRanking = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as { metrics: ApiMetric[] };
  const ranking = withRanking.metrics.find((metric) => metric.label === "Ranking com 1 voto")!;
  const row = ranking.series!.find((entry) => entry.label === "Aftersun")!;
  assert.equal(row.recommendedBy, "Indica Filme", "a linha do ranking traz quem indicou o filme");
  assert.equal(row.year, 2022, "e o ano do catálogo");
  assert.ok(row.rawValue !== undefined && row.rawValue !== null, "traz a média crua por trás do ajuste bayesiano");
  assert.notEqual(row.rawValue, row.value, "com uma amostra de 1, a média crua e a ajustada divergem (o ajuste encolhe rumo à média geral)");
  assert.equal(row.rawValue, 5, "a média crua é simplesmente a nota dada");
});

test("um filme carrega a duração em minutos, editável depois, e o item do acervo traz a nota geral do grupo", async () => {
  const owner = await register("Dona Duração", "dona_duracao_filme");
  const groupId = ((await call("POST", "/api/groups", { session: owner, body: { name: "Clube da Duração" } })).body as { id: string }).id;

  const challenge = await call("POST", `/api/groups/${groupId}/challenges`, {
    session: owner,
    body: {
      recipe: "cinema", title: "Sessão com duração", participantIds: [owner.user.id],
      items: [{ title: "Aftersun", year: 2022, runtimeMinutes: 108 }],
    },
  });
  const challengeId = (challenge.body as { id: string }).id;
  await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "active" } });

  const detail = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    entryTypes: Array<{ id: string; fields: Array<{ id: string; key: string }> }>;
    items: Array<{ id: string; catalogItem: { id: string; runtimeMinutes: number | null } }>;
  };
  assert.equal(detail.items[0].catalogItem.runtimeMinutes, 108, "a duração aparece no item do desafio");
  const catalogItemId = detail.items[0].catalogItem.id;
  const itemId = detail.items[0].id;
  const notaField = detail.entryTypes[0].fields.find((field) => field.key === "nota")!.id;
  const typeId = detail.entryTypes[0].id;

  const catalog = (await call("GET", `/api/groups/${groupId}/catalog`, { session: owner })).body as { items: Array<{ id: string; runtimeMinutes: number | null }> };
  assert.equal(catalog.items.find((item) => item.id === catalogItemId)?.runtimeMinutes, 108, "a duração aparece na listagem do acervo");

  await call("POST", `/api/challenges/${challengeId}/entries`, { session: owner, body: { itemId, entryTypeId: typeId, values: { [notaField]: 4 } } });
  const beforeEdit = (await call("GET", `/api/groups/${groupId}/catalog/${catalogItemId}`, { session: owner })).body as {
    runtimeMinutes: number | null; ratingAvg: number | null; ratingCount: number;
  };
  assert.equal(beforeEdit.runtimeMinutes, 108);
  assert.equal(beforeEdit.ratingAvg, 4, "a página do item já traz a nota geral do grupo, não só o histórico por rodada");
  assert.equal(beforeEdit.ratingCount, 1);

  const edited = await call("PATCH", `/api/challenges/${challengeId}/items/${itemId}`, {
    session: owner,
    body: { title: "Aftersun", description: "", runtimeMinutes: 132 },
  });
  assert.equal(edited.response.status, 200, JSON.stringify(edited.body));
  const afterEdit = (await call("GET", `/api/groups/${groupId}/catalog/${catalogItemId}`, { session: owner })).body as { runtimeMinutes: number | null };
  assert.equal(afterEdit.runtimeMinutes, 132, "a duração é editável depois da criação");
});

test("preflight: bloqueia ativação com erros, lista avisos, e é o mesmo portão do transition", async () => {
  const owner = await register("Dona Preflight", "dona_preflight");
  const member = await register("Participa Preflight", "participa_preflight");
  const groupId = ((await call("POST", "/api/groups", { session: owner, body: { name: "Clube Preflight" } })).body as { id: string }).id;
  const invite = (await call("POST", `/api/groups/${groupId}/invites`, { session: owner, body: { expiresInDays: 7, maxUses: 1 } })).body as { token: string };
  await call("POST", `/api/invites/${invite.token}`, { session: member, body: {} });

  const created = await call("POST", `/api/groups/${groupId}/challenges`, {
    session: owner,
    body: { recipe: "cinema", title: "Ainda cru", participantIds: [owner.user.id], items: [{ title: "Só um filme" }] },
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  const challengeId = (created.body as { id: string }).id;

  // Esvazia participantes e arquiva o único item — chega num estado inativável.
  await call("POST", `/api/challenges/${challengeId}/participants`, { session: owner, body: { replace: true, participantIds: [] } });
  const soleItem = ((await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as { items: Array<{ id: string }> }).items[0].id;
  await call("DELETE", `/api/challenges/${challengeId}/items/${soleItem}`, { session: owner });

  const badResp = await call("GET", `/api/challenges/${challengeId}/preflight`, { session: owner });
  assert.equal(badResp.response.status, 200, JSON.stringify(badResp.body));
  const bad = badResp.body as { ready: boolean; errors: Array<{ code: string }>; warnings: Array<{ code: string }> };
  assert.equal(bad.ready, false);
  const badCodes = bad.errors.map((issue) => issue.code);
  assert.ok(badCodes.includes("no_participants"), JSON.stringify(badCodes));
  assert.ok(badCodes.includes("no_items"), JSON.stringify(badCodes));

  // O transition usa o mesmo portão.
  const blocked = await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "active" } });
  assert.equal(blocked.response.status, 409, JSON.stringify(blocked.body));
  assert.equal((blocked.body as { error: string }).error, "challenge_incomplete");
  assert.ok(((blocked.body as { details?: { issues?: string[] } }).details?.issues ?? []).includes("no_participants"));

  // Participante comum não vê a revisão de um rascunho.
  assert.equal((await call("GET", `/api/challenges/${challengeId}/preflight`, { session: member })).response.status, 404);

  // Preenche participantes e itens.
  assert.ok((await call("POST", `/api/challenges/${challengeId}/participants`, {
    session: owner, body: { replace: true, participantIds: [owner.user.id, member.user.id] },
  })).response.ok);
  assert.ok((await call("POST", `/api/challenges/${challengeId}/items`, {
    session: owner, body: { items: [{ title: "Filme A" }, { title: "Filme B" }] },
  })).response.ok);

  // Métrica com amostra mínima inalcançável vira aviso, não erro.
  const detail = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    fields: Array<{ id: string; type: string }>;
  };
  const notaField = detail.fields.find((field) => field.type === "rating")!.id;
  await call("POST", `/api/challenges/${challengeId}/metrics`, {
    session: owner,
    body: { label: "Ranking exigente", operation: "bayesian_average", fieldId: notaField, groupBy: "item", minSample: 9 },
  });

  const good = (await call("GET", `/api/challenges/${challengeId}/preflight`, { session: owner })).body as {
    ready: boolean; errors: Array<{ code: string }>; warnings: Array<{ code: string }>;
  };
  assert.equal(good.ready, true, JSON.stringify(good.errors));
  assert.ok(good.warnings.some((issue) => issue.code === "ranking_min_sample_unreachable"), JSON.stringify(good.warnings));

  // Agora ativa.
  assert.equal((await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "active" } })).response.status, 200);
});

test("visibilidade por tipo de registro: tempo real, depois da própria, autor-only, depois de encerrar", async () => {
  const owner = await register("Dona Visao", "dona_visao_tipo");
  const p1 = await register("Um Visao", "um_visao_tipo");
  const p2 = await register("Dois Visao", "dois_visao_tipo");
  const groupId = ((await call("POST", "/api/groups", { session: owner, body: { name: "Clube Visão" } })).body as { id: string }).id;
  for (const member of [p1, p2]) {
    const invite = (await call("POST", `/api/groups/${groupId}/invites`, { session: owner, body: { expiresInDays: 7, maxUses: 1 } })).body as { token: string };
    await call("POST", `/api/invites/${invite.token}`, { session: member, body: {} });
  }
  const challenge = await call("POST", `/api/groups/${groupId}/challenges`, {
    session: owner,
    body: {
      recipe: "cinema", title: "Sessão Visão", participantIds: [owner.user.id, p1.user.id, p2.user.id],
      items: [{ title: "Filme X" }, { title: "Filme Y" }],
    },
  });
  const challengeId = (challenge.body as { id: string }).id;
  await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "active" } });
  const detail = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    entryTypes: Array<{ id: string; semanticKey: string; visibilityPolicy: string; fields: Array<{ id: string; key: string }> }>;
    items: Array<{ id: string; title: string }>;
  };
  const type = detail.entryTypes[0];
  assert.equal(type.visibilityPolicy, "group_realtime", "padrão da avaliação");
  const notaField = type.fields.find((field) => field.key === "nota")!.id;
  const typeId = type.id;
  const itemX = detail.items.find((item) => item.title === "Filme X")!.id;

  const countFor = async (session: Awaited<ReturnType<typeof register>>) =>
    ((await call("GET", `/api/challenges/${challengeId}/entries`, { session })).body as { entries: unknown[] }).entries.length;

  // "Depois da própria resposta".
  assert.equal((await call("PATCH", `/api/challenges/${challengeId}/entry-types/${typeId}`, { session: owner, body: { visibilityPolicy: "after_own" } })).response.status, 200);
  await call("POST", `/api/challenges/${challengeId}/entries`, { session: p1, body: { itemId: itemX, entryTypeId: typeId, values: { [notaField]: 5 } } });
  assert.equal(await countFor(p2), 0, "p2 não vê a nota de p1 antes de responder");
  assert.equal(await countFor(p1), 1, "o autor sempre vê a própria");
  assert.equal(await countFor(owner), 1, "o admin sempre vê tudo");
  await call("POST", `/api/challenges/${challengeId}/entries`, { session: p2, body: { itemId: itemX, entryTypeId: typeId, values: { [notaField]: 3 } } });
  assert.equal(await countFor(p2), 2, "depois de responder, p2 vê as duas");

  // "Somente autor e admins".
  await call("PATCH", `/api/challenges/${challengeId}/entry-types/${typeId}`, { session: owner, body: { visibilityPolicy: "author_only" } });
  assert.equal(await countFor(p2), 1, "author_only: p2 só vê a própria");
  assert.equal(await countFor(owner), 2, "admin ainda vê tudo");

  // "Depois do encerramento".
  await call("PATCH", `/api/challenges/${challengeId}/entry-types/${typeId}`, { session: owner, body: { visibilityPolicy: "after_close" } });
  assert.equal(await countFor(p2), 1, "durante o desafio, after_close esconde as alheias");
  await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "closed" } });
  assert.equal(await countFor(p2), 2, "encerrado, o grupo vê tudo");

  // Encerrado congela a política.
  assert.equal((await call("PATCH", `/api/challenges/${challengeId}/entry-types/${typeId}`, { session: owner, body: { visibilityPolicy: "group_realtime" } })).response.status, 409);
});

test("importação por JSON: prévia sem salvar, mapeia campos, avisa chave desconhecida, detecta duplicata, e o commit é atômico", async () => {
  const owner = await register("Dona Import", "dona_import_json");
  const keeper = await register("Curador Import", "curador_import_json");
  const groupId = ((await call("POST", "/api/groups", { session: owner, body: { name: "Clube Import" } })).body as { id: string }).id;
  const invite = (await call("POST", `/api/groups/${groupId}/invites`, { session: owner, body: { expiresInDays: 7, maxUses: 1 } })).body as { token: string };
  await call("POST", `/api/invites/${invite.token}`, { session: keeper, body: {} });

  const challenge = await call("POST", `/api/groups/${groupId}/challenges`, {
    session: owner,
    body: {
      recipe: "cinema", title: "Maratona Import", participantIds: [owner.user.id, keeper.user.id],
      items: [{ title: "Filme Já Existe" }],
    },
  });
  const challengeId = (challenge.body as { id: string }).id;

  const json = JSON.stringify([
    { title: "Aftersun", ano: 2022, indicadoPor: "Curador Import", vibe: "melancólica" },
    { title: "Filme Já Existe" },
    { notes: "sem título aqui" },
    { title: "Achado na Internet", origem: "lista de um blog" },
  ]);
  const preview = await call("POST", `/api/challenges/${challengeId}/items/preview`, { session: owner, body: { json } });
  assert.equal(preview.response.status, 200, JSON.stringify(preview.body));
  const previewBody = preview.body as {
    rows: Array<{
      index: number; title: string; valid: boolean; errors: string[];
      mapped: { year: number | null }; unknownKeys: string[];
      recommendation: { kind: string; name?: string; text?: string } | null;
      existingCatalogItemId: string | null; duplicateInChallenge: boolean;
    }>;
    summary: { total: number; importable: number; invalid: number; duplicatesInChallenge: number; unknownKeys: string[] };
  };
  assert.equal(previewBody.summary.total, 4);
  assert.equal(previewBody.summary.invalid, 1, "a linha sem título é inválida");
  assert.equal(previewBody.summary.duplicatesInChallenge, 1, "'Filme Já Existe' já é um item ativo");
  assert.deepEqual(previewBody.summary.unknownKeys, ["notes", "vibe"], "chaves fora do mapa conhecido são listadas");
  assert.equal(previewBody.rows[0].mapped.year, 2022, "'ano' foi mapeado para year");
  assert.equal(previewBody.rows[0].recommendation?.kind, "participant", "'indicadoPor' bateu com um participante");
  assert.equal(previewBody.rows[0].recommendation?.name, "Curador Import");
  assert.equal(previewBody.rows[1].duplicateInChallenge, true);
  assert.equal(previewBody.rows[2].valid, false);
  assert.equal(previewBody.rows[3].recommendation?.kind, "origin", "origem externa vira texto, não participante");
  assert.equal(previewBody.rows[3].recommendation?.text, "lista de um blog");

  const stillOne = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as { items: unknown[] };
  assert.equal(stillOne.items.length, 1, "a prévia não escreve nada");

  // Falha parcial: um item sem título derruba a operação inteira.
  const partial = await call("POST", `/api/challenges/${challengeId}/items`, {
    session: owner,
    body: { items: [{ title: "Bom Filme" }, { title: "  " }] },
  });
  assert.equal(partial.response.status, 400, JSON.stringify(partial.body));
  const afterPartial = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as { items: unknown[] };
  assert.equal(afterPartial.items.length, 1, "nada da lista parcial foi criado");

  // Commit consistente: indicação por participante e origem textual convivem.
  const commit = await call("POST", `/api/challenges/${challengeId}/items`, {
    session: owner,
    body: {
      items: [
        { title: "Aftersun", year: 2022, recommendedByUserId: keeper.user.id },
        { title: "Achado na Internet", originNote: "lista de um blog" },
      ],
    },
  });
  assert.equal(commit.response.status, 201, JSON.stringify(commit.body));
  const finalDetail = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    items: Array<{ title: string; recommendedBy: { name: string } | null; originNote: string | null }>;
  };
  assert.equal(finalDetail.items.length, 3);
  const aftersun = finalDetail.items.find((item) => item.title === "Aftersun")!;
  assert.equal(aftersun.recommendedBy?.name, "Curador Import");
  assert.equal(aftersun.originNote, null);
  const online = finalDetail.items.find((item) => item.title === "Achado na Internet")!;
  assert.equal(online.recommendedBy, null);
  assert.equal(online.originNote, "lista de um blog");

  // O limite da operação vale.
  const tooMany = await call("POST", `/api/challenges/${challengeId}/items/preview`, {
    session: owner,
    body: { json: JSON.stringify(Array.from({ length: 201 }, (_, i) => ({ title: `Filme ${i}` }))) },
  });
  assert.equal(tooMany.response.status, 400);
  assert.equal((tooMany.body as { error: string }).error, "json_too_large");
});

test("checkpoints genéricos: semanas com pausa, atribuição de itens, total de duração, e nada de registro órfão", async () => {
  const owner = await register("Dona Semana", "dona_semana_cp");
  const groupId = ((await call("POST", "/api/groups", { session: owner, body: { name: "Clube Semanal" } })).body as { id: string }).id;
  const challenge = await call("POST", `/api/groups/${groupId}/challenges`, {
    session: owner,
    body: {
      recipe: "cinema", title: "Maratona semanal", participantIds: [owner.user.id],
      startsOn: "2026-03-02", endsOn: "2026-03-29",
      items: [
        { title: "Filme A", runtimeMinutes: 100 },
        { title: "Filme B", runtimeMinutes: 120 },
        { title: "Filme C", runtimeMinutes: 90 },
      ],
    },
  });
  const challengeId = (challenge.body as { id: string }).id;

  // Duas semanas, com uma pausa de uma semana entre elas (não são consecutivas).
  const saved = await call("POST", `/api/challenges/${challengeId}/checkpoints`, {
    session: owner,
    body: {
      checkpoints: [
        { title: "Semana 1", kind: "week", startsAt: "2026-03-02", dueAt: "2026-03-08" },
        { title: "Semana 3", kind: "week", startsAt: "2026-03-16", dueAt: "2026-03-22" },
      ],
    },
  });
  assert.equal(saved.response.status, 200, JSON.stringify(saved.body));
  const savedCheckpoints = (saved.body as { checkpoints: Array<{ id: string; title: string }> }).checkpoints;
  assert.equal(savedCheckpoints.length, 2);
  const week1 = savedCheckpoints[0].id;
  const week3 = savedCheckpoints[1].id;

  const detail = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    entryTypes: Array<{ id: string; submissionMode: string }>;
    items: Array<{ id: string; title: string; checkpointId: string | null }>;
    checkpoints: Array<{ id: string; kind: string; itemCount: number; totalRuntimeMinutes: number | null; timeframe: string }>;
  };
  assert.equal(detail.checkpoints.every((cp) => cp.kind === "week"), true);
  const entryTypeId = detail.entryTypes[0].id;
  const entrySubmissionMode = detail.entryTypes[0].submissionMode;
  const itemByTitle = new Map(detail.items.map((item) => [item.title, item.id]));

  const assign = await call("POST", `/api/challenges/${challengeId}/items/assign`, {
    session: owner,
    body: {
      assignments: [
        { itemId: itemByTitle.get("Filme A"), checkpointId: week1 },
        { itemId: itemByTitle.get("Filme B"), checkpointId: week1 },
        { itemId: itemByTitle.get("Filme C"), checkpointId: week3 },
      ],
    },
  });
  assert.equal(assign.response.status, 200, JSON.stringify(assign.body));
  assert.equal((assign.body as { changed: number }).changed, 3);

  const withTotals = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    checkpoints: Array<{ id: string; itemCount: number; totalRuntimeMinutes: number | null }>;
  };
  const total1 = withTotals.checkpoints.find((cp) => cp.id === week1)!;
  assert.equal(total1.itemCount, 2);
  assert.equal(total1.totalRuntimeMinutes, 220, "soma a duração dos filmes da semana");

  // Remover a Semana 3 da lista: ela some e seus itens ficam sem checkpoint (não órfãos).
  const dropped = await call("POST", `/api/challenges/${challengeId}/checkpoints`, {
    session: owner,
    body: { checkpoints: [{ id: week1, title: "Semana 1", kind: "week", startsAt: "2026-03-02", dueAt: "2026-03-08" }] },
  });
  assert.equal(dropped.response.status, 200, JSON.stringify(dropped.body));
  const afterDrop = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    items: Array<{ title: string; checkpointId: string | null }>;
    checkpoints: Array<{ id: string }>;
  };
  assert.equal(afterDrop.checkpoints.length, 1);
  assert.equal(afterDrop.items.find((item) => item.title === "Filme C")?.checkpointId, null, "o item da semana removida volta a não ter checkpoint");

  // Um checkpoint com registro preso não pode ser removido.
  await adminPool.query(
    `INSERT INTO entries
       (id, challenge_id, entry_type_id, submission_mode, cardinality, participant_user_id, item_id, checkpoint_id,
        occurred_on, submitted_at, created_by_user_id, last_edited_by_user_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'once_per_item', $5, $6, $7, '2026-03-03', now(), $5, $5, now(), now())`,
    [crypto.randomUUID(), challengeId, entryTypeId, entrySubmissionMode, owner.user.id, itemByTitle.get("Filme A"), week1],
  );
  const blocked = await call("POST", `/api/challenges/${challengeId}/checkpoints`, {
    session: owner, body: { checkpoints: [] },
  });
  assert.equal(blocked.response.status, 409, JSON.stringify(blocked.body));
  assert.equal((blocked.body as { error: string }).error, "checkpoint_has_entries");
});

test("expectativa opcional: liga/desliga no rascunho, trava ao avaliar, e a visibilidade after_own esconde a alheia", async () => {
  const owner = await register("Dona Expect", "dona_expect_v1");
  const b = await register("Bea Expect", "bea_expect_v1");
  const c = await register("Cau Expect", "cau_expect_v1");
  const groupId = ((await call("POST", "/api/groups", { session: owner, body: { name: "Clube Expectativa" } })).body as { id: string }).id;
  for (const member of [b, c]) {
    const invite = (await call("POST", `/api/groups/${groupId}/invites`, { session: owner, body: { expiresInDays: 7, maxUses: 1 } })).body as { token: string };
    await call("POST", `/api/invites/${invite.token}`, { session: member, body: {} });
  }

  const challenge = await call("POST", `/api/groups/${groupId}/challenges`, {
    session: owner,
    body: {
      recipe: "cinema", title: "Ciclo com expectativa", participantIds: [owner.user.id, b.user.id, c.user.id],
      expectation: true,
      items: [{ title: "Filme X" }, { title: "Filme Y" }],
    },
  });
  const challengeId = (challenge.body as { id: string }).id;

  type ExpType = DetailType & { visibilityPolicy: string };
  const readTypes = async (session: ClientSession) =>
    ((await call("GET", `/api/challenges/${challengeId}`, { session })).body as { entryTypes: ExpType[] }).entryTypes;

  let types = await readTypes(owner);
  const expectation = types.find((type) => type.purpose === "expectation");
  assert.ok(expectation, "a receita já nasceu com o tipo de expectativa (expectation: true)");
  assert.equal(expectation!.visibilityPolicy, "after_own", "expectativa começa 'depois da própria resposta' (V1 §8)");

  // Liga/desliga enquanto é rascunho.
  assert.equal((await call("PATCH", `/api/challenges/${challengeId}/expectation`, { session: owner, body: { enabled: false } })).response.status, 200);
  assert.equal((await readTypes(owner)).some((type) => type.purpose === "expectation"), false, "desligou");
  assert.equal((await call("PATCH", `/api/challenges/${challengeId}/expectation`, { session: owner, body: { enabled: true } })).response.status, 200);
  types = await readTypes(owner);
  const expId = types.find((type) => type.purpose === "expectation")!.id;
  const ratingType = types.find((type) => type.purpose === "rating")!;

  const detail = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    entryTypes: Array<{ id: string; purpose: string; fields: Array<{ id: string; key: string }> }>;
    items: DetailItem[];
  };
  const expField = detail.entryTypes.find((type) => type.purpose === "expectation")!.fields[0].key;
  const notaField = detail.entryTypes.find((type) => type.purpose === "rating")!.fields.find((field) => field.key === "nota")!.id;
  const filmX = detail.items.find((item) => item.title === "Filme X")!.id;
  const filmY = detail.items.find((item) => item.title === "Filme Y")!.id;

  await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "active" } });

  // Expectativa antes da avaliação — B.
  assert.equal((await call("POST", `/api/challenges/${challengeId}/entries`, {
    session: b, body: { itemId: filmX, entryTypeId: expId, values: { [expField]: 4 } },
  })).response.status, 201);
  assert.equal((await call("POST", `/api/challenges/${challengeId}/entries`, {
    session: b, body: { itemId: filmX, entryTypeId: ratingType.id, values: { [notaField]: 3 } },
  })).response.status, 201);

  // Bloqueio posterior — a expectativa não muda depois da avaliação.
  const reExpect = await call("POST", `/api/challenges/${challengeId}/entries`, {
    session: b, body: { itemId: filmX, entryTypeId: expId, values: { [expField]: 1 } },
  });
  assert.equal(reExpect.response.status, 409);
  assert.equal((reExpect.body as { error: string }).error, "expectation_locked");
  const expEntryId = await adminPool.query<{ id: string }>(
    "SELECT id FROM entries WHERE entry_type_id=$1 AND participant_user_id=$2 AND deleted_at IS NULL",
    [expId, b.user.id],
  );
  assert.equal((await call("PATCH", `/api/entries/${expEntryId.rows[0].id}`, { session: b, body: { values: { [expField]: 2 } } })).response.status, 409);

  // Visibilidade after_own: C não vê a expectativa de B enquanto não registra a sua.
  const entriesFor = async (session: ClientSession) =>
    ((await call("GET", `/api/challenges/${challengeId}/entries`, { session })).body as { entries: Array<{ entryTypeId: string; userId: string }> }).entries;
  let cEntries = await entriesFor(c);
  assert.equal(cEntries.some((entry) => entry.entryTypeId === expId && entry.userId === b.user.id), false, "C não vê a expectativa de B");
  assert.equal(cEntries.some((entry) => entry.entryTypeId === ratingType.id && entry.userId === b.user.id), true, "mas vê a avaliação de B (tempo real)");
  await call("POST", `/api/challenges/${challengeId}/entries`, { session: c, body: { itemId: filmX, entryTypeId: expId, values: { [expField]: 5 } } });
  cEntries = await entriesFor(c);
  assert.equal(cEntries.some((entry) => entry.entryTypeId === expId && entry.userId === b.user.id), true, "depois de registrar a sua, C passa a ver a de B");

  // Conclusão inferida pelos registros: só a avaliação conta, não a expectativa.
  const myChallenge = async (session: ClientSession) =>
    ((await call("GET", "/api/bootstrap", { session })).body as { challenges: Array<{ id: string; completedCount: number; totalCount: number | null }> })
      .challenges.find((entry) => entry.id === challengeId)!;
  let mine = await myChallenge(b);
  assert.equal(mine.completedCount, 1, "B avaliou 1 filme (a expectativa não conta como conclusão)");
  assert.equal(mine.totalCount, 2);
  await call("POST", `/api/challenges/${challengeId}/entries`, { session: b, body: { itemId: filmY, entryTypeId: ratingType.id, values: { [notaField]: 4 } } });
  mine = await myChallenge(b);
  assert.equal(mine.completedCount, 2, "avaliou os dois");
});

test("preflight avisa quando a expectativa fica visível para o grupo antes da avaliação", async () => {
  const owner = await register("Dona Aviso", "dona_aviso_expect");
  const groupId = ((await call("POST", "/api/groups", { session: owner, body: { name: "Aviso Expect" } })).body as { id: string }).id;
  const challenge = await call("POST", `/api/groups/${groupId}/challenges`, {
    session: owner,
    body: { recipe: "cinema", title: "Com aviso", participantIds: [owner.user.id], expectation: true, items: [{ title: "Filme" }] },
  });
  const challengeId = (challenge.body as { id: string }).id;
  const types = ((await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as { entryTypes: Array<{ id: string; purpose: string }> }).entryTypes;
  const expId = types.find((type) => type.purpose === "expectation")!.id;

  const before = (await call("GET", `/api/challenges/${challengeId}/preflight`, { session: owner })).body as { warnings: Array<{ code: string }> };
  assert.equal(before.warnings.some((warning) => warning.code === "expectation_visible_early"), false);

  await call("PATCH", `/api/challenges/${challengeId}/entry-types/${expId}`, { session: owner, body: { visibilityPolicy: "group_realtime" } });
  const after = (await call("GET", `/api/challenges/${challengeId}/preflight`, { session: owner })).body as { warnings: Array<{ code: string }> };
  assert.equal(after.warnings.some((warning) => warning.code === "expectation_visible_early"), true);
});

test("métricas oficiais: mediana e consenso calculam pela fórmula, toda métrica traz explicação e amostra, e combinações inválidas caem", async () => {
  const owner = await register("Dona Métrica", "dona_metrica_v1");
  const b = await register("Beto Métrica", "beto_metrica_v1");
  const c = await register("Cida Métrica", "cida_metrica_v1");
  const groupId = ((await call("POST", "/api/groups", { session: owner, body: { name: "Clube Métrica" } })).body as { id: string }).id;
  for (const member of [b, c]) {
    const invite = (await call("POST", `/api/groups/${groupId}/invites`, { session: owner, body: { expiresInDays: 7, maxUses: 1 } })).body as { token: string };
    await call("POST", `/api/invites/${invite.token}`, { session: member, body: {} });
  }
  const challenge = await call("POST", `/api/groups/${groupId}/challenges`, {
    session: owner,
    body: {
      recipe: "cinema", title: "Notas variadas", participantIds: [owner.user.id, b.user.id, c.user.id],
      items: [{ title: "Filme Um" }, { title: "Filme Dois" }],
    },
  });
  const challengeId = (challenge.body as { id: string }).id;
  const detail = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    entryTypes: Array<{ id: string; purpose: string; fields: Array<{ id: string; key: string }> }>;
    items: DetailItem[];
  };
  const rating = detail.entryTypes.find((type) => type.purpose === "rating")!;
  const nota = rating.fields.find((field) => field.key === "nota")!.id;
  const um = detail.items.find((item) => item.title === "Filme Um")!.id;

  const median = await call("POST", `/api/challenges/${challengeId}/metrics`, {
    session: owner, body: { label: "Mediana das notas", operation: "median", fieldId: nota },
  });
  assert.equal(median.response.status, 201, JSON.stringify(median.body));
  const consensus = await call("POST", `/api/challenges/${challengeId}/metrics`, {
    session: owner, body: { label: "Consenso por filme", operation: "consensus", fieldId: nota, groupBy: "item", minSample: 2 },
  });
  assert.equal(consensus.response.status, 201, JSON.stringify(consensus.body));

  // Combinações inválidas.
  assert.equal((await call("POST", `/api/challenges/${challengeId}/metrics`, {
    session: owner, body: { label: "x", operation: "consensus", fieldId: nota, groupBy: "participant" },
  })).response.status, 400, "consenso não agrupa por participante");
  assert.equal((await call("POST", `/api/challenges/${challengeId}/metrics`, {
    session: owner, body: { label: "x", operation: "indicator_bias", fieldId: nota, groupBy: "item" },
  })).response.status, 400, "desempenho de indicação só agrupa por participante");
  const noExpectation = await call("POST", `/api/challenges/${challengeId}/metrics`, {
    session: owner, body: { label: "x", operation: "surprise", fieldId: nota },
  });
  assert.equal(noExpectation.response.status, 409, "surpresa exige um tipo de expectativa");
  assert.equal((noExpectation.body as { error: string }).error, "metric_needs_expectation");
  assert.equal((await call("POST", `/api/challenges/${challengeId}/metrics`, {
    session: owner, body: { label: "x", operation: "median", fieldId: rating.fields.find((field) => field.key === "comentario")!.id },
  })).response.status, 400, "mediana exige campo numérico");
  assert.equal((await call("POST", `/api/challenges/${challengeId}/metrics`, {
    session: owner, body: { label: "x", operation: "average", fieldId: nota, groupBy: "checkpoint" },
  })).response.status, 409, "sem checkpoints, não dá pra agrupar por checkpoint");

  await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "active" } });
  // Notas: 5, 3, 1 → média 3, mediana 3.
  await call("POST", `/api/challenges/${challengeId}/entries`, { session: owner, body: { itemId: um, entryTypeId: rating.id, values: { [nota]: 5 } } });
  await call("POST", `/api/challenges/${challengeId}/entries`, { session: b, body: { itemId: um, entryTypeId: rating.id, values: { [nota]: 3 } } });
  await call("POST", `/api/challenges/${challengeId}/entries`, { session: c, body: { itemId: um, entryTypeId: rating.id, values: { [nota]: 1 } } });

  const metrics = ((await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    metrics: Array<{ label: string; operation: string; value: number | null; explanation?: string; sample?: string; series?: Array<{ label: string; value: number | null }> }>;
  }).metrics;
  const medianRow = metrics.find((metric) => metric.operation === "median")!;
  assert.equal(medianRow.value, 3, "mediana de 5,3,1 é 3");
  assert.ok(medianRow.explanation && medianRow.explanation.length > 0, "toda métrica traz uma explicação de fórmula");
  assert.ok(medianRow.sample && /n\s*=\s*3/.test(medianRow.sample), "e a amostra usada");
  const consensusRow = metrics.find((metric) => metric.operation === "consensus")!;
  const umConsensus = consensusRow.series!.find((row) => row.label === "Filme Um")!;
  // notas 1..5, stdev de {5,3,1} = √(8/3) ≈ 1,633 ; consenso = (1 − 1,633/2,5) × 100 ≈ 35
  assert.ok(umConsensus.value !== null && umConsensus.value >= 30 && umConsensus.value <= 40, `consenso ~35, veio ${umConsensus.value}`);

  const completion = metrics.find((metric) => metric.operation === "completion_rate");
  if (completion) {
    assert.ok(/esperado/i.test(completion.sample ?? "") || /×/.test(completion.sample ?? ""), "conclusão explica o total esperado");
  }
});

test("métricas por checkpoint: uma linha por semana, e o modo acumulado soma as anteriores", async () => {
  const owner = await register("Dona Semana Métrica", "dona_semana_metrica");
  const b = await register("Bia Semana Métrica", "bia_semana_metrica");
  const groupId = ((await call("POST", "/api/groups", { session: owner, body: { name: "Semana Métrica" } })).body as { id: string }).id;
  const invite = (await call("POST", `/api/groups/${groupId}/invites`, { session: owner, body: { expiresInDays: 7, maxUses: 1 } })).body as { token: string };
  await call("POST", `/api/invites/${invite.token}`, { session: b, body: {} });

  const challenge = await call("POST", `/api/groups/${groupId}/challenges`, {
    session: owner,
    body: {
      recipe: "cinema", title: "Maratona medida", participantIds: [owner.user.id, b.user.id],
      startsOn: "2026-04-06", endsOn: "2026-04-26",
      items: [{ title: "A" }, { title: "B" }, { title: "C" }, { title: "D" }],
    },
  });
  const challengeId = (challenge.body as { id: string }).id;
  const detail = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    entryTypes: Array<{ id: string; purpose: string; fields: Array<{ id: string; key: string }> }>;
    items: DetailItem[];
  };
  const rating = detail.entryTypes.find((type) => type.purpose === "rating")!;
  const nota = rating.fields.find((field) => field.key === "nota")!.id;
  const itemId = (title: string) => detail.items.find((item) => item.title === title)!.id;

  const cps = await call("POST", `/api/challenges/${challengeId}/checkpoints`, {
    session: owner,
    body: { checkpoints: [
      { title: "Semana 1", kind: "week", startsAt: "2026-04-06", dueAt: "2026-04-12" },
      { title: "Semana 2", kind: "week", startsAt: "2026-04-13", dueAt: "2026-04-19" },
    ] },
  });
  const [w1, w2] = (cps.body as { checkpoints: Array<{ id: string }> }).checkpoints.map((cp) => cp.id);
  await call("POST", `/api/challenges/${challengeId}/items/assign`, {
    session: owner,
    body: { assignments: [
      { itemId: itemId("A"), checkpointId: w1 }, { itemId: itemId("B"), checkpointId: w1 },
      { itemId: itemId("C"), checkpointId: w2 }, { itemId: itemId("D"), checkpointId: w2 },
    ] },
  });

  const perWeek = await call("POST", `/api/challenges/${challengeId}/metrics`, {
    session: owner, body: { label: "Média por semana", operation: "average", fieldId: nota, groupBy: "checkpoint" },
  });
  assert.equal(perWeek.response.status, 201, JSON.stringify(perWeek.body));
  const cumulative = await call("POST", `/api/challenges/${challengeId}/metrics`, {
    session: owner, body: { label: "Média acumulada", operation: "average", fieldId: nota, groupBy: "checkpoint", cumulative: true },
  });
  assert.equal(cumulative.response.status, 201, JSON.stringify(cumulative.body));
  assert.equal((await call("POST", `/api/challenges/${challengeId}/metrics`, {
    session: owner, body: { label: "x", operation: "average", fieldId: nota, groupBy: "item", cumulative: true },
  })).response.status, 400, "acumulado só com checkpoint");

  await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "active" } });
  // Semana 1: notas 4 e 4 → média 4. Semana 2: notas 2 e 2 → média 2 ; acumulada 3.
  for (const [title, value] of [["A", 4], ["B", 4], ["C", 2], ["D", 2]] as const) {
    await call("POST", `/api/challenges/${challengeId}/entries`, { session: owner, body: { itemId: itemId(title), entryTypeId: rating.id, values: { [nota]: value } } });
  }

  const metrics = ((await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    metrics: Array<{ label: string; groupBy: string; cumulative?: boolean; series?: Array<{ label: string; value: number | null }> }>;
  }).metrics;
  const week = metrics.find((metric) => metric.label === "Média por semana")!;
  assert.equal(week.groupBy, "checkpoint");
  assert.deepEqual(week.series!.map((row) => [row.label, row.value]), [["Semana 1", 4], ["Semana 2", 2]], "cada semana isolada");
  const acc = metrics.find((metric) => metric.label === "Média acumulada")!;
  assert.equal(acc.cumulative, true);
  assert.deepEqual(acc.series!.map((row) => [row.label, row.value]), [["Semana 1", 4], ["Semana 2", 3]], "a segunda soma a primeira");
});

test("rankings pessoais e afinidade direta com três contas; afinidade composta só aparece com dados suficientes", async () => {
  const owner = await register("Ana Afin", "ana_afin_v1");
  const bob = await register("Bruno Afin", "bruno_afin_v1");
  const carol = await register("Carla Afin", "carla_afin_v1");
  const groupId = ((await call("POST", "/api/groups", { session: owner, body: { name: "Cineclube Afin" } })).body as { id: string }).id;
  for (const person of [bob, carol]) {
    const invite = (await call("POST", `/api/groups/${groupId}/invites`, { session: owner, body: { expiresInDays: 7, maxUses: 1 } })).body as { token: string };
    await call("POST", `/api/invites/${invite.token}`, { session: person, body: {} });
  }
  const items = Array.from({ length: 6 }, (_, i) => ({
    title: `F${i}`, year: 2000 + i, mainGenre: i % 2 === 0 ? "drama" : "ficção",
    ...(i === 0 ? { recommendedByUserId: bob.user.id } : {}),
  }));
  const challenge = await call("POST", `/api/groups/${groupId}/challenges`, {
    session: owner,
    body: { recipe: "cinema", title: "Afinidades", participantIds: [owner.user.id, bob.user.id, carol.user.id], expectation: true, items },
  });
  const challengeId = (challenge.body as { id: string }).id;
  const detail = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    entryTypes: Array<{ id: string; purpose: string; fields: Array<{ id: string; key: string }> }>;
    items: DetailItem[];
  };
  const rating = detail.entryTypes.find((type) => type.purpose === "rating")!;
  const expType = detail.entryTypes.find((type) => type.purpose === "expectation")!;
  const nota = rating.fields.find((field) => field.key === "nota")!.id;
  const expField = expType.fields[0].key;
  const idByTitle = new Map(detail.items.map((item) => [item.title, item.id]));

  await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "active" } });
  const rate = (session: ClientSession, title: string, value: number) =>
    call("POST", `/api/challenges/${challengeId}/entries`, { session, body: { itemId: idByTitle.get(title), entryTypeId: rating.id, values: { [nota]: value } } });

  // Bruno esperava pouco de F0 (que ele indicou) — a expectativa vai ANTES da avaliação.
  await call("POST", `/api/challenges/${challengeId}/entries`, { session: bob, body: { itemId: idByTitle.get("F0"), entryTypeId: expType.id, values: { [expField]: 1 } } });

  // Ana e Bruno bem parecidos nos 6 filmes; Carla diverge.
  for (let i = 0; i < 6; i += 1) {
    await rate(owner, `F${i}`, (i % 5) + 0.5 + 0.5);
    await rate(bob, `F${i}`, i === 0 ? 4 : (i % 5) + 1);
    await rate(carol, `F${i}`, 5 - (i % 5));
  }

  await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "closed" } });
  const result = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    result: {
      personalRankings: Array<{
        name: string; entryCount: number; ratingsMedian: number | null; consistency: number | null;
        topItems: Array<{ title: string }>; indicationPerformance: number | null;
        biggestSurprise: { title: string } | null;
      }>;
      affinity: { minSample: number; scale: number; pairs: Array<{ a: { name: string }; b: { name: string }; direct: number | null; composite: number | null; sampleSize: number }> } | null;
    };
  };
  const ranks = result.result.personalRankings;
  assert.equal(ranks.length, 3, "um bloco por participante");
  const bruno = ranks.find((row) => row.name === "Bruno Afin")!;
  assert.equal(bruno.entryCount, 6);
  assert.ok(bruno.ratingsMedian !== null, "traz mediana pessoal");
  assert.ok(bruno.consistency !== null, "e a consistência (desvio das próprias notas)");
  assert.ok(bruno.topItems.length > 0, "e o top pessoal");
  assert.ok(bruno.indicationPerformance !== null, "Bruno indicou F0 — tem desempenho de indicação");
  assert.ok(bruno.biggestSurprise !== null, "e a maior surpresa (avaliação acima da expectativa)");

  const affinity = result.result.affinity!;
  assert.equal(affinity.minSample, 5, "afinidade direta pede 5 itens em comum");
  assert.equal(affinity.scale, 5, "amplitude da escala");
  const anaBruno = affinity.pairs.find((pair) =>
    [pair.a.name, pair.b.name].sort().join("|") === ["Ana Afin", "Bruno Afin"].sort().join("|"))!;
  const anaCarol = affinity.pairs.find((pair) =>
    [pair.a.name, pair.b.name].sort().join("|") === ["Ana Afin", "Carla Afin"].sort().join("|"))!;
  assert.equal(anaBruno.sampleSize, 6);
  assert.ok(anaBruno.direct !== null && anaCarol.direct !== null);
  assert.ok(anaBruno.direct! > anaCarol.direct!, "Ana e Bruno mais afins que Ana e Carla");
  // Composta: 6 filmes, 2 gêneros (3 cada), 6 anos → gênero tem amostra, faixa de ano não.
  // Só deve aparecer se ao menos uma dimensão além de "itens" teve amostra.
  if (anaBruno.composite !== null) {
    assert.ok(anaBruno.composite >= 0 && anaBruno.composite <= 100);
  }

  // Publicação anônima mascara nomes nos rankings e nas afinidades.
  await call("POST", `/api/challenges/${challengeId}/results`, { session: owner, body: { anonymizeParticipants: true } });
  const pub = await call("POST", `/api/challenges/${challengeId}/results/publish`, { session: owner, body: {} });
  const token = (pub.body as { url: string }).url.split("/results/")[1];
  const shared = (await call("GET", `/api/results/${token}`, {})).body as {
    challenge: { result: { personalRankings: Array<{ name: string }>; affinity: { pairs: Array<{ a: { name: string } }> } } };
  };
  assert.ok(shared.challenge.result.personalRankings.every((row) => /^Participante \d+$/.test(row.name)), "rankings anônimos");
  assert.ok(shared.challenge.result.affinity.pairs.every((pair) => /^Participante \d+$/.test(pair.a.name)), "afinidades anônimas");
});

test("mudar a anonimização atualiza a vitrine já publicada ao vivo, sem tirar o link do ar", async () => {
  const owner = await register("Dona Anon", "dona_anon_flip");
  const b = await register("Bento Anon", "bento_anon_flip");
  const groupId = ((await call("POST", "/api/groups", { session: owner, body: { name: "Clube Anon" } })).body as { id: string }).id;
  const invite = (await call("POST", `/api/groups/${groupId}/invites`, { session: owner, body: { expiresInDays: 7, maxUses: 1 } })).body as { token: string };
  await call("POST", `/api/invites/${invite.token}`, { session: b, body: {} });
  const challenge = await call("POST", `/api/groups/${groupId}/challenges`, {
    session: owner, body: { recipe: "cinema", title: "Anon flip", participantIds: [owner.user.id, b.user.id], items: [{ title: "Filme A" }] },
  });
  const challengeId = (challenge.body as { id: string }).id;
  const d = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    entryTypes: Array<{ id: string; purpose: string; fields: Array<{ id: string; key: string }> }>; items: Array<{ id: string }>;
  };
  const rating = d.entryTypes.find((t) => t.purpose === "rating")!;
  const nota = rating.fields.find((f) => f.key === "nota")!.id;
  await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "active" } });
  for (const s of [owner, b]) {
    await call("PATCH", `/api/challenges/${challengeId}/consent`, { session: s, body: { nameConsent: true } });
    await call("POST", `/api/challenges/${challengeId}/entries`, { session: s, body: { itemId: d.items[0].id, entryTypeId: rating.id, values: { [nota]: 4 } } });
  }
  await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "closed" } });

  // Publica COM nomes.
  await call("POST", `/api/challenges/${challengeId}/results`, { session: owner, body: { metricIds: [], comments: [], anonymizeParticipants: false } });
  const pub = await call("POST", `/api/challenges/${challengeId}/results/publish`, { session: owner, body: {} });
  const token = (pub.body as { url: string }).url.split("/results/")[1];
  const named = await call("GET", `/api/results/${token}`);
  assert.equal(named.response.status, 200);
  assert.ok((named.body as { challenge: { participants: string[] } }).challenge.participants.includes("Bento Anon"), "com nomes, o nome real aparece");

  // Salvar com a anonimização invertida NÃO derruba o link — a próxima leitura já reflete a mudança.
  const flipped = await call("POST", `/api/challenges/${challengeId}/results`, { session: owner, body: { anonymizeParticipants: true } });
  assert.equal(flipped.response.status, 200, JSON.stringify(flipped.body));
  const anon = await call("GET", `/api/results/${token}`);
  assert.equal(anon.response.status, 200, "o mesmo link continua funcionando, sem precisar republicar");
  const anonNames = (anon.body as { challenge: { participants: string[] } }).challenge.participants;
  assert.ok(!anonNames.includes("Bento Anon"), "agora todo mundo aparece anonimizado, imediatamente");
  assert.ok(anonNames.every((name) => /^Participante \d+$/.test(name)));
});

test("publicação anônima mascara o nome de quem indicou o filme no ranking, não só os participantes", async () => {
  const owner = await register("Marta Indica", "marta_indica_anon");
  const b = await register("Beto Indica", "beto_indica_anon");
  const groupId = ((await call("POST", "/api/groups", { session: owner, body: { name: "Clube Indica" } })).body as { id: string }).id;
  const invite = (await call("POST", `/api/groups/${groupId}/invites`, { session: owner, body: { expiresInDays: 7, maxUses: 1 } })).body as { token: string };
  await call("POST", `/api/invites/${invite.token}`, { session: b, body: {} });
  const challenge = await call("POST", `/api/groups/${groupId}/challenges`, {
    session: owner,
    body: {
      recipe: "cinema", title: "Ciclo com indicações", participantIds: [owner.user.id, b.user.id],
      items: [
        { title: "O Filme da Marta", recommendedByUserId: owner.user.id },
        { title: "O Filme do Beto", recommendedByUserId: b.user.id },
        { title: "O Filme do Beto 2", recommendedByUserId: b.user.id },
      ],
    },
  });
  const challengeId = (challenge.body as { id: string }).id;
  const d = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    entryTypes: Array<{ id: string; purpose: string; fields: Array<{ id: string; key: string }> }>;
    items: Array<{ id: string; title: string }>;
  };
  const rating = d.entryTypes.find((t) => t.purpose === "rating")!;
  const nota = rating.fields.find((f) => f.key === "nota")!.id;
  await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "active" } });
  await call("POST", `/api/challenges/${challengeId}/metrics`, {
    session: owner, body: { label: "Ranking", operation: "bayesian_average", fieldId: nota, groupBy: "item", minSample: 1 },
  });
  for (const item of d.items) {
    for (const s of [owner, b]) {
      await call("POST", `/api/challenges/${challengeId}/entries`, { session: s, body: { itemId: item.id, entryTypeId: rating.id, values: { [nota]: 4 } } });
    }
  }
  await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "closed" } });
  await call("POST", `/api/challenges/${challengeId}/results`, { session: owner, body: { metricIds: [], comments: [], anonymizeParticipants: true } });
  const pub = await call("POST", `/api/challenges/${challengeId}/results/publish`, { session: owner, body: {} });
  const token = (pub.body as { url: string }).url.split("/results/")[1];
  const dump = JSON.stringify((await call("GET", `/api/results/${token}`)).body);
  assert.doesNotMatch(dump, /Marta Indica|Beto Indica/, "nenhum nome real de indicador aparece na vitrine anônima");
  assert.match(dump, /"recommendedBy":"Participante \d+"/, "a indicação vira rótulo genérico");
});

test("vitrine é anônima por padrão, e consentimento nominal libera o nome só de quem autorizou", async () => {
  const owner = await register("Dona Wrapped", "dona_wrapped_v1");
  const b = await register("Bela Wrapped", "bela_wrapped_v1");
  const c = await register("Caio Wrapped", "caio_wrapped_v1");
  const groupId = ((await call("POST", "/api/groups", { session: owner, body: { name: "Clube Wrapped" } })).body as { id: string }).id;
  for (const member of [b, c]) {
    const invite = (await call("POST", `/api/groups/${groupId}/invites`, { session: owner, body: { expiresInDays: 7, maxUses: 1 } })).body as { token: string };
    await call("POST", `/api/invites/${invite.token}`, { session: member, body: {} });
  }
  const challenge = await call("POST", `/api/groups/${groupId}/challenges`, {
    session: owner,
    body: { recipe: "cinema", title: "Retrô do clube", participantIds: [owner.user.id, b.user.id, c.user.id], items: [{ title: "Filme A" }, { title: "Filme B" }] },
  });
  const challengeId = (challenge.body as { id: string }).id;

  // Nasce anônima por padrão (V1 §12).
  assert.equal((await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body && true, true);
  const detail0 = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    resultsAnon: boolean;
    participants: Array<{ id: string; nameConsent: boolean }>;
    entryTypes: Array<{ id: string; purpose: string; fields: Array<{ id: string; key: string }> }>;
    items: DetailItem[];
  };
  assert.equal(detail0.resultsAnon, true, "publicação anônima por padrão");
  assert.equal(detail0.participants.every((p) => p.nameConsent === false), true, "ninguém autorizou o nome ainda");

  const rating = detail0.entryTypes.find((type) => type.purpose === "rating")!;
  const nota = rating.fields.find((field) => field.key === "nota")!.id;
  const itemA = detail0.items.find((item) => item.title === "Filme A")!.id;

  await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "active" } });

  // B autoriza o nome; C não (o consentimento é sempre da própria pessoa).
  assert.equal((await call("PATCH", `/api/challenges/${challengeId}/consent`, { session: b, body: { nameConsent: true } })).response.status, 200);
  assert.equal((await call("PATCH", `/api/challenges/${challengeId}/consent`, { session: c, body: { nameConsent: false } })).response.status, 200);
  // Quem não participa não pode mexer no consentimento.
  const outsider = await register("De Fora", "de_fora_wrapped");
  assert.ok([403, 404].includes((await call("PATCH", `/api/challenges/${challengeId}/consent`, { session: outsider, body: { nameConsent: true } })).response.status));
  const bView = (await call("GET", `/api/challenges/${challengeId}`, { session: b })).body as { viewerNameConsent: boolean };
  assert.equal(bView.viewerNameConsent, true);

  for (const session of [owner, b, c]) {
    await call("POST", `/api/challenges/${challengeId}/entries`, { session, body: { itemId: itemA, entryTypeId: rating.id, values: { [nota]: 4 } } });
  }

  // Métrica por participante para checar nomes na série (só dá para criar antes de encerrar).
  assert.equal(
    (await call("POST", `/api/challenges/${challengeId}/metrics`, { session: owner, body: { label: "Notas por pessoa", operation: "average", fieldId: nota, groupBy: "participant" } })).response.status,
    201,
  );
  await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "closed" } });

  // Publicação COM nomes: anonimiza só quem não autorizou.
  await call("POST", `/api/challenges/${challengeId}/results`, { session: owner, body: { anonymizeParticipants: false } });
  const pub = await call("POST", `/api/challenges/${challengeId}/results/publish`, { session: owner, body: {} });
  const token = (pub.body as { url: string }).url.split("/results/")[1];
  const shared = (await call("GET", `/api/results/${token}`)).body as {
    challenge: { participants: string[]; result: { metrics: Array<{ label?: string; groupBy?: string; series?: Array<{ label: string }> }> } };
  };
  assert.ok(shared.challenge.participants.includes("Bela Wrapped"), "quem autorizou aparece com o nome real");
  assert.ok(!shared.challenge.participants.includes("Caio Wrapped"), "quem não autorizou fica anônimo mesmo numa publicação com nomes");
  assert.ok(shared.challenge.participants.some((name) => /^Participante \d+$/.test(name)), "e recebe rótulo genérico");
  const perPerson = shared.challenge.result.metrics.find((metric) => metric.label === "Notas por pessoa")!;
  const labels = perPerson.series!.map((row) => row.label);
  assert.ok(labels.includes("Bela Wrapped"));
  assert.ok(!labels.includes("Caio Wrapped"));
});

test("blocos organizáveis: o admin reordena e esconde blocos, e o valor recalculado ao vivo se mantém coerente", async () => {
  const owner = await register("Dona Blocos", "dona_blocos_v1");
  const b = await register("Beto Blocos", "beto_blocos_v1");
  const groupId = ((await call("POST", "/api/groups", { session: owner, body: { name: "Clube Blocos" } })).body as { id: string }).id;
  const invite = (await call("POST", `/api/groups/${groupId}/invites`, { session: owner, body: { expiresInDays: 7, maxUses: 1 } })).body as { token: string };
  await call("POST", `/api/invites/${invite.token}`, { session: b, body: {} });
  const challenge = await call("POST", `/api/groups/${groupId}/challenges`, {
    session: owner,
    body: { recipe: "cinema", title: "Ordem importa", participantIds: [owner.user.id, b.user.id], items: [{ title: "F1" }, { title: "F2" }] },
  });
  const challengeId = (challenge.body as { id: string }).id;
  const detail = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    entryTypes: Array<{ id: string; purpose: string; fields: Array<{ id: string; key: string }> }>;
    items: DetailItem[];
  };
  const rating = detail.entryTypes.find((type) => type.purpose === "rating")!;
  const nota = rating.fields.find((field) => field.key === "nota")!.id;
  await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "active" } });
  for (const item of detail.items) {
    await call("POST", `/api/challenges/${challengeId}/entries`, { session: owner, body: { itemId: item.id, entryTypeId: rating.id, values: { [nota]: 4 } } });
    await call("POST", `/api/challenges/${challengeId}/entries`, { session: b, body: { itemId: item.id, entryTypeId: rating.id, values: { [nota]: 5 } } });
  }
  await call("POST", `/api/challenges/${challengeId}/metrics`, { session: owner, body: { label: "Média geral", operation: "average", fieldId: nota } });
  await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "closed" } });
  // O admin escreve o resumo — é o bloco de texto que o teste vai esconder.
  await call("POST", `/api/challenges/${challengeId}/results`, { session: owner, body: { summary: "Resumo do clube." } });

  const before = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    result: { blocks: Array<{ id: string; kind: string; position: number; visible: boolean; metric?: { value: number | null } }> };
  };
  assert.ok(before.result.blocks.length >= 2, "a vitrine gerada tem blocos");
  const metricBlock = before.result.blocks.find((block) => block.kind === "metric")!;
  const metricValue = metricBlock.metric?.value ?? null;

  // Inverte a ordem e esconde um bloco.
  const reversed = [...before.result.blocks].reverse().map((block) => ({ id: block.id, visible: block.kind !== "text" }));
  const reorder = await call("PATCH", `/api/challenges/${challengeId}/results/blocks`, { session: owner, body: { blocks: reversed } });
  assert.equal(reorder.response.status, 200, JSON.stringify(reorder.body));

  const after = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    result: { blocks: Array<{ id: string; kind: string; position: number; visible: boolean; metric?: { value: number | null } }> };
  };
  assert.deepEqual(
    after.result.blocks.map((block) => block.id),
    reversed.map((block) => block.id),
    "a nova ordem persiste",
  );
  assert.equal(after.result.blocks.find((block) => block.kind === "text")?.visible, false, "o bloco de texto foi escondido");
  assert.equal(after.result.blocks.find((block) => block.kind === "metric")?.metric?.value, metricValue, "o valor recalculado ao vivo continua o mesmo, pois nenhum novo registro foi lançado");

  // Bloco de outra vitrine é recusado.
  assert.equal((await call("PATCH", `/api/challenges/${challengeId}/results/blocks`, { session: owner, body: { blocks: [{ id: "nao-existe", visible: true }] } })).response.status, 404);
});

test("quem sai do grupo tem a identidade mascarada ao vivo, sem tirar a vitrine do ar; resultado público e template são conceitos separados", async () => {
  const owner = await register("Dona Saída", "dona_saida_wrapped");
  const leaver = await register("Vai Embora", "vai_embora_wrapped");
  const groupId = ((await call("POST", "/api/groups", { session: owner, body: { name: "Clube Saída" } })).body as { id: string }).id;
  const invite = (await call("POST", `/api/groups/${groupId}/invites`, { session: owner, body: { expiresInDays: 7, maxUses: 1 } })).body as { token: string };
  await call("POST", `/api/invites/${invite.token}`, { session: leaver, body: {} });
  const challenge = await call("POST", `/api/groups/${groupId}/challenges`, {
    session: owner,
    body: { recipe: "cinema", title: "Antes da saída", participantIds: [owner.user.id, leaver.user.id], items: [{ title: "Filme" }] },
  });
  const challengeId = (challenge.body as { id: string }).id;
  const detail = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    entryTypes: Array<{ id: string; purpose: string; fields: Array<{ id: string; key: string }> }>;
    items: DetailItem[];
  };
  const rating = detail.entryTypes.find((type) => type.purpose === "rating")!;
  const nota = rating.fields.find((field) => field.key === "nota")!.id;
  await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "active" } });
  await call("POST", `/api/challenges/${challengeId}/entries`, { session: owner, body: { itemId: detail.items[0].id, entryTypeId: rating.id, values: { [nota]: 4 } } });
  await call("POST", `/api/challenges/${challengeId}/entries`, { session: leaver, body: { itemId: detail.items[0].id, entryTypeId: rating.id, values: { [nota]: 2 } } });
  // Both consent to a named publication before the leaver ever leaves.
  await call("PATCH", `/api/challenges/${challengeId}/consent`, { session: owner, body: { nameConsent: true } });
  await call("PATCH", `/api/challenges/${challengeId}/consent`, { session: leaver, body: { nameConsent: true } });
  await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "closed" } });
  await call("POST", `/api/challenges/${challengeId}/results`, { session: owner, body: { metricIds: [], comments: [], anonymizeParticipants: false } });
  const pub = await call("POST", `/api/challenges/${challengeId}/results/publish`, { session: owner, body: {} });
  const token = (pub.body as { url: string }).url.split("/results/")[1];
  const before = await call("GET", `/api/results/${token}`);
  assert.equal(before.response.status, 200);
  assert.ok((before.body as { challenge: { participants: string[] } }).challenge.participants.includes("Vai Embora"), "antes de sair, o nome real aparece (consentiu)");

  // O template é outro conceito: publicar um não publica o outro.
  const detailAfterPublish = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as { publishedAsTemplate?: boolean };
  assert.notEqual(detailAfterPublish.publishedAsTemplate, true, "publicar a vitrine não cria template");

  // Vai Embora sai do grupo → o link continua no ar, mas o nome dele some.
  assert.equal((await call("POST", `/api/groups/${groupId}/leave`, { session: leaver, body: {} })).response.status, 200);
  const after = await call("GET", `/api/results/${token}`);
  assert.equal(after.response.status, 200, "o link publicado continua funcionando depois que alguém sai");
  const afterNames = (after.body as { challenge: { participants: string[] } }).challenge.participants;
  assert.ok(!afterNames.includes("Vai Embora"), "o nome de quem saiu some imediatamente, sem precisar republicar");
  assert.ok(afterNames.includes("Dona Saída"), "quem ficou continua visível normalmente");
});

// ── ROADMAP §13/§14 — recoverable deletion ────────────────────────────────

test("lixeira: um desafio binado some das listas, aparece em /trash e restaura com o mesmo id", async () => {
  const owner = await register("Dona Bin", "dona_bin_v1");
  const groupId = ((await call("POST", "/api/groups", { session: owner, body: { name: "Clube Bin" } })).body as { id: string }).id;
  const challenge = await call("POST", `/api/groups/${groupId}/challenges`, {
    session: owner,
    body: { recipe: "cinema", title: "Some e volta", participantIds: [owner.user.id], items: [{ title: "F1" }, { title: "F2" }] },
  });
  const challengeId = (challenge.body as { id: string }).id;

  assert.equal((await call("DELETE", `/api/challenges/${challengeId}`, { session: owner })).response.status, 200);
  assert.equal((await call("GET", `/api/challenges/${challengeId}`, { session: owner })).response.status, 404, "some da experiência normal");

  const trash = (await call("GET", `/api/groups/${groupId}/trash`, { session: owner })).body as {
    items: Array<{ kind: string; id: string; dependencies: Array<{ type: string; count: number }> }>;
  };
  const row = trash.items.find((item) => item.id === challengeId)!;
  assert.equal(row.kind, "challenge");
  assert.ok(row.dependencies.some((dep) => dep.type === "items" && dep.count === 2), "a linha informa o conteúdo dependente");

  // Repeated reads: it stays in the bin, nothing removes it automatically.
  const again = (await call("GET", `/api/groups/${groupId}/trash`, { session: owner })).body as { items: Array<{ id: string }> };
  assert.ok(again.items.some((item) => item.id === challengeId), "fica na lixeira até uma ação manual");

  const restore = await call("POST", `/api/groups/${groupId}/trash/restore`, { session: owner, body: { kind: "challenge", id: challengeId } });
  assert.equal(restore.response.status, 200, JSON.stringify(restore.body));
  const back = await call("GET", `/api/challenges/${challengeId}`, { session: owner });
  assert.equal(back.response.status, 200, "volta com o mesmo id");
  assert.equal((back.body as { items: unknown[] }).items.length, 2, "a estrutura volta junto");
});

test("lixeira: exclusão permanente mostra os alvos, exige a contagem e some de vez", async () => {
  const owner = await register("Dona Purga", "dona_purga_v1");
  const b = await register("Beto Purga", "beto_purga_v1");
  const groupId = ((await call("POST", "/api/groups", { session: owner, body: { name: "Clube Purga" } })).body as { id: string }).id;
  const invite = (await call("POST", `/api/groups/${groupId}/invites`, { session: owner, body: { expiresInDays: 7, maxUses: 1 } })).body as { token: string };
  await call("POST", `/api/invites/${invite.token}`, { session: b, body: {} });
  const challenge = await call("POST", `/api/groups/${groupId}/challenges`, {
    session: owner,
    body: { recipe: "cinema", title: "Para apagar", participantIds: [owner.user.id, b.user.id], items: [{ title: "Filme" }] },
  });
  const challengeId = (challenge.body as { id: string }).id;
  const detail = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    entryTypes: Array<{ id: string; purpose: string; fields: Array<{ id: string; key: string }> }>;
    items: Array<{ id: string; title: string }>;
  };
  const rating = detail.entryTypes.find((type) => type.purpose === "rating")!;
  const nota = rating.fields.find((field) => field.key === "nota")!.id;
  await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "active" } });
  for (const session of [owner, b]) {
    await call("POST", `/api/challenges/${challengeId}/entries`, { session, body: { itemId: detail.items[0].id, entryTypeId: rating.id, values: { [nota]: 4 } } });
  }
  await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "closed" } });
  await call("DELETE", `/api/challenges/${challengeId}`, { session: owner });

  // Show the targets first (never destroy before demonstrating what dies).
  const preview = await call("POST", `/api/groups/${groupId}/trash/preview`, { session: owner, body: { kind: "challenge", id: challengeId } });
  assert.equal(preview.response.status, 200, JSON.stringify(preview.body));
  const entriesTarget = (preview.body as { dependencies: Array<{ type: string; count: number }>; confirmation: string });
  assert.equal(entriesTarget.confirmation, "count");
  const entryCount = entriesTarget.dependencies.find((dep) => dep.type === "entries")?.count ?? 0;
  assert.equal(entryCount, 2);

  // Wrong confirmation is refused.
  assert.equal(
    (await call("POST", `/api/groups/${groupId}/trash/purge`, { session: owner, body: { kind: "challenge", id: challengeId, confirmation: "0" } })).response.status,
    409,
  );
  const purge = await call("POST", `/api/groups/${groupId}/trash/purge`, {
    session: owner, body: { kind: "challenge", id: challengeId, confirmation: String(entryCount) },
  });
  assert.equal(purge.response.status, 200, JSON.stringify(purge.body));
  const gone = await adminPool.query("SELECT 1 FROM challenges WHERE id = $1", [challengeId]);
  assert.equal(gone.rowCount, 0, "a árvore inteira do desafio some");
  const audit = await adminPool.query<{ action: string }>("SELECT action FROM system_audit_events WHERE entity_kind = 'challenge'");
  assert.ok(audit.rows.some((r) => r.action === "challenge.purged"), "a purga fica no log operacional sem conteúdo");
});

test("lixeira: esvaziar apaga tudo de uma vez, registra no log e exige owner/admin", async () => {
  const owner = await register("Dona Esvazia", "dona_esvazia_v1");
  const groupId = ((await call("POST", "/api/groups", { session: owner, body: { name: "Clube Esvazia" } })).body as { id: string }).id;
  const mk = async (title: string) =>
    ((await call("POST", `/api/groups/${groupId}/challenges`, {
      session: owner,
      body: { recipe: "cinema", title, participantIds: [owner.user.id], items: [{ title: "Filme" }] },
    })).body as { id: string }).id;
  const a = await mk("Rascunho A");
  const b = await mk("Rascunho B");
  await call("DELETE", `/api/challenges/${a}`, { session: owner });
  await call("DELETE", `/api/challenges/${b}`, { session: owner });

  const before = (await call("GET", `/api/groups/${groupId}/trash`, { session: owner })).body as { items: Array<{ id: string }> };
  assert.equal(before.items.length, 2, "dois desafios na lixeira");

  // A non-admin stranger cannot empty someone else's group bin.
  const stranger = await register("Estranho Esvazia", "estranho_esvazia_v1");
  assert.ok(
    [403, 404].includes((await call("POST", `/api/groups/${groupId}/trash/empty`, { session: stranger, body: {} })).response.status),
  );

  const empty = await call("POST", `/api/groups/${groupId}/trash/empty`, { session: owner, body: {} });
  assert.equal(empty.response.status, 200, JSON.stringify(empty.body));
  assert.deepEqual(empty.body, { emptied: true, purged: 2, skipped: 0 });

  const after = (await call("GET", `/api/groups/${groupId}/trash`, { session: owner })).body as { items: unknown[] };
  assert.deepEqual(after.items, [], "a lixeira fica vazia");
  const gone = await adminPool.query("SELECT 1 FROM challenges WHERE id = ANY($1::text[])", [[a, b]]);
  assert.equal(gone.rowCount, 0, "as linhas somem de vez");
  const purged = await adminPool.query<{ action: string }>(
    "SELECT action FROM system_audit_events WHERE entity_kind='challenge'",
  );
  assert.ok(purged.rows.some((r) => r.action === "challenge.purged"), "a purga fica no log operacional");
});

test("lixeira: um item de catálogo usado por um desafio fechado é arquivado, não pode ser apagado", async () => {
  const owner = await register("Dona Acervo", "dona_acervo_bin");
  const groupId = ((await call("POST", "/api/groups", { session: owner, body: { name: "Cineclube Acervo" } })).body as { id: string }).id;
  const challenge = await call("POST", `/api/groups/${groupId}/challenges`, {
    session: owner,
    body: { recipe: "cinema", title: "Rodada única", startsOn: "2026-01-01", endsOn: "2026-01-31", participantIds: [owner.user.id], items: [{ title: "Stalker", year: 1979 }] },
  });
  const challengeId = (challenge.body as { id: string }).id;
  await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "active" } });
  await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "closed" } });
  const catalog = (await call("GET", `/api/groups/${groupId}/catalog`, { session: owner })).body as { items: Array<{ id: string; title: string }> };
  const itemId = catalog.items.find((item) => item.title === "Stalker")!.id;

  assert.equal((await call("DELETE", `/api/catalog/${itemId}`, { session: owner })).response.status, 200, "remove do catálogo → vai para a lixeira");
  const trash = (await call("GET", `/api/groups/${groupId}/trash`, { session: owner })).body as {
    items: Array<{ kind: string; id: string; blocked: { code: string } | null }>;
  };
  const row = trash.items.find((item) => item.id === itemId)!;
  assert.equal(row.kind, "catalog_item");
  assert.ok(row.blocked && row.blocked.code === "catalog_in_use", "exclusão permanente bloqueada enquanto há histórico");
  assert.equal(
    (await call("POST", `/api/groups/${groupId}/trash/purge`, { session: owner, body: { kind: "catalog_item", id: itemId } })).response.status,
    409,
  );
  assert.equal((await call("POST", `/api/groups/${groupId}/trash/restore`, { session: owner, body: { kind: "catalog_item", id: itemId } })).response.status, 200, "mas restaura");
});

test("lixeira: filho não restaura sem o pai; restaurar o pai traz o filho de volta", async () => {
  const owner = await register("Dona Pai", "dona_pai_bin");
  const groupId = ((await call("POST", "/api/groups", { session: owner, body: { name: "Clube Pai" } })).body as { id: string }).id;
  const challenge = await call("POST", `/api/groups/${groupId}/challenges`, {
    session: owner,
    body: { recipe: "cinema", title: "Pai e filho", participantIds: [owner.user.id], items: [{ title: "A" }, { title: "B" }] },
  });
  const challengeId = (challenge.body as { id: string }).id;
  const items = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as { items: Array<{ id: string; title: string }> };
  const itemB = items.items.find((item) => item.title === "B")!.id;

  await call("DELETE", `/api/challenges/${challengeId}/items/${itemB}`, { session: owner }); // archive the item
  await call("DELETE", `/api/challenges/${challengeId}`, { session: owner }); // bin the parent

  const restoreChild = await call("POST", `/api/challenges/${challengeId}/trash/restore`, { session: owner, body: { kind: "challenge_item", id: itemB } });
  assert.equal(restoreChild.response.status, 409, "o pai binado bloqueia o filho");
  assert.equal((restoreChild.body as { error: string }).error, "parent_trashed");

  await call("POST", `/api/groups/${groupId}/trash/restore`, { session: owner, body: { kind: "challenge", id: challengeId } });
  const afterParent = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as { items: Array<{ title: string }> };
  assert.ok(afterParent.items.some((item) => item.title === "A"), "o item que não foi binado sozinho volta com o pai");
});

test("conta: desativar é reversível e trava mutações; excluir de vez exige senha", async () => {
  const person = await register("Vai Voltar", "vai_voltar_v1");
  const groupId = ((await call("POST", "/api/groups", { session: person, body: { name: "Clube Pausa" } })).body as { id: string }).id;

  const off = await call("POST", "/api/account/deactivate", { session: person, body: {} });
  assert.equal(off.response.status, 200);
  assert.match(off.response.headers.get("set-cookie") ?? "", /Max-Age=0/i);

  // Can log back in, but only to reactivate — every other mutation is blocked.
  const relog = await login("vai_voltar_v1");
  const boot = (await call("GET", "/api/bootstrap", { session: relog })).body as { user: { deactivated?: boolean } };
  assert.equal(boot.user.deactivated, true);
  const blocked = await call("POST", "/api/groups", { session: relog, body: { name: "Não deveria" } });
  assert.equal(blocked.response.status, 403);
  assert.equal((blocked.body as { error: string }).error, "account_deactivated");

  const on = await call("POST", "/api/account/reactivate", { session: relog, body: {} });
  assert.equal(on.response.status, 200);
  assert.equal(((on.body as { user: { deactivated: boolean } }).user).deactivated, false);
  assert.equal((await call("GET", `/api/groups/${groupId}/trash`, { session: relog })).response.status, 200, "de volta ao normal");

  // Permanent delete needs the right password.
  assert.equal((await call("POST", "/api/account/delete", { session: relog, body: { password: "errada" } })).response.status, 403);
  assert.equal((await call("POST", "/api/account/delete", { session: relog, body: { password: "uma senha segura 123" } })).response.status, 200);
  const groupGone = await adminPool.query("SELECT 1 FROM groups WHERE id = $1", [groupId]);
  assert.equal(groupGone.rowCount, 0, "grupo solo apagado de vez, sem órfão");
});

// ── ROADMAP §16 — cenário autossuficiente de aceitação (todos os 23 passos) ──

test("cenário de aceitação V1: grupo de 6, Cinema com semanas, JSON, expectativa, métricas, Wrapped, publicação, lixeira", async () => {
  // 1. Grupo com 6 participantes.
  const owner = await register("Aceite Dona", "aceite_dona");
  const members = await Promise.all(
    ["b", "c", "d", "e", "f"].map((slug) => register(`Aceite ${slug.toUpperCase()}`, `aceite_${slug}`)),
  );
  const everyone = [owner, ...members];
  const groupId = ((await call("POST", "/api/groups", { session: owner, body: { name: "Cineclube de Aceite" } })).body as { id: string }).id;
  for (const member of members) {
    const invite = (await call("POST", `/api/groups/${groupId}/invites`, { session: owner, body: { expiresInDays: 7, maxUses: 1 } })).body as { token: string };
    assert.equal((await call("POST", `/api/invites/${invite.token}`, { session: member, body: {} })).response.status, 200);
  }
  const groupDetail = (await call("GET", "/api/bootstrap", { session: owner })).body as { groups: Array<{ id: string; members?: unknown[] }> };
  assert.equal(groupDetail.groups.find((g) => g.id === groupId)?.members?.length, 6, "6 pessoas no grupo");

  // 2 + 3. Desafio Cinema com período de 10 semanas; 8 checkpoints semanais e 2 pausas.
  const challenge = await call("POST", `/api/groups/${groupId}/challenges`, {
    session: owner,
    body: {
      recipe: "cinema", title: "Maratona do Aceite",
      startsOn: "2026-05-04", endsOn: "2026-07-12",
      participantIds: everyone.map((s) => s.user.id),
      expectation: true,
      items: [{ title: "Filme 07" }],
    },
  });
  assert.equal(challenge.response.status, 201, JSON.stringify(challenge.body));
  const challengeId = (challenge.body as { id: string }).id;

  const weeks = [
    ["Semana 1", "2026-05-04", "2026-05-10"], ["Semana 2", "2026-05-11", "2026-05-17"], ["Semana 3", "2026-05-18", "2026-05-24"],
    ["Semana 5", "2026-06-01", "2026-06-07"], ["Semana 6", "2026-06-08", "2026-06-14"], ["Semana 7", "2026-06-15", "2026-06-21"],
    ["Semana 9", "2026-06-29", "2026-07-05"], ["Semana 10", "2026-07-06", "2026-07-12"],
  ];
  const cpSave = await call("POST", `/api/challenges/${challengeId}/checkpoints`, {
    session: owner,
    body: { checkpoints: weeks.map(([title, startsAt, dueAt]) => ({ title, kind: "week", startsAt, dueAt })) },
  });
  assert.equal(cpSave.response.status, 200, JSON.stringify(cpSave.body));
  const checkpoints = (cpSave.body as { checkpoints: Array<{ id: string; title: string }> }).checkpoints;
  assert.equal(checkpoints.length, 8, "8 checkpoints (semanas 4 e 8 são pausas)");

  // 9 (antes do commit): atributo editorial opcional no acervo do grupo.
  const attr = await call("POST", `/api/groups/${groupId}/catalog-attributes`, {
    session: owner, body: { kind: "film", label: "Diretor", type: "text" },
  });
  assert.equal(attr.response.status, 201, JSON.stringify(attr.body));
  const attrKey = (attr.body as { key: string }).key;

  // 4 + 5. Colar 30 filmes por JSON, revisar duplicidade / inválido / chave desconhecida antes de salvar.
  const films = Array.from({ length: 30 }, (_v, i) => ({ title: `Filme ${String(i + 1).padStart(2, "0")}` }));
  const listJson = JSON.stringify([
    ...films,
    { vibe: "sem título" },
    { title: "Filme 31", diretorx: "Alguém" },
  ]);
  const preview = await call("POST", `/api/challenges/${challengeId}/items/preview`, { session: owner, body: { json: listJson } });
  assert.equal(preview.response.status, 200, JSON.stringify(preview.body));
  const pv = preview.body as { summary: { total: number; invalid: number; duplicatesInChallenge: number; unknownKeys: string[] } };
  assert.equal(pv.summary.total, 32);
  assert.equal(pv.summary.invalid, 1, "linha sem título é inválida");
  assert.equal(pv.summary.duplicatesInChallenge, 1, "'Filme 07' já é um item ativo");
  assert.deepEqual(pv.summary.unknownKeys, ["diretorx", "vibe"]);
  assert.equal(((await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as { items: unknown[] }).items.length, 1, "a prévia não grava nada");

  // 6. Indicação opcional a cada filme (participante quando possível, texto de origem quando não).
  const toCommit: Array<Record<string, unknown>> = films
    .filter((film) => film.title !== "Filme 07")
    .map((film, i) => ({
      title: film.title,
      runtimeMinutes: 90 + (i % 4) * 15,
      ...(i % 3 === 0 ? { recommendedByUserId: everyone[i % everyone.length].user.id } : { originNote: "lista de um blog" }),
      ...(i < 2 ? { attributes: { [attrKey]: `Diretor ${i}` } } : {}),
    }));
  toCommit.push({ title: "Filme 31", runtimeMinutes: 100 });
  const commit = await call("POST", `/api/challenges/${challengeId}/items`, { session: owner, body: { items: toCommit } });
  assert.equal(commit.response.status, 201, JSON.stringify(commit.body));

  let detail = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    entryTypes: Array<{ id: string; purpose: string; visibilityPolicy: string; fields: Array<{ id: string; key: string }> }>;
    items: Array<{ id: string; title: string; recommendedBy: { name: string } | null; originNote: string | null }>;
    checkpoints: Array<{ id: string; title: string; totalRuntimeMinutes: number | null; itemCount: number }>;
  };
  assert.equal(detail.items.length, 31, "30 filmes + Filme 31");
  assert.ok(detail.items.some((it) => it.recommendedBy), "alguns filmes têm indicador participante");
  assert.ok(detail.items.some((it) => it.originNote), "outros têm origem textual");

  // 7. Distribuir filmes entre os checkpoints.
  const itemId = (title: string) => detail.items.find((it) => it.title === title)!.id;
  const assignments = detail.items.map((it, i) => ({ itemId: it.id, checkpointId: checkpoints[i % checkpoints.length].id }));
  assert.equal((await call("POST", `/api/challenges/${challengeId}/items/assign`, { session: owner, body: { assignments } })).response.status, 200);

  // 8. Consultar a duração total de cada semana.
  detail = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as typeof detail;
  const totals = detail.checkpoints.map((cp) => cp.totalRuntimeMinutes ?? 0);
  assert.ok(totals.every((t) => t > 0), "cada semana calcula a duração total dos seus filmes");

  // 10 + 11. Expectativa, avaliação e comentário habilitados; visibilidade por tipo.
  const expType = detail.entryTypes.find((t) => t.purpose === "expectation")!;
  const ratingType = detail.entryTypes.find((t) => t.purpose === "rating")!;
  const nota = ratingType.fields.find((f) => f.key === "nota")!.id;
  assert.equal(expType.visibilityPolicy, "after_own", "expectativa: depois da própria resposta (padrão §8)");
  assert.equal((await call("PATCH", `/api/challenges/${challengeId}/entry-types/${ratingType.id}`, { session: owner, body: { visibilityPolicy: "after_close" } })).response.status, 200);
  const expField = expType.fields[0].id;

  // 12. Ativar somente após o preflight.
  const preflight = await call("GET", `/api/challenges/${challengeId}/preflight`, { session: owner });
  assert.equal(preflight.response.status, 200, JSON.stringify(preflight.body));
  assert.equal((preflight.body as { ready: boolean }).ready, true, "o preflight passa antes de ativar");
  assert.equal((await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "active" } })).response.status, 200);

  // 13 + 14 + 15. Registrar expectativas e avaliações; expectativa trava após a avaliação; progresso sem status manual.
  // "Aceite F" (índice 5) só avalia 4 filmes → sem amostra suficiente para afinidade.
  const commonFilms = ["Filme 01", "Filme 02", "Filme 03", "Filme 04", "Filme 05", "Filme 06"];
  for (let personIndex = 0; personIndex < everyone.length; personIndex += 1) {
    const session = everyone[personIndex];
    const filmsForPerson = personIndex === 5 ? commonFilms.slice(0, 4) : commonFilms;
    for (let f = 0; f < filmsForPerson.length; f += 1) {
      const id = itemId(filmsForPerson[f]);
      await call("POST", `/api/challenges/${challengeId}/entries`, { session, body: { itemId: id, entryTypeId: expType.id, values: { [expField]: 3 } } });
      const rated = await call("POST", `/api/challenges/${challengeId}/entries`, { session, body: { itemId: id, entryTypeId: ratingType.id, values: { [nota]: ((personIndex + f) % 5) + 1 } } });
      assert.equal(rated.response.status, 201, JSON.stringify(rated.body));
    }
  }
  const relock = await call("POST", `/api/challenges/${challengeId}/entries`, {
    session: owner, body: { itemId: itemId("Filme 01"), entryTypeId: expType.id, values: { [expField]: 5 } },
  });
  assert.equal(relock.response.status, 409, "expectativa não muda depois da avaliação");
  assert.equal((relock.body as { error: string }).error, "expectation_locked");
  // 15. Progresso sem status manual redundante: a receita Cinema não tem um tipo
  // "assisti/pulei" — a existência da avaliação é a participação.
  assert.equal(detail.entryTypes.some((t) => t.purpose === "checkin" || t.purpose === "progress"), false, "sem status manual redundante");

  // 16. Métricas gerais, pessoais e por checkpoint.
  assert.equal((await call("POST", `/api/challenges/${challengeId}/metrics`, { session: owner, body: { label: "Nota média geral", operation: "average", fieldId: nota } })).response.status, 201);
  assert.equal((await call("POST", `/api/challenges/${challengeId}/metrics`, { session: owner, body: { label: "Média por semana", operation: "average", fieldId: nota, groupBy: "checkpoint" } })).response.status, 201);
  const liveMetrics = ((await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    metrics: Array<{ label: string; groupBy: string; value: number | null; explanation?: string; sample?: string; series?: unknown[] }>;
  }).metrics;
  const perWeek = liveMetrics.find((m) => m.label === "Média por semana")!;
  assert.equal(perWeek.groupBy, "checkpoint");
  assert.ok(Array.isArray(perWeek.series) && perWeek.series.length > 0, "uma linha por semana com registros");
  assert.ok(liveMetrics.every((m) => (m.value === null) || (m.explanation && m.sample)), "toda métrica traz fórmula e amostra");

  // 18. Encerrar.
  assert.equal((await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "closed" } })).response.status, 200);

  // 17 + 19. Afinidade só para pares com amostra suficiente; Wrapped organizado.
  const closed = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    result: {
      totalEntries: number;
      blocks: Array<{ kind: string; position: number; visible: boolean; affinity?: { pairs?: Array<{ a: { name: string }; b: { name: string } }> } }>;
    };
  };
  const blocks = closed.result.blocks;
  assert.ok(blocks.length >= 3, "o Wrapped tem vários blocos");
  assert.deepEqual([...blocks].map((b) => b.position), [...blocks].map((b) => b.position).sort((x, y) => x - y), "blocos em ordem estável");
  assert.ok(blocks.some((b) => b.kind === "metric"), "há blocos de métrica");
  const affinityBlock = blocks.find((b) => b.kind === "affinity");
  assert.ok(affinityBlock?.affinity?.pairs && affinityBlock.affinity.pairs.length > 0, "afinidade calculada para pares com ≥5 itens em comum");
  assert.ok(
    affinityBlock!.affinity!.pairs!.every((pair) => pair.a.name !== "Aceite F" && pair.b.name !== "Aceite F"),
    "quem só avaliou 4 filmes fica de fora da afinidade",
  );
  assert.ok(closed.result.totalEntries > 0, "o total de registros aparece");

  // 20. Publicar anonimamente por link, rotacionar e despublicar.
  await call("POST", `/api/challenges/${challengeId}/results`, { session: owner, body: { headline: "Aceite", summary: "ok", metricIds: [], comments: [], anonymizeParticipants: true } });
  const pub1 = await call("POST", `/api/challenges/${challengeId}/results/publish`, { session: owner, body: {} });
  const token1 = (pub1.body as { shareToken: string }).shareToken;
  assert.ok(token1, "a publicação cunha um token");
  const shared = (await call("GET", `/api/results/${token1}`)).body as { challenge: { participants: string[] } };
  assert.ok(shared.challenge.participants.every((name) => /^Participante \d+$/.test(name)), "vitrine anônima por padrão");
  const rot = await call("POST", `/api/challenges/${challengeId}/results/publish`, { session: owner, body: { rotateLink: true } });
  const token2 = (rot.body as { shareToken: string }).shareToken;
  assert.notEqual(token2, token1);
  assert.equal((await call("GET", `/api/results/${token1}`)).response.status, 404, "rotacionar invalida o link antigo");
  assert.equal((await call("DELETE", `/api/challenges/${challengeId}/results`, { session: owner })).response.status, 200);
  assert.equal((await call("GET", `/api/results/${token2}`)).response.status, 404, "despublicar tira o link do ar");

  // 21. Sair do grupo não derruba o link publicado — a identidade de quem saiu
  // já estava mascarada (vitrine anônima) e continua assim ao vivo, sem
  // precisar republicar.
  const pub3 = await call("POST", `/api/challenges/${challengeId}/results/publish`, { session: owner, body: {} });
  const token3 = (pub3.body as { shareToken: string }).shareToken;
  assert.equal((await call("POST", `/api/groups/${groupId}/leave`, { session: members[0], body: {} })).response.status, 200);
  const afterLeave = await call("GET", `/api/results/${token3}`);
  assert.equal(afterLeave.response.status, 200, "o link publicado continua funcionando depois que alguém sai");
  assert.ok(
    (afterLeave.body as { challenge: { participants: string[] } }).challenge.participants.every((name) => /^Participante \d+$/.test(name)),
    "segue anônima",
  );

  // 22. Excluir e restaurar um objeto pela lixeira.
  await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "active" } });
  const targetItem = itemId("Filme 20");
  assert.equal((await call("DELETE", `/api/challenges/${challengeId}/items/${targetItem}`, { session: owner })).response.status, 200);
  assert.equal(
    ((await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as { items: Array<{ id: string }> }).items.some((it) => it.id === targetItem),
    false,
    "o item removido some da listagem",
  );
  const archive = (await call("GET", `/api/challenges/${challengeId}/archive`, { session: owner })).body as {
    structure: Array<{ kind: string; id: string }>;
  };
  assert.ok(archive.structure.some((row) => row.id === targetItem), "aparece na estrutura removida");
  const restore = await call("POST", `/api/challenges/${challengeId}/trash/restore`, { session: owner, body: { kind: "challenge_item", id: targetItem } });
  assert.equal(restore.response.status, 200, JSON.stringify(restore.body));
  assert.equal(
    ((await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as { items: Array<{ id: string }> }).items.some((it) => it.id === targetItem),
    true,
    "restaurado com o mesmo id",
  );

  // 23. Abrir todas as telas diretamente por URL (deep-link + refresh).
  const { screenFromUrl } = await import("../../app/goa/navigation");
  const routes: Array<[string, string]> = [
    ["/", "dashboard"], ["/personal", "personal-space"], ["/personal/trash", "personal-trash"],
    ["/catalog", "personal-catalog"], ["/catalog/abc", "personal-catalog-item"],
    [`/groups/${groupId}`, "group"], [`/groups/${groupId}/trash`, "group-trash"],
    [`/groups/${groupId}/catalog/xyz`, "catalog-item"],
    [`/challenges/${challengeId}`, "challenge"], [`/challenges/${challengeId}/manage`, "admin"],
    ["/challenges/new", "create-personal-challenge"], ["/modelos", "templates"], ["/modelos/x", "template"],
    ["/sobre", "about"], ["/invites/tok", "invite"],
  ];
  for (const [path, kind] of routes) {
    assert.equal(screenFromUrl(path)?.kind, kind, `URL ${path} resolve para ${kind}`);
  }
  const { existsSync } = await import("node:fs");
  for (const page of ["app/personal/trash/page.tsx", "app/groups/[groupId]/trash/page.tsx", "app/challenges/[challengeId]/manage/page.tsx"]) {
    assert.ok(existsSync(new URL(`../../${page}`, import.meta.url)), `${page} existe`);
  }
});

// ── regressões P0 da revisão de aceite ───────────────────────────────────

test("P0: exclusão permanente exige que o objeto esteja de fato na lixeira", async () => {
  const owner = await register("P0 Purga", "p0_purga");
  const groupId = ((await call("POST", "/api/groups", { session: owner, body: { name: "Grupo Vivo" } })).body as { id: string }).id;
  const challenge = await call("POST", `/api/groups/${groupId}/challenges`, {
    session: owner, body: { recipe: "cinema", title: "Desafio Vivo", participantIds: [owner.user.id], items: [{ title: "F" }] },
  });
  const challengeId = (challenge.body as { id: string }).id;

  // Objeto ATIVO — mesmo com papel e confirmação, o purge é recusado.
  const purgeChallenge = await call("POST", `/api/groups/${groupId}/trash/purge`, {
    session: owner, body: { kind: "challenge", id: challengeId, confirmation: "0" },
  });
  assert.equal(purgeChallenge.response.status, 409, JSON.stringify(purgeChallenge.body));
  assert.equal((purgeChallenge.body as { error: string }).error, "not_in_trash");
  const purgeGroup = await call("POST", `/api/personal/trash/purge`, {
    session: owner, body: { kind: "group", id: groupId, confirmation: "Grupo Vivo" },
  });
  assert.equal(purgeGroup.response.status, 409);
  assert.equal((purgeGroup.body as { error: string }).error, "not_in_trash");
  assert.equal(((await call("GET", `/api/challenges/${challengeId}`, { session: owner })).response.status), 200, "o desafio segue vivo");

  // Só depois de binar é que a exclusão permanente passa.
  await call("DELETE", `/api/challenges/${challengeId}`, { session: owner });
  assert.equal((await call("POST", `/api/groups/${groupId}/trash/purge`, {
    session: owner, body: { kind: "challenge", id: challengeId, confirmation: "0" },
  })).response.status, 200);
});

test("P0: apagar o grupo tira do ar a vitrine publicada dos seus desafios", async () => {
  const owner = await register("P0 Vitrine", "p0_vitrine");
  const groupId = ((await call("POST", "/api/groups", { session: owner, body: { name: "Clube Vitrine" } })).body as { id: string }).id;
  const challenge = await call("POST", `/api/groups/${groupId}/challenges`, {
    session: owner, body: { recipe: "cinema", title: "Vitrine no ar", participantIds: [owner.user.id], items: [{ title: "F" }] },
  });
  const challengeId = (challenge.body as { id: string }).id;
  const d = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    entryTypes: Array<{ id: string; purpose: string; fields: Array<{ id: string; key: string }> }>; items: Array<{ id: string }>;
  };
  const rating = d.entryTypes.find((t) => t.purpose === "rating")!;
  await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "active" } });
  await call("POST", `/api/challenges/${challengeId}/entries`, { session: owner, body: { itemId: d.items[0].id, entryTypeId: rating.id, values: { [rating.fields.find((f) => f.key === "nota")!.id]: 4 } } });
  await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "closed" } });
  const pub = await call("POST", `/api/challenges/${challengeId}/results/publish`, { session: owner, body: {} });
  const token = (pub.body as { shareToken: string }).shareToken;
  assert.equal((await call("GET", `/api/results/${token}`)).response.status, 200);

  assert.equal((await call("DELETE", `/api/groups/${groupId}`, { session: owner })).response.status, 200);
  assert.equal((await call("GET", `/api/results/${token}`)).response.status, 404, "grupo na lixeira → vitrine fora do ar");

  // Restaurar o grupo não republica sozinho.
  await call("POST", `/api/personal/trash/restore`, { session: owner, body: { kind: "group", id: groupId } });
  assert.equal((await call("GET", `/api/results/${token}`)).response.status, 404, "restaurar não republica");
});

test("P0: revogar consentimento nominal mascara a pessoa ao vivo sem tirar a vitrine do ar; sair reinicia o consentimento", async () => {
  const owner = await register("P0 Consent", "p0_consent");
  const b = await register("P0 Bela", "p0_bela");
  const groupId = ((await call("POST", "/api/groups", { session: owner, body: { name: "Clube Consent" } })).body as { id: string }).id;
  const invite = (await call("POST", `/api/groups/${groupId}/invites`, { session: owner, body: { expiresInDays: 7, maxUses: 1 } })).body as { token: string };
  await call("POST", `/api/invites/${invite.token}`, { session: b, body: {} });
  const challenge = await call("POST", `/api/groups/${groupId}/challenges`, {
    session: owner, body: { recipe: "cinema", title: "Com nomes", participantIds: [owner.user.id, b.user.id], items: [{ title: "F" }] },
  });
  const challengeId = (challenge.body as { id: string }).id;
  const d = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    entryTypes: Array<{ id: string; purpose: string; fields: Array<{ id: string; key: string }> }>; items: Array<{ id: string }>;
  };
  const rating = d.entryTypes.find((t) => t.purpose === "rating")!;
  const nota = rating.fields.find((f) => f.key === "nota")!.id;
  await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "active" } });
  assert.equal((await call("PATCH", `/api/challenges/${challengeId}/consent`, { session: b, body: { nameConsent: true } })).response.status, 200);
  for (const s of [owner, b]) await call("POST", `/api/challenges/${challengeId}/entries`, { session: s, body: { itemId: d.items[0].id, entryTypeId: rating.id, values: { [nota]: 4 } } });
  await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "closed" } });
  await call("POST", `/api/challenges/${challengeId}/results`, { session: owner, body: { anonymizeParticipants: false } });
  const pub = await call("POST", `/api/challenges/${challengeId}/results/publish`, { session: owner, body: {} });
  const token = (pub.body as { shareToken: string }).shareToken;
  assert.ok(((await call("GET", `/api/results/${token}`)).body as { challenge: { participants: string[] } }).challenge.participants.includes("P0 Bela"));

  // Bela revoga → o link continua no ar, e o nome dela é mascarado na próxima leitura.
  assert.equal((await call("PATCH", `/api/challenges/${challengeId}/consent`, { session: b, body: { nameConsent: false } })).response.status, 200);
  const afterRevoke = await call("GET", `/api/results/${token}`);
  assert.equal(afterRevoke.response.status, 200, "revogar consentimento não tira o link do ar");
  const afterRevokeNames = (afterRevoke.body as { challenge: { participants: string[] } }).challenge.participants;
  assert.ok(!afterRevokeNames.includes("P0 Bela"), "o nome de quem revogou some imediatamente, sem precisar republicar");
  assert.ok(afterRevokeNames.some((name) => /^Participante \d+$/.test(name)), "e vira um rótulo genérico");

  // Bela sai e volta: o consentimento não reaparece.
  await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "active" } });
  await call("POST", `/api/challenges/${challengeId}/participants`, { session: owner, body: { replace: true, participantIds: [owner.user.id] } });
  await call("POST", `/api/challenges/${challengeId}/participants`, { session: owner, body: { replace: true, participantIds: [owner.user.id, b.user.id] } });
  const back = (await call("GET", `/api/challenges/${challengeId}`, { session: b })).body as { viewerNameConsent: boolean };
  assert.equal(back.viewerNameConsent, false, "quem sai e volta precisa autorizar o nome de novo");
});

test("P0: a auditoria da plataforma não vaza títulos, nomes nem rótulos curtos", async () => {
  const admin = await register("P0 Admin", "p0_admin_priv");
  await adminPool.query("UPDATE users SET platform_admin = true WHERE id = $1", [admin.user.id]);
  const adminSession = await login("p0_admin_priv");
  const owner = await register("P0 Dono", "p0_dono_priv");
  const gid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Grupo Secreto XYZ" } })).body as { id: string }).id;
  const challenge = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner, body: { recipe: "cinema", title: "Título Curto Sensível", participantIds: [owner.user.id], items: [{ title: "F" }] },
  });
  const challengeId = (challenge.body as { id: string }).id;
  await call("POST", `/api/challenges/${challengeId}/metrics`, { session: owner, body: { label: "Métrica com Rótulo Privado", operation: "average", fieldId: ((await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as { entryTypes: Array<{ purpose: string; fields: Array<{ id: string; key: string }> }> }).entryTypes.find((t) => t.purpose === "rating")!.fields.find((f) => f.key === "nota")!.id } });

  const audit = (await call("GET", `/api/admin/audit?groupId=${gid}`, { session: adminSession })).body as { events: unknown[] };
  const dump = JSON.stringify(audit.events);
  assert.doesNotMatch(dump, /Título Curto Sensível/, "título de desafio (curto) não aparece");
  assert.doesNotMatch(dump, /Grupo Secreto XYZ/, "nome de grupo não aparece");
  assert.doesNotMatch(dump, /Métrica com Rótulo Privado/, "rótulo de métrica não aparece");
  assert.match(dump, /"status":"(draft|active)"|"operation":"average"/, "valores estruturais continuam visíveis");
});

test("P0: um Hábito com período e sem checkpoints ativa e aceita check-in direto", async () => {
  const owner = await register("P0 Habito", "p0_habito");
  const groupId = ((await call("POST", "/api/groups", { session: owner, body: { name: "Clube Hábito" } })).body as { id: string }).id;
  const created = await call("POST", `/api/groups/${groupId}/challenges`, {
    session: owner,
    body: {
      recipe: "habit", title: "Correr toda semana",
      startsOn: "2026-05-01", endsOn: "2026-07-31", generateDaily: false,
      participantIds: [owner.user.id],
      fields: [{ key: "minutos", label: "Minutos", type: "number", required: true, config: { min: 0, step: 1 } }],
    },
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  const challengeId = (created.body as { id: string }).id;

  const preflight = await call("GET", `/api/challenges/${challengeId}/preflight`, { session: owner });
  assert.equal((preflight.body as { ready: boolean }).ready, true);
  assert.equal((await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "active" } })).response.status, 200);

  const detail = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    entryTypes: Array<{ id: string; purpose: string; submissionMode: string; schedulePolicy: string; fields: Array<{ id: string; key: string }> }>;
    checkpoints: unknown[]; items: unknown[];
  };
  const checkin = detail.entryTypes.find((t) => t.purpose === "checkin")!;
  assert.equal(checkin.submissionMode, "daily");
  assert.notEqual(checkin.schedulePolicy, "checkpoint", "o hábito não fica preso a checkpoints");
  assert.deepEqual(detail.checkpoints, []);
  assert.deepEqual(detail.items, []);

  // Check-in direto, sem item nem checkpoint.
  const entry = await call("POST", `/api/challenges/${challengeId}/entries`, {
    session: owner, body: { entryTypeId: checkin.id, occurredOn: "2026-05-04", values: { [checkin.fields.find((f) => f.key === "minutos")!.id]: 30 } },
  });
  assert.equal(entry.response.status, 201, JSON.stringify(entry.body));
});

// ── Onda A — integridade das receitas ────────────────────────────────────

test("A: uma receita Cinema sem campo de nota é bloqueada na ativação", async () => {
  const owner = await register("A Dono", "a_dono_receita");
  const groupId = ((await call("POST", "/api/groups", { session: owner, body: { name: "Clube A" } })).body as { id: string }).id;
  // O wizard troca os campos do tipo primário — sem nota, só um comentário.
  const challenge = await call("POST", `/api/groups/${groupId}/challenges`, {
    session: owner,
    body: {
      recipe: "cinema", title: "Sem nota", participantIds: [owner.user.id], items: [{ title: "F" }],
      fields: [{ key: "comentario", label: "Comentário", type: "text", required: false }],
    },
  });
  const challengeId = (challenge.body as { id: string }).id;

  const preflight = await call("GET", `/api/challenges/${challengeId}/preflight`, { session: owner });
  assert.equal((preflight.body as { ready: boolean }).ready, false);
  assert.ok((preflight.body as { errors: Array<{ code: string }> }).errors.some((e) => e.code === "recipe_essential_field_missing"));
  assert.equal((await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "active" } })).response.status, 409);
});

test("A: métrica de receita com campo irresolvível é omitida, não repontada", async () => {
  const owner = await register("A Metrica", "a_metrica_receita");
  const groupId = ((await call("POST", "/api/groups", { session: owner, body: { name: "Clube A2" } })).body as { id: string }).id;
  // O wizard renomeia a chave da nota → "media_nota" e o "ranking" não resolvem.
  const challenge = await call("POST", `/api/groups/${groupId}/challenges`, {
    session: owner,
    body: {
      recipe: "cinema", title: "Nota renomeada", participantIds: [owner.user.id], items: [{ title: "F" }],
      fields: [{ key: "estrelas", label: "Estrelas", type: "rating", required: true }],
    },
  });
  const challengeId = (challenge.body as { id: string }).id;
  const metrics = ((await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    metrics: Array<{ label: string; fieldId?: string | null }>;
  }).metrics;
  // Nenhuma métrica ligada a "nota" foi semeada apontando para "estrelas".
  assert.equal(metrics.some((m) => m.label === "Nota média"), false, "métrica sem campo resolvível não é criada");
});

test("A: tornar um campo obrigatório com registros incompletos é recusado", async () => {
  const owner = await register("A Obrig", "a_obrig_campo");
  const groupId = ((await call("POST", "/api/groups", { session: owner, body: { name: "Clube A3" } })).body as { id: string }).id;
  const challenge = await call("POST", `/api/groups/${groupId}/challenges`, {
    session: owner, body: { recipe: "cinema", title: "Comentário depois", participantIds: [owner.user.id], items: [{ title: "F" }] },
  });
  const challengeId = (challenge.body as { id: string }).id;
  const d = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    entryTypes: Array<{ id: string; purpose: string }>;
    fields: Array<{ id: string; key: string; type: string; required: boolean }>;
    items: Array<{ id: string }>;
  };
  const rating = d.entryTypes.find((t) => t.purpose === "rating")!;
  const notaField = d.fields.find((f) => f.key === "nota")!;
  const comentarioField = d.fields.find((f) => f.key === "comentario")!;
  await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "active" } });
  // Registro só com a nota, sem comentário.
  await call("POST", `/api/challenges/${challengeId}/entries`, { session: owner, body: { itemId: d.items[0].id, entryTypeId: rating.id, values: { [notaField.id]: 4 } } });

  // Mantém os dois campos (com id) e torna o comentário obrigatório.
  const forceRequired = await call("POST", `/api/challenges/${challengeId}/fields`, {
    session: owner,
    body: { entryTypeId: rating.id, replace: true, archiveMissing: true, fields: [
      { id: notaField.id, key: "nota", label: "Nota", type: "rating", required: true },
      { id: comentarioField.id, key: "comentario", label: "Comentário", type: "text", required: true },
    ] },
  });
  assert.equal(forceRequired.response.status, 409, JSON.stringify(forceRequired.body));
  assert.equal((forceRequired.body as { error: string }).error, "required_would_invalidate");
});

test("A: item adicionado depois numa Estante entra como livro, não filme", async () => {
  const owner = await register("A Estante", "a_estante");
  const created = await call("POST", "/api/personal/challenges", {
    session: owner, body: { recipe: "bookshelf", title: "Minha estante", items: [{ title: "Duna", author: "Frank Herbert" }] },
  });
  const challengeId = (created.body as { id: string }).id;
  const added = await call("POST", `/api/challenges/${challengeId}/items`, {
    session: owner, body: { items: [{ title: "O Hobbit", author: "Tolkien" }] },
  });
  assert.equal(added.response.status, 201, JSON.stringify(added.body));
  const catalog = (await call("GET", "/api/personal/catalog", { session: owner })).body as {
    items: Array<{ title: string; kind: string }>;
  };
  assert.equal(catalog.items.find((i) => i.title === "O Hobbit")?.kind, "book", "livro adicionado depois não vira filme");
});

test("A: opção de escolha arquivada em uso ainda renderiza o rótulo, não o id", async () => {
  const owner = await register("A Opcao", "a_opcao_uso");
  const groupId = ((await call("POST", "/api/groups", { session: owner, body: { name: "Clube A5" } })).body as { id: string }).id;
  const challenge = await call("POST", `/api/groups/${groupId}/challenges`, {
    session: owner,
    body: {
      recipe: "habit", title: "Humor diário", participantIds: [owner.user.id],
      fields: [{ key: "humor", label: "Humor", type: "select", required: true, config: { options: [{ label: "Bem" }, { label: "Mal" }, { label: "Neutro" }] } }],
    },
  });
  const challengeId = (challenge.body as { id: string }).id;
  let d = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    entryTypes: Array<{ id: string; purpose: string }>;
    fields: Array<{ id: string; key: string; config?: { options?: Array<{ id?: string; label: string; archived?: boolean }> } }>;
    status: string;
  };
  const type = d.entryTypes.find((t) => t.purpose === "checkin")!;
  const humor = d.fields.find((f) => f.key === "humor")!;
  const opt = (label: string) => humor.config!.options!.find((o) => o.label === label)!.id!;
  const optNeutro = opt("Neutro");
  if (d.status === "draft") await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "active" } });
  await call("POST", `/api/challenges/${challengeId}/entries`, { session: owner, body: { entryTypeId: type.id, occurredOn: "2026-01-01", values: { [humor.id]: optNeutro } } });

  // Arquiva "Neutro" mantendo as outras (com id).
  await call("POST", `/api/challenges/${challengeId}/fields`, {
    session: owner,
    body: { entryTypeId: type.id, replace: true, archiveMissing: true, fields: [
      { id: humor.id, key: "humor", label: "Humor", type: "select", required: true, config: { options: [
        { id: opt("Bem"), label: "Bem" }, { id: opt("Mal"), label: "Mal" },
      ] } },
    ] },
  });
  d = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as typeof d;
  const humorAfter = d.fields.find((f) => f.key === "humor")!;
  const neutroAfter = humorAfter.config!.options!.find((o) => o.id === optNeutro);
  assert.ok(neutroAfter, "a opção arquivada continua na lista para renderizar o histórico");
  assert.equal(neutroAfter!.archived, true);
  assert.equal(neutroAfter!.label, "Neutro", "com o rótulo, não o id");
});

// ── Onda B — listas e checkpoints ────────────────────────────────────────

test("B: a ordem enviada na atribuição de checkpoints persiste após recarregar", async () => {
  const owner = await register("B Ordem", "b_ordem_cp");
  const groupId = ((await call("POST", "/api/groups", { session: owner, body: { name: "Clube B1" } })).body as { id: string }).id;
  const challenge = await call("POST", `/api/groups/${groupId}/challenges`, {
    session: owner,
    body: { recipe: "cinema", title: "Ordem importa", startsOn: "2026-05-01", endsOn: "2026-05-31", participantIds: [owner.user.id], items: [{ title: "A" }, { title: "B" }, { title: "C" }] },
  });
  const challengeId = (challenge.body as { id: string }).id;
  const d = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as { items: Array<{ id: string; title: string }> };
  const id = (title: string) => d.items.find((i) => i.title === title)!.id;

  // Reordena C, A, B.
  const assign = await call("POST", `/api/challenges/${challengeId}/items/assign`, {
    session: owner,
    body: { assignments: [
      { itemId: id("C"), checkpointId: null, position: 0 },
      { itemId: id("A"), checkpointId: null, position: 1 },
      { itemId: id("B"), checkpointId: null, position: 2 },
    ] },
  });
  assert.equal(assign.response.status, 200, JSON.stringify(assign.body));

  const reloaded = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as { items: Array<{ title: string }> };
  assert.deepEqual(reloaded.items.map((i) => i.title), ["C", "A", "B"], "a ordem sorteada sobrevive ao reload");
});

test("B: um Clube de Leitura com período e sem dias automáticos aceita semanas manuais", async () => {
  const owner = await register("B Clube", "b_clube_semana");
  const groupId = ((await call("POST", "/api/groups", { session: owner, body: { name: "Clube B2" } })).body as { id: string }).id;
  const challenge = await call("POST", `/api/groups/${groupId}/challenges`, {
    session: owner,
    body: {
      recipe: "library", title: "Leituras por semana", startsOn: "2026-06-01", endsOn: "2026-06-28",
      generateDaily: false, participantIds: [owner.user.id], items: [{ title: "Livro 1", author: "X" }],
    },
  });
  const challengeId = (challenge.body as { id: string }).id;
  const saved = await call("POST", `/api/challenges/${challengeId}/checkpoints`, {
    session: owner,
    body: { checkpoints: [
      { title: "Semana 1", kind: "week", startsAt: "2026-06-01", dueAt: "2026-06-07", description: "Capítulos 1-5" },
      { title: "Semana 2", kind: "week", startsAt: "2026-06-08", dueAt: "2026-06-14" },
    ] },
  });
  assert.equal(saved.response.status, 200, JSON.stringify(saved.body));
  const detail = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    checkpoints: Array<{ title: string; kind: string; description: string | null }>;
  };
  assert.equal(detail.checkpoints.length, 2);
  assert.equal(detail.checkpoints[0].kind, "week");
  assert.equal(detail.checkpoints[0].description, "Capítulos 1-5", "a descrição do checkpoint é gravada");
});

test("B: métrica por checkpoint mostra uma linha por semana, inclusive as vazias", async () => {
  const owner = await register("B Vazio", "b_semana_vazia");
  const b = await register("B Bea", "b_bea_vazia");
  const groupId = ((await call("POST", "/api/groups", { session: owner, body: { name: "Clube B3" } })).body as { id: string }).id;
  const invite = (await call("POST", `/api/groups/${groupId}/invites`, { session: owner, body: { expiresInDays: 7, maxUses: 1 } })).body as { token: string };
  await call("POST", `/api/invites/${invite.token}`, { session: b, body: {} });
  const challenge = await call("POST", `/api/groups/${groupId}/challenges`, {
    session: owner,
    body: { recipe: "cinema", title: "Semana cheia e vazia", startsOn: "2026-07-01", endsOn: "2026-07-21", participantIds: [owner.user.id, b.user.id], items: [{ title: "F1" }, { title: "F2" }] },
  });
  const challengeId = (challenge.body as { id: string }).id;
  const d = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    entryTypes: Array<{ id: string; purpose: string; fields: Array<{ id: string; key: string }> }>; items: Array<{ id: string; title: string }>;
  };
  const rating = d.entryTypes.find((t) => t.purpose === "rating")!;
  const nota = rating.fields.find((f) => f.key === "nota")!.id;
  const cps = (await call("POST", `/api/challenges/${challengeId}/checkpoints`, {
    session: owner,
    body: { checkpoints: [
      { title: "S1", kind: "week", startsAt: "2026-07-01", dueAt: "2026-07-07" },
      { title: "S2", kind: "week", startsAt: "2026-07-08", dueAt: "2026-07-14" },
      { title: "S3", kind: "week", startsAt: "2026-07-15", dueAt: "2026-07-21" },
    ] },
  })).body as { checkpoints: Array<{ id: string; title: string }> };
  await call("POST", `/api/challenges/${challengeId}/items/assign`, {
    session: owner,
    body: { assignments: [
      { itemId: d.items[0].id, checkpointId: cps.checkpoints[0].id },
      { itemId: d.items[1].id, checkpointId: cps.checkpoints[0].id },
    ] },
  });
  await call("POST", `/api/challenges/${challengeId}/metrics`, { session: owner, body: { label: "Média por semana", operation: "average", fieldId: nota, groupBy: "checkpoint" } });
  await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "active" } });
  // Só S1 recebe notas.
  for (const s of [owner, b]) for (const it of d.items) await call("POST", `/api/challenges/${challengeId}/entries`, { session: s, body: { itemId: it.id, entryTypeId: rating.id, values: { [nota]: 4 } } });

  const metric = ((await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    metrics: Array<{ label: string; series?: Array<{ label: string; value: number | null }> }>;
  }).metrics.find((m) => m.label === "Média por semana")!;
  assert.equal(metric.series!.length, 3, "uma linha por semana, mesmo S2 e S3 vazias");
  assert.equal(metric.series!.find((r) => r.label === "S2")!.value, null, "semana sem registro aparece sem valor, não some");
});

// ── Onda C — métricas e Wrapped ─────────────────────────────────────────

test("C: contagem por pessoa vira série; conclusão por checkpoint é recusada", async () => {
  const owner = await register("C Conta", "c_conta_serie");
  const b = await register("C Bea", "c_bea_serie");
  const groupId = ((await call("POST", "/api/groups", { session: owner, body: { name: "Clube C1" } })).body as { id: string }).id;
  const invite = (await call("POST", `/api/groups/${groupId}/invites`, { session: owner, body: { expiresInDays: 7, maxUses: 1 } })).body as { token: string };
  await call("POST", `/api/invites/${invite.token}`, { session: b, body: {} });
  const challenge = await call("POST", `/api/groups/${groupId}/challenges`, {
    session: owner, body: { recipe: "cinema", title: "Quem registra mais", participantIds: [owner.user.id, b.user.id], items: [{ title: "F1" }, { title: "F2" }] },
  });
  const challengeId = (challenge.body as { id: string }).id;
  const d = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    entryTypes: Array<{ id: string; purpose: string; fields: Array<{ id: string; key: string }> }>; items: Array<{ id: string }>;
  };
  const rating = d.entryTypes.find((t) => t.purpose === "rating")!;
  const nota = rating.fields.find((f) => f.key === "nota")!.id;

  assert.equal((await call("POST", `/api/challenges/${challengeId}/metrics`, {
    session: owner, body: { label: "x", operation: "completion_rate", groupBy: "checkpoint" },
  })).response.status, 400, "conclusão por checkpoint ainda não existe → recusada");

  const countMetric = await call("POST", `/api/challenges/${challengeId}/metrics`, {
    session: owner, body: { label: "Registros por pessoa", operation: "count", groupBy: "participant" },
  });
  assert.equal(countMetric.response.status, 201, JSON.stringify(countMetric.body));

  await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "active" } });
  await call("POST", `/api/challenges/${challengeId}/entries`, { session: owner, body: { itemId: d.items[0].id, entryTypeId: rating.id, values: { [nota]: 4 } } });
  await call("POST", `/api/challenges/${challengeId}/entries`, { session: owner, body: { itemId: d.items[1].id, entryTypeId: rating.id, values: { [nota]: 5 } } });
  await call("POST", `/api/challenges/${challengeId}/entries`, { session: b, body: { itemId: d.items[0].id, entryTypeId: rating.id, values: { [nota]: 3 } } });

  const metric = ((await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    metrics: Array<{ label: string; series?: Array<{ label: string; value: number | null }> }>;
  }).metrics.find((m) => m.label === "Registros por pessoa")!;
  assert.ok(Array.isArray(metric.series) && metric.series.length === 2, "uma linha por pessoa");
  assert.equal(metric.series!.find((r) => r.label === "C Conta")!.value, 2);
  assert.equal(metric.series!.find((r) => r.label === "C Bea")!.value, 1);
});

test("C: rankings e afinidade aparecem ao vivo no detalhe do desafio ativo", async () => {
  const people = await Promise.all(["ca", "cb", "cc", "cd", "ce"].map((s) => register(`C ${s}`, `c_live_${s}`)));
  const owner = people[0];
  const groupId = ((await call("POST", "/api/groups", { session: owner, body: { name: "Clube C2" } })).body as { id: string }).id;
  for (const m of people.slice(1)) {
    const inv = (await call("POST", `/api/groups/${groupId}/invites`, { session: owner, body: { expiresInDays: 7, maxUses: 1 } })).body as { token: string };
    await call("POST", `/api/invites/${inv.token}`, { session: m, body: {} });
  }
  const challenge = await call("POST", `/api/groups/${groupId}/challenges`, {
    session: owner,
    body: { recipe: "cinema", title: "Afinidade viva", participantIds: people.map((p) => p.user.id), items: Array.from({ length: 6 }, (_v, i) => ({ title: `F${i}` })) },
  });
  const challengeId = (challenge.body as { id: string }).id;
  const d = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    entryTypes: Array<{ id: string; purpose: string; fields: Array<{ id: string; key: string }> }>; items: Array<{ id: string }>;
  };
  const rating = d.entryTypes.find((t) => t.purpose === "rating")!;
  const nota = rating.fields.find((f) => f.key === "nota")!.id;
  await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "active" } });
  for (let p = 0; p < people.length; p += 1) {
    for (let i = 0; i < d.items.length; i += 1) {
      await call("POST", `/api/challenges/${challengeId}/entries`, { session: people[p], body: { itemId: d.items[i].id, entryTypeId: rating.id, values: { [nota]: ((p + i) % 5) + 1 } } });
    }
  }
  const result = ((await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    result: { blocks?: Array<{ kind: string }>; personalRankings?: unknown[]; affinity?: { pairs?: unknown[] } | null };
  }).result;
  assert.ok(
    (Array.isArray(result.personalRankings) && result.personalRankings.length > 0)
      || (result.affinity?.pairs && result.affinity.pairs.length > 0)
      || (result.blocks ?? []).some((b) => b.kind === "ranking" || b.kind === "affinity"),
    "o detalhe do desafio ativo já traz ranking/afinidade ao vivo",
  );
});

test("C: organizar a vitrine vale a qualquer momento; só publicar o link público exige encerrar", async () => {
  const owner = await register("C Curad", "c_curadoria");
  const groupId = ((await call("POST", "/api/groups", { session: owner, body: { name: "Clube C3" } })).body as { id: string }).id;
  const challenge = await call("POST", `/api/groups/${groupId}/challenges`, {
    session: owner, body: { recipe: "cinema", title: "Vitrine cedo", participantIds: [owner.user.id], items: [{ title: "F" }] },
  });
  const challengeId = (challenge.body as { id: string }).id;
  await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "active" } });
  // "Fechado" só é uma etiqueta de ciclo de vida (não aceita mais registros) —
  // organizar a vitrine (manchete, métricas em destaque etc.) não depende dela.
  const early = await call("POST", `/api/challenges/${challengeId}/results`, { session: owner, body: { headline: "Ainda em andamento", summary: "x", metricIds: [], comments: [] } });
  assert.equal(early.response.status, 200, JSON.stringify(early.body));

  const detail = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as { result: { headline: string | null } };
  assert.equal(detail.result.headline, "Ainda em andamento", "a curadoria aparece na hora, sem precisar encerrar o desafio");

  // Publicar o link público continua exigindo o encerramento.
  const publishEarly = await call("POST", `/api/challenges/${challengeId}/results/publish`, { session: owner, body: {} });
  assert.equal(publishEarly.response.status, 409, JSON.stringify(publishEarly.body));
  assert.equal((publishEarly.body as { error: string }).error, "challenge_not_closed");
});

test("C: uma lista pessoal viva cura e publica a vitrine sem nunca fechar, e a métrica publicada segue ao vivo depois de publicada", async () => {
  const owner = await register("C Lista Viva", "c_lista_viva_vitrine");
  const created = await call("POST", "/api/personal/challenges", {
    session: owner,
    body: { recipe: "bookshelf", title: "Já li (vitrine)", items: [{ title: "Livro A", author: "Autora A" }, { title: "Livro B", author: "Autora B" }, { title: "Livro C", author: "Autora C" }] },
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  const challengeId = (created.body as { id: string }).id;
  assert.equal((created.body as { status: string }).status, "active");
  assert.equal((created.body as { kind: string }).kind, "list");

  const detail = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    entryTypes: Array<{ id: string; purpose: string; fields: Array<{ id: string; key: string }> }>;
    items: Array<{ id: string }>;
  };
  const ratingType = detail.entryTypes.find((type) => type.purpose === "rating")!;
  const notaField = ratingType.fields.find((field) => field.key === "nota")!.id;

  for (const [item, nota] of [[detail.items[0], 5], [detail.items[1], 3]] as const) {
    const entry = await call("POST", `/api/challenges/${challengeId}/entries`, {
      session: owner, body: { itemId: item.id, entryTypeId: ratingType.id, values: { [notaField]: nota } },
    });
    assert.equal(entry.response.status, 201, JSON.stringify(entry.body));
  }

  const metric = await call("POST", `/api/challenges/${challengeId}/metrics`, {
    session: owner, body: { label: "Média das notas", operation: "average", fieldId: notaField, groupBy: "none" },
  });
  assert.equal(metric.response.status, 201, JSON.stringify(metric.body));
  const metricId = (metric.body as { id: string }).id;

  // Curar e publicar não exigem fechar — uma lista não tem "fechado".
  const curated = await call("POST", `/api/challenges/${challengeId}/results`, {
    session: owner,
    body: { headline: "O que já li", summary: "Minhas notas até agora", metricIds: [metricId], comments: [] },
  });
  assert.equal(curated.response.status, 200, JSON.stringify(curated.body));

  const publish = await call("POST", `/api/challenges/${challengeId}/results/publish`, { session: owner, body: {} });
  assert.equal(publish.response.status, 200, JSON.stringify(publish.body));
  const token = (publish.body as { url: string }).url!.split("/results/")[1];

  const stillActive = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as { status: string };
  assert.equal(stillActive.status, "active", "publicar a vitrine de uma lista não fecha nem transiciona o estado");

  const first = (await call("GET", `/api/results/${token}`)).body as {
    challenge: { result: { headline: string | null; metrics: ApiMetric[] } };
  };
  assert.equal(first.challenge.result.headline, "O que já li");
  assert.equal(first.challenge.result.metrics.find((row) => row.id === metricId)!.value, 4, "média de 5 e 3");

  // Um novo registro depois de publicar — sem regenerar nem salvar a curadoria de novo.
  await call("POST", `/api/challenges/${challengeId}/entries`, {
    session: owner, body: { itemId: detail.items[2].id, entryTypeId: ratingType.id, values: { [notaField]: 3 } },
  });

  const second = (await call("GET", `/api/results/${token}`)).body as {
    challenge: { result: { metrics: ApiMetric[] } };
  };
  const liveValue = second.challenge.result.metrics.find((row) => row.id === metricId)!.value ?? 0;
  assert.ok(Math.abs(liveValue - 11 / 3) < 0.01, `a vitrine publicada devia acompanhar o novo registro ao vivo, veio ${liveValue}`);
});

test("editar um registro cujo comentário já foi curado na vitrine não apaga-e-recria a linha à toa (evitava violar result_blocks_entry_value_challenge_fk)", async () => {
  const owner = await register("Klara Fix", "klara_fix_test");
  const created = await call("POST", "/api/personal/challenges", {
    session: owner,
    body: { recipe: "bookshelf", title: "Estante viva", items: [{ title: "Klara and the Sun", author: "Ishiguro" }] },
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  const challengeId = (created.body as { id: string }).id;

  const detail = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    entryTypes: Array<{ id: string; purpose: string; fields: Array<{ id: string; key: string }> }>;
    items: Array<{ id: string }>;
  };
  const ratingType = detail.entryTypes.find((type) => type.purpose === "rating")!;
  const notaField = ratingType.fields.find((field) => field.key === "nota")!.id;
  const comentarioField = ratingType.fields.find((field) => field.key === "comentario")!.id;
  const itemId = detail.items[0].id;

  const entry = await call("POST", `/api/challenges/${challengeId}/entries`, {
    session: owner,
    body: { itemId, entryTypeId: ratingType.id, values: { [notaField]: 5, [comentarioField]: "Um comentário bonito." } },
  });
  assert.equal(entry.response.status, 201, JSON.stringify(entry.body));
  const entryId = (entry.body as { id: string }).id;

  // Cura a vitrine selecionando este comentário — cria o result_blocks que
  // referencia (entryId, comentarioField), com ON DELETE RESTRICT.
  const curated = await call("POST", `/api/challenges/${challengeId}/results`, {
    session: owner,
    body: { headline: "", summary: "", metricIds: [], comments: [{ entryId, fieldId: comentarioField }] },
  });
  assert.equal(curated.response.status, 200, JSON.stringify(curated.body));
  assert.equal(
    (await adminPool.query("SELECT count(*)::int AS n FROM result_blocks WHERE source_entry_id=$1", [entryId])).rows[0].n,
    1,
    "o comentário foi curado num bloco",
  );

  // Editar QUALQUER campo do mesmo registro (aqui, a nota) não pode mais
  // violar a FK só porque o comentário passou a ser referenciado.
  const editedRating = await call("PATCH", `/api/entries/${entryId}`, {
    session: owner,
    body: { values: { [notaField]: 4, [comentarioField]: "Um comentário bonito." } },
  });
  assert.equal(editedRating.response.status, 200, JSON.stringify(editedRating.body));

  // Editar o próprio texto do comentário curado também deve funcionar.
  const editedComment = await call("PATCH", `/api/entries/${entryId}`, {
    session: owner,
    body: { values: { [notaField]: 4, [comentarioField]: "Texto revisado depois da curadoria." } },
  });
  assert.equal(editedComment.response.status, 200, JSON.stringify(editedComment.body));
  assert.equal(
    (await adminPool.query("SELECT count(*)::int AS n FROM result_blocks WHERE source_entry_id=$1", [entryId])).rows[0].n,
    1,
    "o bloco curado sobrevive a duas edições",
  );

  // Remover o comentário de verdade (omitindo o campo opcional) apaga sua
  // referência no resultado antes de apagar a resposta, sem violar a FK — e
  // preserva a nota, que não foi tocada.
  const removedComment = await call("PATCH", `/api/entries/${entryId}`, {
    session: owner,
    body: { values: { [notaField]: 4 } },
  });
  assert.equal(removedComment.response.status, 200, JSON.stringify(removedComment.body));
  assert.equal(
    (await adminPool.query("SELECT count(*)::int AS n FROM result_blocks WHERE source_entry_id=$1", [entryId])).rows[0].n,
    0,
    "remover o comentário remove o bloco curado junto",
  );
  const afterRemoval = (await call("GET", `/api/challenges/${challengeId}/entries`, { session: owner })).body as {
    entries: Array<{ id: string; values: Record<string, unknown> }>;
  };
  const thisEntry = afterRemoval.entries.find((row) => row.id === entryId)!;
  assert.equal(thisEntry.values[notaField], 4, "a nota permanece intacta depois de remover só o comentário");
  assert.equal(Object.hasOwn(thisEntry.values, comentarioField), false, "o comentário removido não aparece mais no registro");
});

test("um comentário curado na vitrine acompanha uma edição ao vivo — sem precisar salvar a curadoria de novo", async () => {
  const owner = await register("Vitrine Live", "vitrine_live_test");
  const created = await call("POST", "/api/personal/challenges", {
    session: owner,
    body: { recipe: "bookshelf", title: "Estante ao vivo", items: [{ title: "Klara and the Sun", author: "Ishiguro" }] },
  });
  const challengeId = (created.body as { id: string }).id;
  const detail = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    entryTypes: Array<{ id: string; purpose: string; fields: Array<{ id: string; key: string }> }>;
    items: Array<{ id: string }>;
  };
  const ratingType = detail.entryTypes.find((type) => type.purpose === "rating")!;
  const notaField = ratingType.fields.find((field) => field.key === "nota")!.id;
  const comentarioField = ratingType.fields.find((field) => field.key === "comentario")!.id;
  const itemId = detail.items[0].id;

  const entry = await call("POST", `/api/challenges/${challengeId}/entries`, {
    session: owner,
    body: { itemId, entryTypeId: ratingType.id, values: { [notaField]: 5, [comentarioField]: "Texto original." } },
  });
  const entryId = (entry.body as { id: string }).id;

  await call("POST", `/api/challenges/${challengeId}/results`, {
    session: owner,
    body: { headline: "", summary: "", metricIds: [], comments: [{ entryId, fieldId: comentarioField }] },
  });

  const before = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    result: { comments: Array<{ text: string }> };
  };
  assert.equal(before.result.comments[0]?.text, "Texto original.");

  // Só edita o registro — nunca chama /results de novo (nada de "regenerar"
  // ou resalvar a curadoria).
  await call("PATCH", `/api/entries/${entryId}`, {
    session: owner,
    body: { values: { [notaField]: 5, [comentarioField]: "Texto corrigido depois." } },
  });

  const after = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    result: { comments: Array<{ text: string }> };
  };
  assert.equal(after.result.comments[0]?.text, "Texto corrigido depois.", "a vitrine acompanha a edição sem precisar de um passo extra de republicação");
});

test("mostrar todos os comentários automaticamente: um comentário novo aparece na vitrine sem nunca curar de novo", async () => {
  const owner = await register("Auto Comentario", "auto_comentario_test");
  const created = await call("POST", "/api/personal/challenges", {
    session: owner,
    body: {
      recipe: "bookshelf",
      title: "Estante com tudo",
      items: [{ title: "Klara and the Sun", author: "Ishiguro" }, { title: "Duna", author: "Herbert" }],
    },
  });
  const challengeId = (created.body as { id: string }).id;
  const detail = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    entryTypes: Array<{ id: string; purpose: string; fields: Array<{ id: string; key: string }> }>;
    items: Array<{ id: string; title: string }>;
  };
  const ratingType = detail.entryTypes.find((type) => type.purpose === "rating")!;
  const notaField = ratingType.fields.find((field) => field.key === "nota")!.id;
  const comentarioField = ratingType.fields.find((field) => field.key === "comentario")!.id;
  const [bookA, bookB] = detail.items;

  await call("POST", `/api/challenges/${challengeId}/entries`, {
    session: owner,
    body: { itemId: bookA.id, entryTypeId: ratingType.id, values: { [notaField]: 5, [comentarioField]: "Comentário do primeiro livro." } },
  });

  // Liga "mostrar todos" sem selecionar nada manualmente.
  const curated = await call("POST", `/api/challenges/${challengeId}/results`, {
    session: owner,
    body: { headline: "", summary: "", metricIds: [], comments: [], allComments: true },
  });
  assert.equal(curated.response.status, 200, JSON.stringify(curated.body));

  const first = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    result: { comments: Array<{ text: string }> };
  };
  assert.deepEqual(first.result.comments.map((c) => c.text), ["Comentário do primeiro livro."]);

  // Um comentário novo, num livro que nem existia quando o toggle foi salvo —
  // nunca mais chama /results.
  await call("POST", `/api/challenges/${challengeId}/entries`, {
    session: owner,
    body: { itemId: bookB.id, entryTypeId: ratingType.id, values: { [notaField]: 4, [comentarioField]: "Comentário do segundo livro." } },
  });

  const second = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    result: { comments: Array<{ text: string }> };
  };
  assert.equal(second.result.comments.length, 2, "o novo comentário entrou sozinho, sem curadoria manual");
  assert.ok(second.result.comments.some((c) => c.text === "Comentário do segundo livro."));

  // Desligar volta a exigir seleção manual — nenhuma sobrevive à toa.
  await call("POST", `/api/challenges/${challengeId}/results`, {
    session: owner,
    body: { headline: "", summary: "", metricIds: [], comments: [], allComments: false },
  });
  const third = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    result: { comments: Array<{ text: string }> };
  };
  assert.deepEqual(third.result.comments, [], "desligado, volta a ser só o que foi selecionado manualmente (nada, aqui)");
});

// ── Onda D — lixeira e ciclo de vida ────────────────────────────────────

test("D: registro binado num desafio ativo não pode ser restaurado nem apagado após encerrar", async () => {
  const owner = await register("D Congela", "d_congela");
  const groupId = ((await call("POST", "/api/groups", { session: owner, body: { name: "Clube D1" } })).body as { id: string }).id;
  const challenge = await call("POST", `/api/groups/${groupId}/challenges`, {
    session: owner, body: { recipe: "cinema", title: "Memória fechada", participantIds: [owner.user.id], items: [{ title: "F1" }, { title: "F2" }] },
  });
  const challengeId = (challenge.body as { id: string }).id;
  const d = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    entryTypes: Array<{ id: string; purpose: string; fields: Array<{ id: string; key: string }> }>; items: Array<{ id: string }>;
  };
  const rating = d.entryTypes.find((t) => t.purpose === "rating")!;
  const nota = rating.fields.find((f) => f.key === "nota")!.id;
  await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "active" } });
  await call("POST", `/api/challenges/${challengeId}/entries`, { session: owner, body: { itemId: d.items[0].id, entryTypeId: rating.id, values: { [nota]: 4 } } });
  const rated = (await call("GET", `/api/challenges/${challengeId}/entries`, { session: owner })).body as { entries: Array<{ id: string }> };
  const entryId = rated.entries[0].id;
  await call("POST", `/api/challenges/${challengeId}/entries`, { session: owner, body: { itemId: d.items[1].id, entryTypeId: rating.id, values: { [nota]: 5 } } });
  assert.equal((await call("DELETE", `/api/entries/${entryId}`, { session: owner })).response.status, 200);
  await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "closed" } });

  assert.equal((await call("POST", `/api/challenges/${challengeId}/trash/restore`, { session: owner, body: { kind: "entry", id: entryId } })).response.status, 409, "não restaura registro em desafio fechado");
  assert.equal((await call("POST", `/api/challenges/${challengeId}/trash/purge`, { session: owner, body: { kind: "entry", id: entryId } })).response.status, 409, "nem apaga em definitivo");
});

test("D: restaurar um item do acervo pessoal traz de volta o vínculo e os registros da lista", async () => {
  const owner = await register("D Lista", "d_lista_viva");
  const created = await call("POST", "/api/personal/challenges", {
    session: owner, body: { recipe: "bookshelf", title: "Minha estante viva", items: [{ title: "Duna", author: "Herbert" }, { title: "1984", author: "Orwell" }] },
  });
  const challengeId = (created.body as { id: string }).id;
  const d = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    entryTypes: Array<{ id: string; purpose: string; fields: Array<{ id: string; key: string }> }>; items: Array<{ id: string; title: string }>;
  };
  const rating = d.entryTypes.find((t) => t.purpose === "rating")!;
  const nota = rating.fields.find((f) => f.key === "nota")!.id;
  const dunaItem = d.items.find((i) => i.title === "Duna")!.id;
  await call("POST", `/api/challenges/${challengeId}/entries`, { session: owner, body: { itemId: dunaItem, entryTypeId: rating.id, values: { [nota]: 5 } } });

  const catalog = (await call("GET", "/api/personal/catalog", { session: owner })).body as { items: Array<{ id: string; title: string }> };
  const dunaCatalog = catalog.items.find((i) => i.title === "Duna")!.id;
  assert.equal((await call("DELETE", `/api/personal/catalog/${dunaCatalog}`, { session: owner })).response.status, 200);
  assert.equal(((await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as { items: Array<{ title: string }> }).items.some((i) => i.title === "Duna"), false, "sai da lista");

  assert.equal((await call("POST", `/api/personal/trash/restore`, { session: owner, body: { kind: "catalog_item", id: dunaCatalog } })).response.status, 200);
  const back = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as { items: Array<{ id: string; title: string }> };
  assert.ok(back.items.some((i) => i.title === "Duna"), "a linha da lista volta");
  const entries = (await call("GET", `/api/challenges/${challengeId}/entries`, { session: owner })).body as { entries: Array<{ itemId: string | null }> };
  assert.ok(entries.entries.some((e) => e.itemId === back.items.find((i) => i.title === "Duna")!.id), "e a nota volta junto");
});

test("D: a lixeira interna do desafio lista a estrutura removida e restaura", async () => {
  const owner = await register("D Estrutura", "d_estrutura_interna");
  const groupId = ((await call("POST", "/api/groups", { session: owner, body: { name: "Clube D3" } })).body as { id: string }).id;
  const challenge = await call("POST", `/api/groups/${groupId}/challenges`, {
    session: owner, body: { recipe: "cinema", title: "Estrutura mexe", participantIds: [owner.user.id], items: [{ title: "A" }, { title: "B" }] },
  });
  const challengeId = (challenge.body as { id: string }).id;
  const items = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as { items: Array<{ id: string; title: string }> };
  const itemB = items.items.find((i) => i.title === "B")!.id;
  await call("DELETE", `/api/challenges/${challengeId}/items/${itemB}`, { session: owner });

  const archive = (await call("GET", `/api/challenges/${challengeId}/archive`, { session: owner })).body as {
    structure: Array<{ kind: string; id: string }>;
  };
  assert.ok(archive.structure.some((r) => r.kind === "challenge_item" && r.id === itemB), "o item removido aparece na estrutura removida");
  assert.equal((await call("POST", `/api/challenges/${challengeId}/trash/restore`, { session: owner, body: { kind: "challenge_item", id: itemB } })).response.status, 200);
  assert.ok(((await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as { items: Array<{ id: string }> }).items.some((i) => i.id === itemB));
});

test("D: excluir permanentemente um campo com métrica arquivada apontando para ele funciona", async () => {
  const owner = await register("D Campo", "d_campo_metrica");
  const groupId = ((await call("POST", "/api/groups", { session: owner, body: { name: "Clube D4" } })).body as { id: string }).id;
  const challenge = await call("POST", `/api/groups/${groupId}/challenges`, {
    session: owner,
    body: {
      recipe: "habit", title: "Campo extra", participantIds: [owner.user.id],
      fields: [
        { key: "minutos", label: "Minutos", type: "number", required: true, config: { min: 0, step: 1 } },
        { key: "extra", label: "Extra", type: "number", required: false, config: { min: 0, step: 1 } },
      ],
    },
  });
  const challengeId = (challenge.body as { id: string }).id;
  const d = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    entryTypes: Array<{ id: string }>; fields: Array<{ id: string; key: string }>;
  };
  const extra = d.fields.find((f) => f.key === "extra")!.id;
  const minutos = d.fields.find((f) => f.key === "minutos")!.id;
  // Métrica sobre "extra", depois arquivada.
  const m = await call("POST", `/api/challenges/${challengeId}/metrics`, { session: owner, body: { label: "Soma extra", operation: "sum", fieldId: extra } });
  await call("DELETE", `/api/challenges/${challengeId}/metrics/${(m.body as { id: string }).id}`, { session: owner });
  // Agora remove o campo "extra" (sem respostas → vai para a estrutura removida).
  await call("POST", `/api/challenges/${challengeId}/fields`, {
    session: owner,
    body: { entryTypeId: d.entryTypes[0].id, replace: true, archiveMissing: true, fields: [{ id: minutos, key: "minutos", label: "Minutos", type: "number", required: true, config: { min: 0, step: 1 } }] },
  });
  const purge = await call("POST", `/api/challenges/${challengeId}/trash/purge`, { session: owner, body: { kind: "field", id: extra } });
  assert.equal(purge.response.status, 200, JSON.stringify(purge.body));
});

// ── Onda E — contas e permissões administrativas ────────────────────────

test("E: excluir a conta apaga usuário, e-mail e senha; a identidade some do login", async () => {
  const person = await register("E Some", "e_some_conta");
  const groupId = ((await call("POST", "/api/groups", { session: person, body: { name: "Só meu" } })).body as { id: string }).id;
  void groupId;
  assert.equal((await call("POST", "/api/account/delete", { session: person, body: { password: "uma senha segura 123" } })).response.status, 200);

  const row = await adminPool.query<{ username: string; email: string | null; password_hash: string; display_name: string }>(
    "SELECT username, email, password_hash, display_name FROM users WHERE id = $1", [person.user.id],
  );
  assert.equal(row.rows[0].email, null);
  assert.equal(row.rows[0].display_name, "Conta removida");
  assert.notEqual(row.rows[0].username, "e_some_conta", "o nome de usuário é raspado");
  assert.equal(row.rows[0].password_hash, "ACCOUNT-DELETED", "a senha é destruída");
  // O nome de usuário livre pode ser reusado por outra pessoa.
  assert.equal((await call("POST", "/api/auth/register", { body: { name: "Novo", username: "e_some_conta", password: "uma senha segura 123" } })).response.status, 201);
});

test("E: conta desativada não lê dados privados por GET; admin desativado perde o /admin", async () => {
  const admin = await register("E Admin", "e_admin_desativa");
  await adminPool.query("UPDATE users SET platform_admin = true WHERE id = $1", [admin.user.id]);
  const adminSession = await login("e_admin_desativa");
  assert.equal((await call("GET", "/api/admin/overview", { session: adminSession })).response.status, 200);

  const person = await register("E Pausa", "e_pausa_conta");
  const gid = ((await call("POST", "/api/groups", { session: person, body: { name: "Grupo Pausa" } })).body as { id: string }).id;
  await call("POST", "/api/account/deactivate", { session: person, body: {} });
  const relog = await login("e_pausa_conta");
  assert.equal((await call("GET", `/api/groups/${gid}/trash`, { session: relog })).response.status, 403, "GET privado bloqueado");
  assert.equal((await call("GET", `/api/challenges/x`, { session: relog })).response.status, 403);
  assert.equal((await call("GET", "/api/bootstrap", { session: relog })).response.status, 200, "só o bootstrap responde");

  await call("POST", "/api/account/deactivate", { session: adminSession, body: {} });
  const adminRelog = await login("e_admin_desativa");
  assert.equal((await call("GET", "/api/admin/overview", { session: adminRelog })).response.status, 404, "admin desativado não abre o console");
});

test("E: não há redefinição de senha por link — nem pública, nem pelo /admin", async () => {
  const admin = await register("E Suporte", "e_suporte_reset");
  await adminPool.query("UPDATE users SET platform_admin = true WHERE id = $1", [admin.user.id]);
  const adminSession = await login("e_suporte_reset");
  const userReg = await call("POST", "/api/auth/register", { body: { name: "E Usuário", username: "e_usuario_reset", password: "uma senha segura 123", email: "e_usuario_reset@example.com" } });
  const userId = (userReg.body as { user: { id: string } }).user.id;

  // Um link emitido pelo admin seria assumir a conta (o admin vê o e-mail aqui e
  // fabricaria qualquer "a pessoa pediu"); um fluxo público precisa de e-mail
  // para entregar o link, e e-mail está fora do escopo da V1. Nenhuma das rotas
  // existe.
  for (const path of ["/api/auth/forgot", "/api/auth/reset", "/api/admin/users/reset-link"]) {
    assert.equal(
      (await call("POST", path, { session: adminSession, body: { email: "e_usuario_reset@example.com", userId, token: "x".repeat(43), password: "outra senha bem forte 1" } })).response.status,
      404,
      `${path} não existe`,
    );
  }
  // E o painel não expõe mais nenhum indicador de "reset pedido".
  const users = (await call("GET", "/api/admin/users", { session: adminSession })).body as {
    users: Array<Record<string, unknown>>;
  };
  assert.ok(users.users.every((u) => !("pendingReset" in u)), "sem indicador de reset no /admin");
});

test("E: a publicação nominal não expõe ids internos de participante", async () => {
  const owner = await register("E Pub", "e_pub_nominal");
  const b = await register("E Bela Pub", "e_bela_pub");
  const groupId = ((await call("POST", "/api/groups", { session: owner, body: { name: "Clube E4" } })).body as { id: string }).id;
  const invite = (await call("POST", `/api/groups/${groupId}/invites`, { session: owner, body: { expiresInDays: 7, maxUses: 1 } })).body as { token: string };
  await call("POST", `/api/invites/${invite.token}`, { session: b, body: {} });
  const challenge = await call("POST", `/api/groups/${groupId}/challenges`, {
    session: owner, body: { recipe: "cinema", title: "Com nomes de novo", participantIds: [owner.user.id, b.user.id], items: [{ title: "F" }] },
  });
  const challengeId = (challenge.body as { id: string }).id;
  const d = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    entryTypes: Array<{ id: string; purpose: string; fields: Array<{ id: string; key: string }> }>; items: Array<{ id: string }>;
  };
  const rating = d.entryTypes.find((t) => t.purpose === "rating")!;
  const nota = rating.fields.find((f) => f.key === "nota")!.id;
  await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "active" } });
  await call("PATCH", `/api/challenges/${challengeId}/consent`, { session: b, body: { nameConsent: true } });
  await call("PATCH", `/api/challenges/${challengeId}/consent`, { session: owner, body: { nameConsent: true } });
  await call("POST", `/api/challenges/${challengeId}/metrics`, { session: owner, body: { label: "Notas por pessoa", operation: "average", fieldId: nota, groupBy: "participant" } });
  for (const s of [owner, b]) await call("POST", `/api/challenges/${challengeId}/entries`, { session: s, body: { itemId: d.items[0].id, entryTypeId: rating.id, values: { [nota]: 4 } } });
  await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "closed" } });
  await call("POST", `/api/challenges/${challengeId}/results`, { session: owner, body: { anonymizeParticipants: false } });
  const pub = await call("POST", `/api/challenges/${challengeId}/results/publish`, { session: owner, body: {} });
  const shared = await call("GET", `/api/results/${(pub.body as { shareToken: string }).shareToken}`);
  const dump = JSON.stringify(shared.body);
  assert.doesNotMatch(dump, new RegExp(owner.user.id), "o id do dono não aparece");
  assert.doesNotMatch(dump, new RegExp(b.user.id), "nem o id de Bela");
  assert.match(dump, /E Bela Pub/, "mas o nome de quem consentiu aparece");
});

// ── Segunda revisão — ciclo de vida (binar/restaurar, conta, cota) ──────

test("R2: binar um desafio derruba a vitrine, e restaurar NÃO ressuscita o link antigo", async () => {
  const owner = await register("R2 Pub", "r2_pub_ressuscita");
  const groupId = ((await call("POST", "/api/groups", { session: owner, body: { name: "Clube R2" } })).body as { id: string }).id;
  const challenge = await call("POST", `/api/groups/${groupId}/challenges`, {
    session: owner, body: { recipe: "cinema", title: "Vitrine que cai", participantIds: [owner.user.id], items: [{ title: "F" }] },
  });
  const challengeId = (challenge.body as { id: string }).id;
  const d = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    entryTypes: Array<{ id: string; purpose: string; fields: Array<{ id: string; key: string }> }>; items: Array<{ id: string }>;
  };
  const rating = d.entryTypes.find((t) => t.purpose === "rating")!;
  await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "active" } });
  await call("POST", `/api/challenges/${challengeId}/entries`, { session: owner, body: { itemId: d.items[0].id, entryTypeId: rating.id, values: { [rating.fields.find((f) => f.key === "nota")!.id]: 4 } } });
  await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "closed" } });
  const token = ((await call("POST", `/api/challenges/${challengeId}/results/publish`, { session: owner, body: {} })).body as { shareToken: string }).shareToken;
  assert.equal((await call("GET", `/api/results/${token}`)).response.status, 200);

  assert.equal((await call("DELETE", `/api/challenges/${challengeId}`, { session: owner })).response.status, 200);
  assert.equal((await call("GET", `/api/results/${token}`)).response.status, 404);
  assert.equal((await call("POST", `/api/groups/${groupId}/trash/restore`, { session: owner, body: { kind: "challenge", id: challengeId } })).response.status, 200);
  assert.equal((await call("GET", `/api/results/${token}`)).response.status, 404, "restaurar não republica o link antigo");
  const after = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    result: { publishedAt: string | null; shareToken?: string | null };
  };
  assert.equal(after.result.publishedAt, null, "o desafio volta despublicado, até nova confirmação");
});

test("R2: excluir a conta também resolve os grupos que estavam na própria lixeira", async () => {
  const owner = await register("R2 Órfão", "r2_orfao");
  const gid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Grupo binado" } })).body as { id: string }).id;
  assert.equal((await call("DELETE", `/api/groups/${gid}`, { session: owner })).response.status, 200);

  assert.equal((await call("POST", "/api/account/delete", { session: owner, body: { password: "uma senha segura 123" } })).response.status, 200);
  const left = await adminPool.query("SELECT 1 FROM groups WHERE id = $1", [gid]);
  assert.equal(left.rowCount, 0, "o grupo binado é apagado junto — não fica sem responsável");
  const orphanTrash = await adminPool.query("SELECT 1 FROM trash_items WHERE entity_id = $1", [gid]);
  assert.equal(orphanTrash.rowCount, 0, "e sem registro de lixeira pendurado");
});

test("R2: o preview de exclusão lista os grupos que estão na própria lixeira", async () => {
  const owner = await register("R2 Preview", "r2_preview_lixeira");
  const solo = ((await call("POST", "/api/groups", { session: owner, body: { name: "Só meu" } })).body as { id: string }).id;
  const shared = ((await call("POST", "/api/groups", { session: owner, body: { name: "Compartilhado" } })).body as { id: string }).id;
  const friend = await register("Amiga Preview", "amiga_preview_lixeira");
  const invite = (await call("POST", `/api/groups/${shared}/invites`, { session: owner, body: { expiresInDays: 7, maxUses: 1 } })).body as { token: string };
  await call("POST", `/api/invites/${invite.token}`, { session: friend, body: {} });
  // Ambos vão para a lixeira do dono — a exclusão ainda os processa.
  assert.equal((await call("DELETE", `/api/groups/${solo}`, { session: owner })).response.status, 200);
  assert.equal((await call("DELETE", `/api/groups/${shared}`, { session: owner })).response.status, 200);

  const preview = (await call("GET", "/api/account/deletion-preview", { session: owner })).body as {
    ownedGroups: Array<{ name: string; willTransfer: boolean }>;
  };
  const names = preview.ownedGroups.map((g) => g.name).sort();
  assert.deepEqual(names, ["Compartilhado", "Só meu"], "os grupos binados aparecem no preview");
  assert.equal(preview.ownedGroups.find((g) => g.name === "Só meu")?.willTransfer, false, "grupo solo é apagado");
  assert.equal(preview.ownedGroups.find((g) => g.name === "Compartilhado")?.willTransfer, true, "grupo com outra pessoa transfere");
});

test("R2: grupo binado pelo dono não ocupa a cota dos outros participantes", async () => {
  const owner = await register("R2 Dono", "r2_dono_cota");
  const member = await register("R2 Membro", "r2_membro_cota");
  const gid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Some da vista" } })).body as { id: string }).id;
  const invite = (await call("POST", `/api/groups/${gid}/invites`, { session: owner, body: { expiresInDays: 7, maxUses: 1 } })).body as { token: string };
  await call("POST", `/api/invites/${invite.token}`, { session: member, body: {} });

  const before = await adminPool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM group_members gm JOIN groups g ON g.id = gm.group_id
      AND g.kind = 'standard' AND g.deleted_at IS NULL WHERE gm.user_id = $1 AND gm.removed_at IS NULL`,
    [member.user.id],
  );
  assert.equal(before.rows[0].count, 1);

  assert.equal((await call("DELETE", `/api/groups/${gid}`, { session: owner })).response.status, 200);
  const after = await adminPool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM group_members gm JOIN groups g ON g.id = gm.group_id
      AND g.kind = 'standard' AND g.deleted_at IS NULL WHERE gm.user_id = $1 AND gm.removed_at IS NULL`,
    [member.user.id],
  );
  assert.equal(after.rows[0].count, 0, "o grupo binado sai da conta do participante");
  // E o participante segue conseguindo entrar em outros grupos.
  const other = await register("R2 Outro Dono", "r2_outro_dono");
  const gid2 = ((await call("POST", "/api/groups", { session: other, body: { name: "Outro grupo" } })).body as { id: string }).id;
  const inv2 = (await call("POST", `/api/groups/${gid2}/invites`, { session: other, body: { expiresInDays: 7, maxUses: 1 } })).body as { token: string };
  assert.equal((await call("POST", `/api/invites/${inv2.token}`, { session: member, body: {} })).response.status, 200);
});

test("R2: métrica não é restaurada enquanto o campo que ela lê estiver arquivado", async () => {
  const owner = await register("R2 Métrica", "r2_metrica_pai");
  const groupId = ((await call("POST", "/api/groups", { session: owner, body: { name: "Clube R2b" } })).body as { id: string }).id;
  const challenge = await call("POST", `/api/groups/${groupId}/challenges`, {
    session: owner,
    body: {
      recipe: "habit", title: "Campo e métrica", participantIds: [owner.user.id],
      fields: [
        { key: "minutos", label: "Minutos", type: "number", required: true, config: { min: 0, step: 1 } },
        { key: "extra", label: "Extra", type: "number", required: false, config: { min: 0, step: 1 } },
      ],
    },
  });
  const challengeId = (challenge.body as { id: string }).id;
  const d = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    entryTypes: Array<{ id: string }>; fields: Array<{ id: string; key: string }>;
  };
  const extra = d.fields.find((f) => f.key === "extra")!.id;
  const minutos = d.fields.find((f) => f.key === "minutos")!.id;
  const metricId = ((await call("POST", `/api/challenges/${challengeId}/metrics`, {
    session: owner, body: { label: "Soma extra", operation: "sum", fieldId: extra },
  })).body as { id: string }).id;

  // Arquiva a métrica e, depois, o campo que ela lia.
  await call("DELETE", `/api/challenges/${challengeId}/metrics/${metricId}`, { session: owner });
  await call("POST", `/api/challenges/${challengeId}/fields`, {
    session: owner,
    body: { entryTypeId: d.entryTypes[0].id, replace: true, archiveMissing: true, fields: [
      { id: minutos, key: "minutos", label: "Minutos", type: "number", required: true, config: { min: 0, step: 1 } },
    ] },
  });

  const restore = await call("POST", `/api/challenges/${challengeId}/trash/restore`, { session: owner, body: { kind: "metric", id: metricId } });
  assert.equal(restore.response.status, 409, JSON.stringify(restore.body));
  assert.equal((restore.body as { error: string }).error, "parent_trashed");
  // Restaurando o campo primeiro, a métrica volta.
  assert.equal((await call("POST", `/api/challenges/${challengeId}/trash/restore`, { session: owner, body: { kind: "field", id: extra } })).response.status, 200);
  assert.equal((await call("POST", `/api/challenges/${challengeId}/trash/restore`, { session: owner, body: { kind: "metric", id: metricId } })).response.status, 200);
});

test("R2: renomear ao restaurar um item do acervo usa a mesma chave de identidade da criação", async () => {
  const owner = await register("R2 Acervo", "r2_acervo_rename");
  const created = await call("POST", "/api/personal/challenges", {
    session: owner, body: { recipe: "bookshelf", title: "Estante R2", items: [{ title: "Livro Velho", author: "A" }] },
  });
  void created;
  const catalog = (await call("GET", "/api/personal/catalog", { session: owner })).body as { items: Array<{ id: string; title: string }> };
  const itemId = catalog.items.find((i) => i.title === "Livro Velho")!.id;
  await call("DELETE", `/api/personal/catalog/${itemId}`, { session: owner });
  assert.equal(
    (await call("POST", "/api/personal/trash/restore", { session: owner, body: { kind: "catalog_item", id: itemId, rename: "  Ficção   Científica  " } })).response.status,
    200,
  );
  const row = await adminPool.query<{ title: string; normalized_title: string }>(
    "SELECT title, normalized_title FROM catalog_items WHERE id = $1", [itemId],
  );
  assert.equal(row.rows[0].title, "Ficção   Científica", "o título guarda o que a pessoa digitou (só aparado)");
  assert.equal(row.rows[0].normalized_title, "ficcao cientifica", "sem acento, espaços colapsados — igual à criação");
});

test("lixeira pessoal: mostra o desafio pessoal binado e um fantasma pré-registro não trava a criação", async () => {
  const owner = await register("Dona Lixo Pessoal", "dona_lixo_pessoal");

  const a = await call("POST", "/api/personal/challenges", {
    session: owner, body: { recipe: "cinema", title: "Maratona A", startsOn: null, endsOn: null, items: [{ title: "F1" }] },
  });
  assert.equal(a.response.status, 201, JSON.stringify(a.body));
  const b = await call("POST", "/api/personal/challenges", {
    session: owner, body: { recipe: "cinema", title: "Maratona B", startsOn: null, endsOn: null, items: [{ title: "F2" }] },
  });
  const binnedId = (b.body as { id: string }).id;

  // Binar pela via normal: some da tela e aparece na lixeira pessoal.
  assert.equal((await call("DELETE", `/api/challenges/${binnedId}`, { session: owner })).response.status, 200);
  const bin = await call("GET", "/api/personal/trash", { session: owner });
  assert.equal(bin.response.status, 200, JSON.stringify(bin.body));
  const binItems = (bin.body as { items: Array<{ kind: string; id: string }> }).items;
  assert.ok(binItems.some((i) => i.kind === "challenge" && i.id === binnedId), "o desafio pessoal binado aparece em Minha lixeira");

  // Fantasma: soft-delete direto no banco, sem registro em trash_items (estado
  // anterior à lixeira). Não pode aparecer na lixeira nem contar para o limite.
  const wsRow = await adminPool.query<{ id: string }>(
    "SELECT id FROM groups WHERE kind='personal' AND owner_user_id=$1", [owner.user.id],
  );
  const workspaceId = wsRow.rows[0].id;
  const ghost = await adminPool.query<{ id: string }>(
    `INSERT INTO challenges (id, group_id, created_by_user_id, title, recipe_key, recipe_version, time_zone, kind, status, deleted_at, created_at, updated_at)
     VALUES ('ghost_pers_1', $1, $2, 'Fantasma', 'cinema', 1, 'America/Sao_Paulo', 'round', 'draft', now(), now(), now())
     RETURNING id`,
    [workspaceId, owner.user.id],
  );
  assert.equal(ghost.rows[0].id, "ghost_pers_1");

  const bin2 = (await call("GET", "/api/personal/trash", { session: owner })).body as { items: Array<{ id: string }> };
  assert.ok(!bin2.items.some((i) => i.id === "ghost_pers_1"), "o fantasma não aparece na lixeira");

  const stillWorks = await call("POST", "/api/personal/challenges", {
    session: owner, body: { recipe: "cinema", title: "Maratona C", startsOn: null, endsOn: null, items: [{ title: "F3" }] },
  });
  assert.equal(stillWorks.response.status, 201, "o fantasma não conta para o limite do espaço pessoal");
});

test("indicações em itens novos: nome salvo na criação e na adição, isolado por espaço, e o acervo de filme guarda a primeira indicação", async () => {
  const owner = await register("Dora", "dora_indica");
  const other = await register("Enzo", "enzo_indica");
  const gid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Sessão da Tarde" } })).body as { id: string }).id;
  const otherGid = ((await call("POST", "/api/groups", { session: other, body: { name: "Outro" } })).body as { id: string }).id;
  const ana = ((await call("POST", `/api/groups/${gid}/catalog/recommenders`, { session: owner, body: { displayName: "Ana" } })).body as { id: string }).id;
  const foreign = ((await call("POST", `/api/groups/${otherGid}/catalog/recommenders`, { session: other, body: { displayName: "Alheia" } })).body as { id: string }).id;

  const boot = await call("GET", "/api/bootstrap", { session: owner });
  assert.equal(
    (boot.body as { groups: Array<{ id: string; recommendationsEnabled: boolean }> }).groups.find((group) => group.id === gid)?.recommendationsEnabled,
    true, "o bootstrap diz se o grupo usa indicações",
  );

  // na criação: um nome salvo por item, no mesmo lugar em que um membro ou uma nota já cabiam
  const created = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner,
    body: {
      recipe: "cinema", title: "Indicados", participantIds: [owner.user.id],
      items: [{ title: "Aftersun", recommendedByExternalId: ana }, { title: "Solaris", originNote: "um blog" }, { title: "Stalker" }],
    },
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  const cid = (created.body as { id: string }).id;
  const detail = (await call("GET", `/api/challenges/${cid}`, { session: owner })).body as {
    items: Array<{ title: string; recommendedBy: { kind: string; name: string } | null; originNote: string | null }>;
  };
  const byTitle = new Map(detail.items.map((item) => [item.title, item]));
  assert.deepEqual(byTitle.get("Aftersun")?.recommendedBy, { kind: "external", id: ana, name: "Ana" });
  assert.equal(byTitle.get("Solaris")?.originNote, "um blog");
  assert.equal(byTitle.get("Stalker")?.recommendedBy, null);

  // nome de outro espaço, ou duas origens de uma vez: recusado, e nada é criado pela metade
  const crossWorkspace = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner, body: { recipe: "cinema", title: "Alheio", participantIds: [owner.user.id], items: [{ title: "X", recommendedByExternalId: foreign }] },
  });
  assert.equal(crossWorkspace.response.status, 400, JSON.stringify(crossWorkspace.body));
  const both = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner, body: { recipe: "cinema", title: "Duas", participantIds: [owner.user.id], items: [{ title: "X", recommendedByExternalId: ana, originNote: "e um blog" }] },
  });
  assert.equal(both.response.status, 400, JSON.stringify(both.body));

  // adicionando depois, em lote e um a um
  const batch = await call("POST", `/api/challenges/${cid}/items`, { session: owner, body: { items: [{ title: "Nostalgia", recommendedByExternalId: ana }] } });
  assert.equal(batch.response.status, 201, JSON.stringify(batch.body));
  const single = await call("POST", `/api/challenges/${cid}/items`, { session: owner, body: { title: "Espelho", recommendedByExternalId: ana } });
  assert.equal(single.response.status, 201, JSON.stringify(single.body));
  const later = (await call("GET", `/api/challenges/${cid}`, { session: owner })).body as { items: Array<{ title: string; recommendedBy: { name: string } | null }> };
  assert.equal(later.items.find((item) => item.title === "Nostalgia")?.recommendedBy?.name, "Ana");
  assert.equal(later.items.find((item) => item.title === "Espelho")?.recommendedBy?.name, "Ana");

  // acervo de filme: a primeira indicação fica; uma segunda adição do mesmo título não a sobrescreve
  const first = await call("POST", `/api/groups/${gid}/catalog/items`, {
    session: owner, body: { kind: "film", title: "Persona", catalogRecommendedByUserId: owner.user.id },
  });
  assert.equal(first.response.status, 201, JSON.stringify(first.body));
  const again = await call("POST", `/api/groups/${gid}/catalog/items`, {
    session: owner, body: { kind: "film", title: "Persona", catalogRecommendedByExternalId: ana },
  });
  assert.equal(again.response.status, 201, JSON.stringify(again.body));
  assert.equal((again.body as { id: string }).id, (first.body as { id: string }).id, "filme repetido reaproveita o mesmo item");
  const personaId = (first.body as { id: string }).id;
  const item = (await call("GET", `/api/groups/${gid}/catalog/${personaId}`, { session: owner })).body as {
    recommendedBy: { kind: string; name: string } | null; originNote: string | null;
  };
  assert.equal(item.recommendedBy?.kind, "member", "o detalhe do item do acervo mostra quem indicou");
  assert.equal(item.recommendedBy?.name, "Dora");
});

test("desafio traz a biblioteca de onde vêm os itens, e a regra de preenchimento de uma resposta compartilhada muda depois", async () => {
  const owner = await register("Fábio", "fabio_biblio");
  const gid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Rolê" } })).body as { id: string }).id;

  const cinema = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner, body: { recipe: "cinema", title: "Filmes", participantIds: [owner.user.id], items: [{ title: "Aftersun" }] },
  });
  const cinemaId = (cinema.body as { id: string }).id;
  const cinemaDetail = (await call("GET", `/api/challenges/${cinemaId}`, { session: owner })).body as {
    libraries: Array<{ id: string | null; kind: string; source: string }>; recommendationsEnabled: boolean;
  };
  assert.deepEqual(cinemaDetail.libraries.map((library) => [library.kind, library.source]), [["film", "screens"]]);
  assert.equal(cinemaDetail.recommendationsEnabled, true);

  await call("POST", `/api/groups/${gid}/catalog/libraries`, { session: owner, body: { source: "tables" } });
  const tables = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner, body: { recipe: "tables", title: "Onde comer", participantIds: [owner.user.id], items: [{ title: "Cantina do Zé" }] },
  });
  const tablesId = (tables.body as { id: string }).id;
  const tablesDetail = (await call("GET", `/api/challenges/${tablesId}`, { session: owner })).body as { libraries: Array<{ id: string; source: string; kind: string }> };
  assert.deepEqual(tablesDetail.libraries.map((library) => library.source), ["tables"]);
  assert.ok(tablesDetail.libraries[0].id, "o desafio ficou ligado à biblioteca Tables que a pessoa criou");

  // um hábito não tem biblioteca nenhuma
  const habit = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner, body: { recipe: "habit", title: "Estudo", participantIds: [owner.user.id] },
  });
  const habitDetail = (await call("GET", `/api/challenges/${(habit.body as { id: string }).id}`, { session: owner })).body as { libraries: unknown[] };
  assert.deepEqual(habitDetail.libraries, []);

  // o modelo público nunca expõe a biblioteca do grupo de origem
  const admin = await register("Curador", "curador_biblio");
  await adminPool.query("UPDATE users SET platform_admin = true WHERE id = $1", [admin.user.id]);
  const platform = await login("curador_biblio");
  const pgid = ((await call("POST", "/api/groups", { session: platform, body: { name: "Modelos" } })).body as { id: string }).id;
  const source = await call("POST", `/api/groups/${pgid}/challenges`, {
    session: platform, body: { recipe: "cinema", title: "Modelo", participantIds: [platform.user.id], items: [{ title: "Solaris" }] },
  });
  const sourceId = (source.body as { id: string }).id;
  assert.equal((await call("POST", `/api/challenges/${sourceId}/template`, { session: platform, body: {} })).response.status, 200);
  const preview = (await call("GET", `/api/templates/${sourceId}`)).body as { libraries: unknown[] };
  assert.deepEqual(preview.libraries, []);

  // a regra de quem preenche muda depois de criada — só numa resposta compartilhada
  const shared = await call("POST", `/api/challenges/${cinemaId}/entry-types`, {
    session: owner, body: { name: "Placar", sharedEditPolicy: "members_fill_admin_corrects", field: { key: "placar", label: "Placar", type: "number", required: true } },
  });
  assert.equal(shared.response.status, 201, JSON.stringify(shared.body));
  const sharedId = (shared.body as { id: string }).id;
  const changed = await call("PATCH", `/api/challenges/${cinemaId}/entry-types/${sharedId}`, { session: owner, body: { sharedEditPolicy: "members_can_edit" } });
  assert.equal(changed.response.status, 200, JSON.stringify(changed.body));
  assert.equal((changed.body as { sharedEditPolicy: string }).sharedEditPolicy, "members_can_edit");
  const after = (await call("GET", `/api/challenges/${cinemaId}`, { session: owner })).body as { entryTypes: Array<{ id: string; sharedEditPolicy: string | null }> };
  assert.equal(after.entryTypes.find((type) => type.id === sharedId)?.sharedEditPolicy, "members_can_edit");
  const audit = await adminPool.query("SELECT 1 FROM audit_events WHERE action = 'entry_type.shared_edit_policy_changed' AND entity_id = $1", [sharedId]);
  assert.equal(audit.rowCount, 1, "a mudança de regra fica no histórico");

  assert.equal((await call("PATCH", `/api/challenges/${cinemaId}/entry-types/${sharedId}`, { session: owner, body: { sharedEditPolicy: "qualquer" } })).response.status, 400);
  const typesNow = (await call("GET", `/api/challenges/${cinemaId}`, { session: owner })).body as { entryTypes: Array<{ id: string; answerScope: string }> };
  const individual = typesNow.entryTypes.find((type) => type.answerScope === "individual")!;
  const notShared = await call("PATCH", `/api/challenges/${cinemaId}/entry-types/${individual.id}`, { session: owner, body: { sharedEditPolicy: "members_can_edit" } });
  assert.equal(notShared.response.status, 409, JSON.stringify(notShared.body));
  assert.equal((notShared.body as { error: string }).error, "not_shared");
  // a visibilidade continua funcionando sozinha, como antes
  const visibility = await call("PATCH", `/api/challenges/${cinemaId}/entry-types/${individual.id}`, { session: owner, body: { visibilityPolicy: "after_own" } });
  assert.equal(visibility.response.status, 200, JSON.stringify(visibility.body));
  assert.deepEqual(visibility.body, { id: individual.id, visibilityPolicy: "after_own" });
});

test("duplicar preserva a privacidade de cada resposta: quem vê e quem preenche", async () => {
  const owner = await register("Gabi", "gabi_privada");
  const srcGid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Origem" } })).body as { id: string }).id;
  const dstGid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Destino" } })).body as { id: string }).id;
  const created = await call("POST", `/api/groups/${srcGid}/challenges`, {
    session: owner, body: { recipe: "cinema", title: "Privado", participantIds: [owner.user.id], items: [{ title: "Aftersun" }] },
  });
  const cid = (created.body as { id: string }).id;
  const shared = (await call("POST", `/api/challenges/${cid}/entry-types`, {
    session: owner, body: { name: "Veredito", sharedEditPolicy: "members_fill_admin_corrects", field: { label: "Veredito", type: "text", required: false } },
  })).body as { id: string };
  const types = (await call("GET", `/api/challenges/${cid}`, { session: owner })).body as { entryTypes: Array<{ id: string; answerScope: string }> };
  const individual = types.entryTypes.find((type) => type.answerScope === "individual")!;
  assert.equal((await call("PATCH", `/api/challenges/${cid}/entry-types/${individual.id}`, { session: owner, body: { visibilityPolicy: "author_only" } })).response.status, 200);
  assert.equal((await call("PATCH", `/api/challenges/${cid}/entry-types/${shared.id}`, { session: owner, body: { visibilityPolicy: "after_close" } })).response.status, 200);

  const copy = await call("POST", `/api/challenges/${cid}/duplicate`, { session: owner, body: { targetGroupId: dstGid, mode: "structure" } });
  assert.equal(copy.response.status, 201, JSON.stringify(copy.body));
  const copied = (await call("GET", `/api/challenges/${(copy.body as { id: string }).id}`, { session: owner })).body as {
    entryTypes: Array<{ semanticKey: string; answerScope: string; visibilityPolicy: string; sharedEditPolicy: string | null }>;
  };
  const byScope = new Map(copied.entryTypes.map((type) => [type.answerScope, type]));
  assert.equal(byScope.get("individual")?.visibilityPolicy, "author_only", "o que era só do autor continua só do autor");
  assert.equal(byScope.get("shared")?.visibilityPolicy, "after_close", "o que abria só depois de encerrar continua assim");
  assert.equal(byScope.get("shared")?.sharedEditPolicy, "members_fill_admin_corrects");

  // e o modelo público, que usa a mesma cópia
  await adminPool.query("UPDATE users SET platform_admin = true WHERE id = $1", [owner.user.id]);
  const platform = await login("gabi_privada");
  assert.equal((await call("POST", `/api/challenges/${cid}/template`, { session: platform, body: {} })).response.status, 200);
  const fromTemplate = await call("POST", `/api/templates/${cid}/duplicate`, { session: platform, body: { targetGroupId: dstGid } });
  assert.equal(fromTemplate.response.status, 201, JSON.stringify(fromTemplate.body));
  const tpl = await adminPool.query<{ visibility_policy: string }>(
    "SELECT visibility_policy FROM entry_types WHERE challenge_id = $1 AND archived_at IS NULL ORDER BY visibility_policy", [(fromTemplate.body as { id: string }).id],
  );
  assert.deepEqual(tpl.rows.map((row) => row.visibility_policy), ["after_close", "author_only"]);
});

test("duplicar leva a biblioteca com propriedades, valores e agenda dos itens — e nunca sobrescreve o que o destino já tinha", async () => {
  const owner = await register("Hugo", "hugo_copa");
  const srcGid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Copa 2026" } })).body as { id: string }).id;
  const dstGid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Outro bolão" } })).body as { id: string }).id;

  const matches = (await call("POST", `/api/groups/${srcGid}/catalog/libraries`, { session: owner, body: { label: "Jogos" } })).body as { id: string; kind: string };
  const attr = async (label: string, type: string) =>
    (await call("POST", `/api/groups/${srcGid}/catalog-attributes`, { session: owner, body: { libraryId: matches.id, label, type } })).body as { id: string; key: string };
  const stage = await attr("Fase", "text");
  const secret = await attr("Estádio", "text");

  const created = await call("POST", `/api/groups/${srcGid}/challenges`, {
    session: owner,
    body: {
      recipe: "custom", title: "Copa", libraryId: matches.id, participantIds: [owner.user.id],
      items: [
        { title: "Brasil x Argentina", attributes: { [stage.key]: "Grupos", [secret.key]: "Maracanã" } },
        { title: "França x Alemanha", attributes: { [stage.key]: "Oitavas" } },
      ],
    },
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  const cid = (created.body as { id: string }).id;
  const items = ((await call("GET", `/api/challenges/${cid}`, { session: owner })).body as { items: Array<{ id: string; title: string }> }).items;
  // ocultar uma propriedade guarda o valor; a cópia leva também o que está oculto
  await call("PATCH", `/api/catalog/libraries/${matches.id}/properties/${secret.id}`, { session: owner, body: { hidden: true } });
  const kickoff = "2026-06-15T19:00:00.000Z";
  const day = await call("PATCH", `/api/challenges/${cid}/items/${items[1].id}`, { session: owner, body: { opensOn: "2026-06-20", dueOn: "2026-06-21" } });
  assert.equal(day.response.status, 200, JSON.stringify(day.body));
  assert.equal((await call("PATCH", `/api/challenges/${cid}/items/${items[0].id}`, { session: owner, body: { opensAt: kickoff, dueAt: "2026-06-15T21:00:00.000Z" } })).response.status, 200);

  const withItems = await call("POST", `/api/challenges/${cid}/duplicate`, { session: owner, body: { targetGroupId: dstGid, mode: "structure_and_items" } });
  assert.equal(withItems.response.status, 201, JSON.stringify(withItems.body));
  const copyId = (withItems.body as { id: string }).id;

  // a biblioteca, com o nome e as duas propriedades (inclusive a oculta), já existe no destino
  const dstLib = (await adminPool.query<{ id: string; label: string }>("SELECT id, label FROM catalog_libraries WHERE group_id = $1 AND kind = $2", [dstGid, matches.kind])).rows[0];
  assert.equal(dstLib.label, "Jogos");
  const dstProps = (await call("GET", `/api/catalog/libraries/${dstLib.id}/properties`, { session: owner })).body as {
    properties: Array<{ storage: string; label: string | null; hidden: boolean; attributeKey?: string }>;
  };
  assert.deepEqual(
    dstProps.properties.filter((property) => property.storage === "attribute").map((property) => [property.label, property.hidden]),
    [["Fase", false], ["Estádio", true]],
    "as propriedades personalizadas e o estado oculto vêm junto",
  );
  // …e os valores de cada item, inclusive o da propriedade oculta
  const values = await adminPool.query<{ title: string; label: string; text_value: string }>(
    `SELECT ci.title, d.label, v.text_value FROM catalog_attribute_values v
       JOIN catalog_items ci ON ci.id = v.catalog_item_id JOIN catalog_attribute_defs d ON d.id = v.attribute_def_id
      WHERE ci.group_id = $1 ORDER BY ci.title, d.label`, [dstGid],
  );
  assert.deepEqual(values.rows.map((row) => [row.title, row.label, row.text_value]), [
    ["Brasil x Argentina", "Estádio", "Maracanã"], ["Brasil x Argentina", "Fase", "Grupos"], ["França x Alemanha", "Fase", "Oitavas"],
  ]);
  // a agenda de cada jogo atravessa: o horário exato, a data só, e como foram informados
  const copyDetail = (await call("GET", `/api/challenges/${copyId}`, { session: owner })).body as {
    items: Array<{ title: string; opensAt: string | null; dueAt: string | null; schedulePrecision: string }>;
    libraries: Array<{ kind: string; label: string | null }>; startsOn: string | null;
  };
  const brasil = copyDetail.items.find((item) => item.title === "Brasil x Argentina")!;
  assert.equal(brasil.opensAt, kickoff);
  assert.equal(brasil.schedulePrecision, "datetime");
  const franca = copyDetail.items.find((item) => item.title === "França x Alemanha")!;
  assert.equal(franca.schedulePrecision, "date");
  assert.ok(franca.opensAt && franca.dueAt, "a data-só também");
  assert.equal(copyDetail.startsOn, null, "o período de participação continua zerado");
  assert.deepEqual(copyDetail.libraries.map((library) => [library.kind, library.label]), [[matches.kind, "Jogos"]]);

  // só a estrutura: sem itens, mas a biblioteca e suas propriedades existem e ficam vinculadas
  const dst2 = ((await call("POST", "/api/groups", { session: owner, body: { name: "Só a estrutura" } })).body as { id: string }).id;
  const structure = await call("POST", `/api/challenges/${cid}/duplicate`, { session: owner, body: { targetGroupId: dst2, mode: "structure" } });
  assert.equal(structure.response.status, 201, JSON.stringify(structure.body));
  const structureId = (structure.body as { id: string }).id;
  const structureDetail = (await call("GET", `/api/challenges/${structureId}`, { session: owner })).body as { items: unknown[]; libraries: Array<{ kind: string; id: string }> };
  assert.equal(structureDetail.items.length, 0);
  assert.deepEqual(structureDetail.libraries.map((library) => library.kind), [matches.kind], "a cópia só da estrutura continua ligada à biblioteca");
  const structureProps = (await call("GET", `/api/catalog/libraries/${structureDetail.libraries[0].id}/properties`, { session: owner })).body as { properties: Array<{ storage: string }> };
  assert.equal(structureProps.properties.filter((property) => property.storage === "attribute").length, 2);
  const added = await call("POST", `/api/challenges/${structureId}/items`, { session: owner, body: { title: "Espanha x Itália" } });
  assert.equal(added.response.status, 201, `dá para adicionar itens à cópia sem escolher biblioteca: ${JSON.stringify(added.body)}`);

  // um destino que já customizou a biblioteca e já tinha um item: o que é dele fica
  const dst3 = ((await call("POST", "/api/groups", { session: owner, body: { name: "Já tinha" } })).body as { id: string }).id;
  await adminPool.query(
    "INSERT INTO catalog_libraries (id, group_id, kind, source, label, position, created_by_user_id) VALUES ('lib-ja-tinha', $1, $2, 'custom', 'Partidas', 0, $3)",
    [dst3, matches.kind, owner.user.id],
  );
  await adminPool.query(
    `INSERT INTO catalog_attribute_defs (id, group_id, kind, semantic_key, label, type, position, created_by_user_id)
     VALUES ('def-ja-tinha', $1, $2, $3, 'Etapa', 'text', 0, $4)`, [dst3, matches.kind, stage.key, owner.user.id],
  );
  const merged = await call("POST", `/api/challenges/${cid}/duplicate`, { session: owner, body: { targetGroupId: dst3, mode: "structure" } });
  assert.equal(merged.response.status, 201, JSON.stringify(merged.body));
  const mergedLib = (await adminPool.query<{ label: string }>("SELECT label FROM catalog_libraries WHERE group_id = $1 AND kind = $2", [dst3, matches.kind])).rows[0];
  assert.equal(mergedLib.label, "Partidas", "o nome que o destino deu à biblioteca não é sobrescrito");
  const mergedDefs = await adminPool.query<{ label: string }>("SELECT label FROM catalog_attribute_defs WHERE group_id = $1 AND kind = $2 AND archived_at IS NULL ORDER BY label", [dst3, matches.kind]);
  assert.deepEqual(mergedDefs.rows.map((row) => row.label), ["Estádio", "Etapa"], "a propriedade que o destino tinha fica como está; só falta a que ele não tinha");
});

test("um desafio combina bibliotecas: vínculo guardado à parte, escolha por item, e a biblioteca não some quando os itens saem", async () => {
  const owner = await register("Iara", "iara_combina");
  const gid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Maratona" } })).body as { id: string }).id;
  const make = async (label: string) => (await call("POST", `/api/groups/${gid}/catalog/libraries`, { session: owner, body: { label } })).body as { id: string; kind: string };
  const movies = await make("Filmes");
  const shows = await make("Séries");
  const podcasts = await make("Podcasts");

  const created = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner,
    body: {
      recipe: "custom", title: "Tudo junto", participantIds: [owner.user.id],
      libraries: [{ libraryId: movies.id }, { libraryId: shows.id }],
      items: [{ title: "Aftersun", libraryId: movies.id }, { title: "Severance", libraryId: shows.id }],
    },
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  const cid = (created.body as { id: string }).id;
  const detail = async () => (await call("GET", `/api/challenges/${cid}`, { session: owner })).body as {
    libraries: Array<{ id: string; kind: string; label: string | null }>; items: Array<{ id: string; title: string }>;
  };
  assert.deepEqual((await detail()).libraries.map((library) => library.label), ["Filmes", "Séries"], "as duas bibliotecas, na ordem em que foram vinculadas");
  const kinds = await adminPool.query<{ title: string; kind: string }>(
    `SELECT it.title, ci.kind FROM challenge_items it JOIN catalog_items ci ON ci.id = it.catalog_item_id WHERE it.challenge_id = $1 ORDER BY it.position`, [cid],
  );
  assert.deepEqual(kinds.rows.map((row) => [row.title, row.kind]), [["Aftersun", movies.kind], ["Severance", shows.kind]], "cada item veio da sua biblioteca");

  // com duas bibliotecas, é preciso dizer de qual; uma que o desafio não usa é recusada
  const ambiguous = await call("POST", `/api/challenges/${cid}/items`, { session: owner, body: { title: "Solaris" } });
  assert.equal(ambiguous.response.status, 400, JSON.stringify(ambiguous.body));
  assert.equal((ambiguous.body as { error: string }).error, "library_required");
  const foreign = await call("POST", `/api/challenges/${cid}/items`, { session: owner, body: { title: "Serial", libraryId: podcasts.id } });
  assert.equal(foreign.response.status, 400);
  assert.equal((foreign.body as { error: string }).error, "library_not_linked");
  const batch = await call("POST", `/api/challenges/${cid}/items`, {
    session: owner, body: { items: [{ title: "Solaris", libraryId: movies.id }, { title: "Andor", libraryId: shows.id }] },
  });
  assert.equal(batch.response.status, 201, JSON.stringify(batch.body));

  // vincular outra biblioteca é uma ação própria, e passa a valer
  const linked = await call("POST", `/api/challenges/${cid}/libraries`, { session: owner, body: { libraryId: podcasts.id } });
  assert.equal(linked.response.status, 201, JSON.stringify(linked.body));
  assert.equal((await detail()).libraries.length, 3);
  assert.equal((await call("POST", `/api/challenges/${cid}/items`, { session: owner, body: { title: "Serial", libraryId: podcasts.id } })).response.status, 201);
  // não vincula biblioteca de outro espaço
  const otherGid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Outro" } })).body as { id: string }).id;
  const stranger = (await call("POST", `/api/groups/${otherGid}/catalog/libraries`, { session: owner, body: { label: "Alheia" } })).body as { id: string };
  assert.equal((await call("POST", `/api/challenges/${cid}/libraries`, { session: owner, body: { libraryId: stranger.id } })).response.status, 400);

  // desvincular: recusado enquanto houver itens dela; liberado depois — e o vínculo não vem dos itens
  const inUse = await call("DELETE", `/api/challenges/${cid}/libraries/${podcasts.id}`, { session: owner });
  assert.equal(inUse.response.status, 409, JSON.stringify(inUse.body));
  assert.equal((inUse.body as { error: string }).error, "library_in_use");
  const serial = (await detail()).items.find((item) => item.title === "Serial")!;
  assert.equal((await call("DELETE", `/api/challenges/${cid}/items/${serial.id}`, { session: owner })).response.status, 200);
  const stillLinked = await detail();
  assert.ok(stillLinked.libraries.some((library) => library.id === podcasts.id), "tirar os itens não desvincula a biblioteca");
  assert.equal((await call("DELETE", `/api/challenges/${cid}/libraries/${podcasts.id}`, { session: owner })).response.status, 200);
  assert.equal((await detail()).libraries.length, 2);

  // a cópia leva as duas bibliotecas, cada item na sua
  const dst = ((await call("POST", "/api/groups", { session: owner, body: { name: "Cópia" } })).body as { id: string }).id;
  const copy = await call("POST", `/api/challenges/${cid}/duplicate`, { session: owner, body: { targetGroupId: dst, mode: "structure_and_items" } });
  assert.equal(copy.response.status, 201, JSON.stringify(copy.body));
  const copyDetail = (await call("GET", `/api/challenges/${(copy.body as { id: string }).id}`, { session: owner })).body as { libraries: Array<{ label: string | null }> };
  assert.deepEqual(copyDetail.libraries.map((library) => library.label), ["Filmes", "Séries"]);

  // um desafio anterior à tabela (sem vínculos guardados) continua funcionando e se conserta na primeira escrita
  await adminPool.query("DELETE FROM challenge_libraries WHERE challenge_id = $1", [cid]);
  assert.deepEqual((await detail()).libraries.map((library) => library.label), ["Filmes", "Séries"], "o que os itens implicam continua valendo na leitura");
  assert.equal((await call("POST", `/api/challenges/${cid}/items`, { session: owner, body: { title: "Perfect Days", libraryId: movies.id } })).response.status, 201);
  const healed = await adminPool.query("SELECT kind FROM challenge_libraries WHERE challenge_id = $1", [cid]);
  assert.equal(healed.rowCount, 2, "os vínculos foram gravados");

  // o desafio fechado não muda de bibliotecas
  assert.equal((await call("POST", `/api/challenges/${cid}/transition`, { session: owner, body: { status: "active" } })).response.status, 200);
  assert.equal((await call("POST", `/api/challenges/${cid}/transition`, { session: owner, body: { status: "closed" } })).response.status, 200);
  assert.equal((await call("POST", `/api/challenges/${cid}/libraries`, { session: owner, body: { libraryId: podcasts.id } })).response.status, 409);
});

test("a migração 0049 liga desafios antigos às bibliotecas dos seus itens e da sua receita", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const file = readdirSync(new URL("../../drizzle/", import.meta.url)).find((name) => name.startsWith("0049_"))!;
  const backfill = readFileSync(new URL(`../../drizzle/${file}`, import.meta.url), "utf8")
    .split("--> statement-breakpoint").map((part) => part.trim()).filter((part) => /(^|\n)INSERT INTO "challenge_libraries"/.test(part));
  assert.equal(backfill.length, 2, "os dois preenchimentos estão na migração");

  const owner = await register("Jana", "jana_migra");
  const gid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Antigo" } })).body as { id: string }).id;
  const cinema = await call("POST", `/api/groups/${gid}/challenges`, { session: owner, body: { recipe: "cinema", title: "Filmes", participantIds: [owner.user.id], items: [{ title: "Aftersun" }] } });
  const books = await call("POST", `/api/groups/${gid}/challenges`, { session: owner, body: { recipe: "bookshelf", title: "Livros", participantIds: [owner.user.id], items: [{ title: "Ficciones", author: "Borges" }] } });
  const cinemaId = (cinema.body as { id: string }).id;
  const booksId = (books.body as { id: string }).id;
  // estado de antes da tabela: nada guardado — numa transação que nunca é confirmada, para não mexer nos outros testes
  const client = await adminPool.connect();
  let rows: { rows: Array<{ challenge_id: string; kind: string }> };
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM challenge_libraries");
    for (const statement of backfill) await client.query(statement);
    rows = await client.query<{ challenge_id: string; kind: string }>(
      "SELECT challenge_id, kind FROM challenge_libraries WHERE challenge_id = ANY($1::text[]) ORDER BY challenge_id, kind", [[cinemaId, booksId]],
    );
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
  const byChallenge = new Map<string, string[]>();
  for (const row of rows.rows) byChallenge.set(row.challenge_id, [...(byChallenge.get(row.challenge_id) ?? []), row.kind]);
  assert.deepEqual(byChallenge.get(cinemaId), ["film"]);
  assert.deepEqual(byChallenge.get(booksId), ["book"]);
});

test("esconder o autor na biblioteca de livros tira a exigência do autor nos itens do desafio", async () => {
  const owner = await register("Kaio", "kaio_autor");
  const gid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Leitores" } })).body as { id: string }).id;
  const first = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner, body: { recipe: "bookshelf", title: "Livros", participantIds: [owner.user.id], items: [{ title: "Ficciones", author: "Borges" }] },
  });
  assert.equal(first.response.status, 201, JSON.stringify(first.body));
  const cid = (first.body as { id: string }).id;
  const pages = (await adminPool.query<{ id: string }>("SELECT id FROM catalog_libraries WHERE group_id = $1 AND kind = 'book'", [gid])).rows[0].id;

  const needsAuthor = await call("POST", `/api/challenges/${cid}/items`, { session: owner, body: { title: "Sem autor" } });
  assert.equal(needsAuthor.response.status, 400, "com o autor visível, ele continua obrigatório");
  assert.equal((await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner, body: { recipe: "bookshelf", title: "Outra", participantIds: [owner.user.id], items: [{ title: "Sem autor" }] },
  })).response.status, 400);

  assert.equal((await call("PATCH", `/api/catalog/libraries/${pages}/properties/author`, { session: owner, body: { hidden: true } })).response.status, 200);
  const hidden = await call("POST", `/api/challenges/${cid}/items`, { session: owner, body: { title: "Sem autor" } });
  assert.equal(hidden.response.status, 201, JSON.stringify(hidden.body));
  const other = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner, body: { recipe: "bookshelf", title: "Outra", participantIds: [owner.user.id], items: [{ title: "Outro sem autor" }] },
  });
  assert.equal(other.response.status, 201, JSON.stringify(other.body));
});

test("qualquer receita aceita bibliotecas a mais na criação; Tables não se duplica; o item do desafio edita as propriedades da sua biblioteca", async () => {
  const owner = await register("Lia", "lia_extras");
  const gid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Sala" } })).body as { id: string }).id;
  const shows = (await call("POST", `/api/groups/${gid}/catalog/libraries`, { session: owner, body: { label: "Séries" } })).body as { id: string; kind: string };
  const network = (await call("POST", `/api/groups/${gid}/catalog-attributes`, { session: owner, body: { libraryId: shows.id, label: "Canal", type: "text" } })).body as { id: string; key: string };

  // Cinema + Séries na mesma lista: a biblioteca própria da receita (Screens) e mais uma
  const created = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner,
    body: {
      recipe: "cinema", title: "Telas", participantIds: [owner.user.id], libraries: [{ libraryId: shows.id }],
      items: [{ title: "Aftersun", libraryKind: "film" }, { title: "Severance", libraryId: shows.id, attributes: { [network.key]: "Apple TV+" } }],
    },
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  const cid = (created.body as { id: string }).id;
  const detail = (await call("GET", `/api/challenges/${cid}`, { session: owner })).body as {
    libraries: Array<{ kind: string; label: string | null }>;
    items: Array<{ id: string; title: string; catalogItem: { kind: string; attributes: Array<{ label: string; value: string }> } }>;
  };
  assert.deepEqual(detail.libraries.map((library) => library.kind), ["film", shows.kind]);
  const severance = detail.items.find((item) => item.title === "Severance")!;
  assert.equal(severance.catalogItem.kind, shows.kind);
  assert.deepEqual(severance.catalogItem.attributes.map((a) => [a.label, a.value]), [["Canal", "Apple TV+"]]);

  // o item do desafio edita as propriedades da biblioteca dele (nativas e personalizadas)
  const edited = await call("PATCH", `/api/challenges/${cid}/items/${severance.id}`, { session: owner, body: { attributes: { [network.key]: "Apple TV" } } });
  assert.equal(edited.response.status, 200, JSON.stringify(edited.body));
  const again = (await call("GET", `/api/challenges/${cid}`, { session: owner })).body as { items: Array<{ title: string; catalogItem: { attributes: Array<{ value: string }> } }> };
  assert.equal(again.items.find((item) => item.title === "Severance")?.catalogItem.attributes[0].value, "Apple TV");

  // um item sem biblioteca, com duas ligadas: precisa escolher
  const ambiguous = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner, body: { recipe: "cinema", title: "Sem escolha", participantIds: [owner.user.id], libraries: [{ libraryId: shows.id }], items: [{ title: "Sem biblioteca" }] },
  });
  assert.equal(ambiguous.response.status, 400, JSON.stringify(ambiguous.body));
  assert.equal((ambiguous.body as { error: string }).error, "library_required");

  // Tables + uma biblioteca a mais: a Tables da receita é ligada uma vez só — e precisa existir antes
  const noTables = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner,
    body: { recipe: "tables", title: "Comer e ver", participantIds: [owner.user.id], libraries: [{ libraryId: shows.id }], items: [{ title: "Serial", libraryId: shows.id }] },
  });
  assert.equal(noTables.response.status, 409, "sem a biblioteca Tables não há rodada Tables");
  assert.equal((noTables.body as { error: string }).error, "library_missing");
  const tablesLib = (await call("POST", `/api/groups/${gid}/catalog/libraries`, { session: owner, body: { source: "tables" } }));
  assert.equal(tablesLib.response.status, 201, JSON.stringify(tablesLib.body));
  assert.equal((tablesLib.body as { label: string | null }).label, null, "Tables sem nome guardado mostra o nome padrão");
  const tables = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner,
    body: { recipe: "tables", title: "Comer e ver", participantIds: [owner.user.id], libraries: [{ libraryId: shows.id }], items: [{ title: "Sem biblioteca" }] },
  });
  assert.equal(tables.response.status, 400, "com duas bibliotecas, o item de Tables também precisa dizer de onde vem");
  assert.equal((tables.body as { error: string }).error, "library_required");
  const withTables = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner,
    body: {
      recipe: "tables", title: "Comer e ver", participantIds: [owner.user.id], libraries: [{ libraryId: shows.id }],
      items: [{ title: "Cantina", libraryId: (tablesLib.body as { id: string }).id }, { title: "Serial", libraryId: shows.id }],
    },
  });
  assert.equal(withTables.response.status, 201, JSON.stringify(withTables.body));
  const twoLibs = (await call("GET", `/api/challenges/${(withTables.body as { id: string }).id}`, { session: owner })).body as { libraries: Array<{ source: string }> };
  assert.deepEqual(twoLibs.libraries.map((library) => library.source).sort(), ["custom", "tables"], "uma Tables e a outra — sem Tables duplicada");

  // o modelo público não expõe valores de propriedades personalizadas
  await adminPool.query("UPDATE users SET platform_admin = true WHERE id = $1", [owner.user.id]);
  const platform = await login("lia_extras");
  assert.equal((await call("POST", `/api/challenges/${cid}/template`, { session: platform, body: {} })).response.status, 200);
  const preview = await call("GET", `/api/templates/${cid}`);
  assert.equal(JSON.stringify(preview.body).includes("Apple TV"), false, "valores personalizados não vazam no modelo público");
});

test("desafio personalizado: sem \"quando aconteceu\" por padrão, com opção para ligar, e a cópia leva a escolha", async () => {
  const owner = await register("Nina", "nina_data");
  const gid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Copa" } })).body as { id: string }).id;
  const matches = (await call("POST", `/api/groups/${gid}/catalog/libraries`, { session: owner, body: { label: "Jogos" } })).body as { id: string };
  const detail = async (id: string) =>
    (await call("GET", `/api/challenges/${id}`, { session: owner })).body as { collectsEntryDate: boolean };

  const created = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner,
    body: { recipe: "custom", title: "Palpites", libraryId: matches.id, participantIds: [owner.user.id], items: [{ title: "Brasil x Argentina" }] },
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  const cid = (created.body as { id: string }).id;
  assert.equal((await detail(cid)).collectsEntryDate, false, "um desafio personalizado não pergunta a data do registro");

  const cinema = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner, body: { recipe: "cinema", title: "Filmes", participantIds: [owner.user.id], items: [{ title: "Aftersun" }] },
  });
  assert.equal((await detail((cinema.body as { id: string }).id)).collectsEntryDate, true, "o Cinema continua perguntando");

  const enabled = await call("PATCH", `/api/challenges/${cid}`, { session: owner, body: { collectsEntryDate: true } });
  assert.equal(enabled.response.status, 200, JSON.stringify(enabled.body));
  assert.equal((enabled.body as { collectsEntryDate: boolean }).collectsEntryDate, true);
  assert.equal((await detail(cid)).collectsEntryDate, true);

  const dst = ((await call("POST", "/api/groups", { session: owner, body: { name: "Outro bolão" } })).body as { id: string }).id;
  const copy = await call("POST", `/api/challenges/${cid}/duplicate`, { session: owner, body: { targetGroupId: dst, mode: "structure" } });
  assert.equal((await detail((copy.body as { id: string }).id)).collectsEntryDate, true, "a cópia herda a escolha");

  const back = await call("PATCH", `/api/challenges/${cid}`, { session: owner, body: { collectsEntryDate: null } });
  assert.equal((back.body as { collectsEntryDate: boolean }).collectsEntryDate, false, "null devolve a decisão ao padrão do tipo de desafio");
  assert.equal((await call("PATCH", `/api/challenges/${cid}`, { session: owner, body: { collectsEntryDate: "sim" } })).response.status, 400);

  // ao criar já dá para escolher, e o servidor continua guardando o horário do registro por conta própria
  const asked = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner,
    body: { recipe: "custom", title: "Com data", libraryId: matches.id, collectsEntryDate: true, participantIds: [owner.user.id], items: [{ title: "Chile x Peru" }] },
  });
  assert.equal((await detail((asked.body as { id: string }).id)).collectsEntryDate, true);
  const askedId = (asked.body as { id: string }).id;
  const itemId = ((await call("GET", `/api/challenges/${askedId}`, { session: owner })).body as { items: Array<{ id: string }> }).items[0].id;
  await call("POST", `/api/challenges/${askedId}/transition`, { session: owner, body: { status: "active" } });
  const noDate = await call("POST", `/api/challenges/${askedId}/entries`, { session: owner, body: { itemId, values: { nota: 4, comentario: "" } } });
  assert.equal(noDate.response.status, 201, JSON.stringify(noDate.body));
  const stored = await adminPool.query<{ created_at: Date; occurred_on: string | null }>("SELECT created_at, occurred_on::text FROM entries WHERE id = $1", [(noDate.body as { id: string }).id]);
  assert.ok(stored.rows[0].created_at, "o horário do salvamento fica registrado");
});

test("o registro principal de um desafio personalizado nasce compartilhado quando o grupo escolhe preencher uma vez só", async () => {
  const owner = await register("Otto", "otto_uma_vez");
  const friend = await register("Pia", "pia_uma_vez");
  const gid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Copa" } })).body as { id: string }).id;
  const invite = await call("POST", `/api/groups/${gid}/invites`, { session: owner, body: { expiresInDays: 7, maxUses: 1 } });
  await call("POST", `/api/invites/${(invite.body as { token: string }).token}`, { session: friend, body: {} });
  const matches = (await call("POST", `/api/groups/${gid}/catalog/libraries`, { session: owner, body: { label: "Jogos" } })).body as { id: string };

  const create = (extra: Record<string, unknown>, recipe = "custom") => call("POST", `/api/groups/${gid}/challenges`, {
    session: owner,
    body: {
      recipe, title: "Resultados", libraryId: matches.id, participantIds: [owner.user.id, friend.user.id],
      fields: [{ key: "placar", label: "Placar final", type: "text", required: true }],
      items: [{ title: "Brasil x Argentina" }], ...extra,
    },
  });
  const created = await create({ answerScope: "shared", sharedEditPolicy: "members_can_edit" });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  const cid = (created.body as { id: string }).id;
  const detail = (await call("GET", `/api/challenges/${cid}`, { session: owner })).body as {
    entryTypes: Array<{ id: string; name: string; answerScope: string; sharedEditPolicy: string | null; isPrimary: boolean; fields: Array<{ key: string }> }>;
    items: Array<{ id: string }>;
  };
  const primary = detail.entryTypes.find((type) => type.isPrimary)!;
  assert.equal(primary.answerScope, "shared");
  assert.equal(primary.sharedEditPolicy, "members_can_edit");
  assert.deepEqual(primary.fields.map((field) => field.key), ["placar"]);
  assert.equal(primary.name, "Placar final", "a resposta compartilhada tem um nome só: o do seu valor");
  assert.equal(detail.entryTypes.length, 1, "só o registro escolhido — nada de tipo individual sobrando");

  await call("POST", `/api/challenges/${cid}/transition`, { session: owner, body: { status: "active" } });
  const first = await call("POST", `/api/challenges/${cid}/entries`, { session: friend, body: { entryTypeId: primary.id, itemId: detail.items[0].id, values: { placar: "2 x 1" } } });
  assert.equal(first.response.status, 201, JSON.stringify(first.body));
  assert.equal((first.body as { answerScope: string }).answerScope, "shared");
  const blind = await call("POST", `/api/challenges/${cid}/entries`, { session: owner, body: { entryTypeId: primary.id, itemId: detail.items[0].id, values: { placar: "3 x 1" }, expectedUpdatedAt: null } });
  assert.equal(blind.response.status, 409, "quem não viu o valor atual recebe o conflito, como em qualquer resposta compartilhada");
  const seen = (blind.body as { details: { currentUpdatedAt: string } }).details.currentUpdatedAt;
  const second = await call("POST", `/api/challenges/${cid}/entries`, { session: owner, body: { entryTypeId: primary.id, itemId: detail.items[0].id, values: { placar: "3 x 1" }, expectedUpdatedAt: seen } });
  assert.ok([200, 201].includes(second.response.status), JSON.stringify(second.body));
  const rows = await adminPool.query("SELECT 1 FROM entries WHERE challenge_id = $1 AND deleted_at IS NULL", [cid]);
  assert.equal(rows.rowCount, 1, "um único registro para o item, não um por participante");

  // por padrão continua individual, e só o desafio personalizado pode ser compartilhado
  const individual = await create({});
  const individualDetail = (await call("GET", `/api/challenges/${(individual.body as { id: string }).id}`, { session: owner })).body as { entryTypes: Array<{ answerScope: string }> };
  assert.equal(individualDetail.entryTypes[0].answerScope, "individual");
  const notCustom = await create({ answerScope: "shared" }, "cinema");
  assert.equal(notCustom.response.status, 400, JSON.stringify(notCustom.body));
  assert.equal((notCustom.body as { error: string }).error, "shared_custom_only");
  assert.equal((await create({ answerScope: "everyone" })).response.status, 400);
  assert.equal((await create({ answerScope: "shared", sharedEditPolicy: "anyone" })).response.status, 400);
});

test("data e hora do evento é propriedade do item do acervo: desligada por padrão, lida por todo desafio que usa o item, copiada junto", async () => {
  const owner = await register("Quiteria", "quiteria_evento");
  const gid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Copa" } })).body as { id: string }).id;
  const matches = (await call("POST", `/api/groups/${gid}/catalog/libraries`, { session: owner, body: { label: "Jogos" } })).body as { id: string; kind: string };
  const props = async () => (await call("GET", `/api/catalog/libraries/${matches.id}/properties`, { session: owner })).body as { properties: Array<{ key: string; type: string; hidden: boolean }> };
  const schedule = (await props()).properties.find((property) => property.key === "scheduled_at")!;
  assert.equal(schedule.type, "schedule");
  assert.equal(schedule.hidden, true, "a maioria das bibliotecas não tem data própria");

  const kickoff = "2026-06-15T19:00:00.000Z";
  const created = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner,
    body: {
      recipe: "custom", title: "Copa", libraryId: matches.id, participantIds: [owner.user.id],
      items: [
        { title: "Brasil x Argentina", scheduledAt: { startsAt: kickoff, endsAt: "2026-06-15T21:00:00.000Z", timeZone: "America/Sao_Paulo" } },
        { title: "França x Alemanha", scheduledAt: { startsOn: "2026-06-20", timeZone: "America/Sao_Paulo" } },
        { title: "Sem data" },
      ],
    },
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  const cid = (created.body as { id: string }).id;
  type ScheduledItem = { id: string; title: string; opensAt: string | null; catalogItem: { id: string; scheduledAt: { startsAt: string; endsAt: string | null; precision: string; timeZone: string } | null } };
  const items = async () => ((await call("GET", `/api/challenges/${cid}`, { session: owner })).body as { items: ScheduledItem[] }).items;
  assert.equal((await items())[0].catalogItem.scheduledAt, null, "desligada: os dados ficam guardados, mas não aparecem");

  assert.equal((await call("PATCH", `/api/catalog/libraries/${matches.id}/properties/scheduled_at`, { session: owner, body: { hidden: false } })).response.status, 200);
  const [brasil, franca, sem] = await items();
  assert.deepEqual(brasil.catalogItem.scheduledAt, { startsAt: kickoff, endsAt: "2026-06-15T21:00:00.000Z", precision: "datetime", timeZone: "America/Sao_Paulo" });
  assert.equal(franca.catalogItem.scheduledAt?.precision, "date");
  assert.equal(franca.catalogItem.scheduledAt?.startsAt, "2026-06-20T03:00:00.000Z", "só a data: meia-noite no fuso informado");
  assert.equal(sem.catalogItem.scheduledAt, null);
  assert.equal(brasil.opensAt, null, "o horário do jogo não é uma janela de resposta");

  // o acervo sozinho já conhece a data
  const catalog = (await call("GET", `/api/groups/${gid}/catalog`, { session: owner })).body as { items: Array<{ title: string; scheduledAt: { startsAt: string } | null }> };
  assert.equal(catalog.items.find((item) => item.title === "Brasil x Argentina")?.scheduledAt?.startsAt, kickoff);
  const detail = (await call("GET", `/api/groups/${gid}/catalog/${brasil.catalogItem.id}`, { session: owner })).body as { scheduledAt: { startsAt: string } | null };
  assert.equal(detail.scheduledAt?.startsAt, kickoff);

  // editar pelo item do desafio muda o item do acervo — um único horário, sem segunda cópia para divergir
  const moved = "2026-06-15T22:30:00.000Z";
  const patched = await call("PATCH", `/api/challenges/${cid}/items/${brasil.id}`, { session: owner, body: { scheduledAt: { startsAt: moved, timeZone: "America/Sao_Paulo" } } });
  assert.equal(patched.response.status, 200, JSON.stringify(patched.body));
  const afterMove = (await items())[0].catalogItem.scheduledAt;
  assert.equal(afterMove?.startsAt, moved);
  assert.equal(afterMove?.endsAt, null, "o fim opcional some quando não é informado de novo");
  const catalogAfter = (await call("GET", `/api/groups/${gid}/catalog`, { session: owner })).body as { items: Array<{ title: string; scheduledAt: { startsAt: string } | null }> };
  assert.equal(catalogAfter.items.find((item) => item.title === "Brasil x Argentina")?.scheduledAt?.startsAt, moved);

  for (const bad of [
    { startsAt: kickoff, timeZone: "Mars/Olympus" },
    { startsAt: "amanhã", timeZone: "UTC" },
    { startsAt: kickoff, endsAt: "2026-06-15T18:00:00.000Z", timeZone: "UTC" },
    { startsOn: "2026-06-15", startsAt: kickoff },
    { endsOn: "2026-06-15" },
  ]) {
    const rejected = await call("PATCH", `/api/challenges/${cid}/items/${brasil.id}`, { session: owner, body: { scheduledAt: bad } });
    assert.equal(rejected.response.status, 400, JSON.stringify(bad));
  }
  assert.equal(((await call("PATCH", `/api/challenges/${cid}/items/${brasil.id}`, { session: owner, body: { scheduledAt: { startsAt: kickoff, timeZone: "Mars/Olympus" } } })).body as { error: string }).error, "invalid_timezone");
  const cleared = await call("PATCH", `/api/challenges/${cid}/items/${sem.id}`, { session: owner, body: { scheduledAt: null } });
  assert.equal(cleared.response.status, 200);

  // duplicar leva a data do evento — e liga a propriedade na cópia, senão ela ficaria guardada mas invisível
  const dst = ((await call("POST", "/api/groups", { session: owner, body: { name: "Outro bolão" } })).body as { id: string }).id;
  const copy = await call("POST", `/api/challenges/${cid}/duplicate`, { session: owner, body: { targetGroupId: dst, mode: "structure_and_items" } });
  assert.equal(copy.response.status, 201, JSON.stringify(copy.body));
  const copied = ((await call("GET", `/api/challenges/${(copy.body as { id: string }).id}`, { session: owner })).body as { items: ScheduledItem[] }).items;
  assert.equal(copied.find((item) => item.title === "Brasil x Argentina")?.catalogItem.scheduledAt?.startsAt, moved);
  assert.equal(copied.find((item) => item.title === "França x Alemanha")?.catalogItem.scheduledAt?.precision, "date");

  // desligar de novo esconde sem apagar: a mesma propriedade, o mesmo caminho de sempre
  await call("PATCH", `/api/catalog/libraries/${matches.id}/properties/scheduled_at`, { session: owner, body: { hidden: true } });
  assert.equal((await items())[0].catalogItem.scheduledAt, null);
  const configRows = await adminPool.query("SELECT 1 FROM catalog_native_property_configs WHERE library_id = $1 AND property_key = 'scheduled_at'", [matches.id]);
  assert.equal(configRows.rowCount, 0, "voltar ao padrão (desligada) não deixa configuração para trás");
});

test("\"as respostas abrem em\" bloqueia de verdade no servidor; \"responder até\" é só um lembrete", async () => {
  const owner = await register("Rita", "rita_janela");
  const gid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Copa" } })).body as { id: string }).id;
  const created = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner, body: { recipe: "cinema", title: "Filmes", participantIds: [owner.user.id], items: [{ title: "Aftersun" }, { title: "Cidade de Deus" }] },
  });
  const cid = (created.body as { id: string }).id;
  const items = ((await call("GET", `/api/challenges/${cid}`, { session: owner })).body as { items: Array<{ id: string }> }).items;
  await call("POST", `/api/challenges/${cid}/transition`, { session: owner, body: { status: "active" } });
  const future = new Date(Date.now() + 86_400_000).toISOString();
  await call("PATCH", `/api/challenges/${cid}/items/${items[0].id}`, { session: owner, body: { opensAt: future } });
  await call("PATCH", `/api/challenges/${cid}/items/${items[1].id}`, { session: owner, body: { dueAt: new Date(Date.now() - 86_400_000).toISOString() } });

  const notYet = await call("POST", `/api/challenges/${cid}/entries`, { session: owner, body: { itemId: items[0].id, values: { nota: 4, comentario: "" } } });
  assert.equal(notYet.response.status, 409, JSON.stringify(notYet.body));
  assert.equal((notYet.body as { error: string }).error, "item_not_open");
  const late = await call("POST", `/api/challenges/${cid}/entries`, { session: owner, body: { itemId: items[1].id, values: { nota: 4, comentario: "" } } });
  assert.equal(late.response.status, 201, "o prazo passado nunca bloqueia");
});

test("copiar para um destino com a mesma propriedade de outro tipo (ou arquivada) não reinterpreta valores: pula, avisa e preserva", async () => {
  const owner = await register("Sonia", "sonia_conflito");
  const srcGid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Origem" } })).body as { id: string }).id;
  const dstGid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Destino" } })).body as { id: string }).id;
  const matches = (await call("POST", `/api/groups/${srcGid}/catalog/libraries`, { session: owner, body: { label: "Jogos" } })).body as { id: string; kind: string };
  const attr = async (label: string, type: string) =>
    (await call("POST", `/api/groups/${srcGid}/catalog-attributes`, { session: owner, body: { libraryId: matches.id, label, type } })).body as { id: string; key: string };
  const stage = await attr("Fase", "text");
  const venue = await attr("Estádio", "text");
  const round = await attr("Rodada", "number");
  const created = await call("POST", `/api/groups/${srcGid}/challenges`, {
    session: owner,
    body: {
      recipe: "custom", title: "Copa", libraryId: matches.id, participantIds: [owner.user.id],
      items: [{ title: "Brasil x Argentina", attributes: { [stage.key]: "Grupos", [venue.key]: "Maracanã", [round.key]: 3 } }],
    },
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  const cid = (created.body as { id: string }).id;

  // o destino já tem a mesma chave: "Fase" como número, e "Estádio" arquivada
  await adminPool.query(
    "INSERT INTO catalog_libraries (id, group_id, kind, source, label, position, created_by_user_id) VALUES ('lib-conflito', $1, $2, 'custom', 'Partidas', 0, $3)",
    [dstGid, matches.kind, owner.user.id],
  );
  await adminPool.query(
    `INSERT INTO catalog_attribute_defs (id, group_id, kind, semantic_key, label, type, position, created_by_user_id)
     VALUES ('def-fase-numero', $1, $2, $3, 'Fase', 'number', 0, $4)`, [dstGid, matches.kind, stage.key, owner.user.id],
  );
  await adminPool.query(
    `INSERT INTO catalog_attribute_defs (id, group_id, kind, semantic_key, label, type, position, archived_at, created_by_user_id)
     VALUES ('def-estadio-arquivado', $1, $2, $3, 'Estádio', 'text', 1, now(), $4)`, [dstGid, matches.kind, venue.key, owner.user.id],
  );

  const copy = await call("POST", `/api/challenges/${cid}/duplicate`, { session: owner, body: { targetGroupId: dstGid, mode: "structure_and_items" } });
  assert.equal(copy.response.status, 201, `a cópia não é rejeitada por causa do conflito: ${JSON.stringify(copy.body)}`);
  const skipped = (copy.body as { skippedProperties: Array<{ key: string; label: string; type: string; reason: string; existingType: string | null; library: { label: string | null } }> }).skippedProperties;
  assert.deepEqual(
    skipped.map((property) => [property.key, property.reason, property.type, property.existingType]).sort(),
    [[stage.key, "type_mismatch", "text", "number"], [venue.key, "archived", "text", null]].sort(),
  );
  assert.equal(skipped[0].library.label, "Jogos");

  // a definição do destino continua intacta e nenhum valor foi enfiado nela
  const stageDef = (await adminPool.query<{ type: string; label: string }>("SELECT type, label FROM catalog_attribute_defs WHERE id = 'def-fase-numero'")).rows[0];
  assert.deepEqual(stageDef, { type: "number", label: "Fase" });
  const values = await adminPool.query<{ key: string; number_value: number | null; text_value: string | null }>(
    `SELECT d.semantic_key AS key, v.number_value, v.text_value
       FROM catalog_attribute_values v
       JOIN catalog_attribute_defs d ON d.id = v.attribute_def_id
       JOIN catalog_items ci ON ci.id = v.catalog_item_id
      WHERE ci.group_id = $1`, [dstGid]);
  assert.deepEqual(values.rows.map((row) => row.key), [round.key], "só a propriedade sem conflito levou o valor");
  assert.equal(values.rows[0].number_value, 3);

  // duplicar dentro da mesma origem, sem conflito, não avisa de nada
  const dst2 = ((await call("POST", "/api/groups", { session: owner, body: { name: "Limpo" } })).body as { id: string }).id;
  const clean = await call("POST", `/api/challenges/${cid}/duplicate`, { session: owner, body: { targetGroupId: dst2, mode: "structure_and_items" } });
  assert.deepEqual((clean.body as { skippedProperties: unknown[] }).skippedProperties, []);
});

test("criar o desafio com \"cada item tem data e hora\" liga a propriedade nas bibliotecas dele, inclusive nas embutidas ainda sem linha", async () => {
  const owner = await register("Tiago", "tiago_datas");
  const gid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Copa" } })).body as { id: string }).id;
  const matches = (await call("POST", `/api/groups/${gid}/catalog/libraries`, { session: owner, body: { label: "Jogos" } })).body as { id: string; kind: string };
  const scheduleOf = async (libraryId: string) =>
    ((await call("GET", `/api/catalog/libraries/${libraryId}/properties`, { session: owner })).body as { properties: Array<{ key: string; hidden: boolean }> })
      .properties.find((property) => property.key === "scheduled_at")!;
  assert.equal((await scheduleOf(matches.id)).hidden, true);

  const kickoff = "2026-06-15T19:00:00.000Z";
  const created = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner,
    body: {
      recipe: "custom", title: "Copa", libraryId: matches.id, itemDates: true, participantIds: [owner.user.id],
      items: [{ title: "Brasil x Argentina", scheduledAt: { startsAt: kickoff, timeZone: "America/Sao_Paulo" } }],
    },
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  assert.equal((await scheduleOf(matches.id)).hidden, false, "o desafio ligou a data do evento na biblioteca");
  const detail = (await call("GET", `/api/challenges/${(created.body as { id: string }).id}`, { session: owner })).body as {
    items: Array<{ catalogItem: { scheduledAt: { startsAt: string } | null } }>;
  };
  assert.equal(detail.items[0].catalogItem.scheduledAt?.startsAt, kickoff);

  // uma biblioteca embutida que ainda nem tinha linha ganha a linha e a propriedade ligada
  const cinema = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner,
    body: {
      recipe: "cinema", title: "Sessões", itemDates: true, participantIds: [owner.user.id],
      items: [{ title: "Aftersun", scheduledAt: { startsOn: "2026-07-01", timeZone: "America/Sao_Paulo" } }],
    },
  });
  assert.equal(cinema.response.status, 201, JSON.stringify(cinema.body));
  const film = (await call("GET", `/api/groups/${gid}/catalog/libraries`, { session: owner })).body as { libraries: Array<{ id: string; kind: string }> };
  assert.equal((await scheduleOf(film.libraries.find((library) => library.kind === "film")!.id)).hidden, false);

  // sem a opção, nada muda numa biblioteca que já existe
  const plain = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner, body: { recipe: "bookshelf", title: "Livros", participantIds: [owner.user.id], items: [{ title: "Dom Casmurro", author: "Machado de Assis" }] },
  });
  assert.equal(plain.response.status, 201, JSON.stringify(plain.body));
  const book = (await call("GET", `/api/groups/${gid}/catalog/libraries`, { session: owner })).body as { libraries: Array<{ id: string; kind: string }> };
  assert.equal((await scheduleOf(book.libraries.find((library) => library.kind === "book")!.id)).hidden, true);
});

test("remover um tipo de resposta que já tem respostas: avisa quantas, e só com a confirmação apaga as respostas junto", async () => {
  const owner = await register("Tais", "tais_apaga");
  const gid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Copa" } })).body as { id: string }).id;
  const created = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner, body: { recipe: "cinema", title: "Copa", participantIds: [owner.user.id], items: [{ title: "A" }, { title: "B" }] },
  });
  const cid = (created.body as { id: string }).id;
  const items = ((await call("GET", `/api/challenges/${cid}`, { session: owner })).body as { items: Array<{ id: string }> }).items;
  await call("POST", `/api/challenges/${cid}/transition`, { session: owner, body: { status: "active" } });
  const shared = await call("POST", `/api/challenges/${cid}/entry-types`, {
    session: owner, body: { name: "Placar", sharedEditPolicy: "members_can_edit", field: { key: "placar", label: "Placar", type: "number", required: true } },
  });
  const typeId = (shared.body as { id: string }).id;
  for (const item of items) {
    const saved = await call("POST", `/api/challenges/${cid}/entries`, { session: owner, body: { entryTypeId: typeId, itemId: item.id, values: { placar: 2 } } });
    assert.equal(saved.response.status, 201, JSON.stringify(saved.body));
  }

  const refused = await call("DELETE", `/api/challenges/${cid}/entry-types/${typeId}`, { session: owner });
  assert.equal(refused.response.status, 409);
  assert.equal((refused.body as { error: string }).error, "entry_type_has_entries");
  assert.equal((refused.body as { details: { count: number } }).details.count, 2, "diz quantas respostas iriam junto");
  const still = await adminPool.query("SELECT 1 FROM entries WHERE entry_type_id = $1 AND deleted_at IS NULL", [typeId]);
  assert.equal(still.rowCount, 2, "sem confirmar, nada é apagado");

  const removed = await call("DELETE", `/api/challenges/${cid}/entry-types/${typeId}?deleteAnswers=1`, { session: owner });
  assert.equal(removed.response.status, 200, JSON.stringify(removed.body));
  assert.equal((removed.body as { answersDeleted: number }).answersDeleted, 2);
  const gone = await adminPool.query("SELECT 1 FROM entries WHERE entry_type_id = $1 AND deleted_at IS NULL", [typeId]);
  assert.equal(gone.rowCount, 0, "as respostas foram apagadas com o tipo");
  const detail = (await call("GET", `/api/challenges/${cid}`, { session: owner })).body as { entryTypes: Array<{ id: string }> };
  assert.equal(detail.entryTypes.some((type) => type.id === typeId), false);
});

test("a migração 0051 tira dos Screens os livros que uma versão antiga guardou como filme — e deixa em paz o que é ambíguo", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const file = readdirSync(new URL("../../drizzle/", import.meta.url)).find((name) => name.startsWith("0051_"))!;
  const statements = readFileSync(new URL(`../../drizzle/${file}`, import.meta.url), "utf8")
    .split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean);

  const owner = await register("Nilo", "nilo_livros");
  const gid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Estante velha" } })).body as { id: string }).id;
  const make = async (recipe: string, title: string, items: Array<Record<string, unknown>>) => {
    const created = await call("POST", `/api/groups/${gid}/challenges`, { session: owner, body: { recipe, title, participantIds: [owner.user.id], items } });
    assert.equal(created.response.status, 201, JSON.stringify(created.body));
    return (created.body as { id: string }).id;
  };
  const shelf = await make("bookshelf", "Estante", [{ title: "Ficciones", author: "Borges" }, { title: "Perfume", author: "Süskind" }, { title: "Repetido", author: "Autor" }]);
  const club = await make("library", "Clube", [{ title: "Dom Casmurro", author: "Machado" }]);
  const cinema = await make("cinema", "Filmes", [{ title: "Aftersun" }]);
  const both = await make("bookshelf", "Outra estante", [{ title: "Solaris", author: "Lem" }]);

  // o estado de antes: livros guardados como filme, com o vínculo de Screens ao lado do de Pages
  const ids = new Map<string, string>();
  for (const title of ["Ficciones", "Perfume", "Dom Casmurro", "Repetido", "Solaris"]) {
    ids.set(title, (await adminPool.query<{ id: string }>("SELECT id FROM catalog_items WHERE group_id = $1 AND title = $2", [gid, title])).rows[0].id);
  }
  const item = (title: string) => ids.get(title)!;
  // (o pool do teste é pequeno: nada de consultar por fora enquanto a transação segura a conexão)
  const client = await adminPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO catalog_libraries (id, group_id, kind, source, created_by_user_id) VALUES (gen_random_uuid()::text, $1, 'film', 'screens', $2) ON CONFLICT DO NOTHING", [gid, owner.user.id]);
    for (const title of ["Ficciones", "Perfume", "Dom Casmurro", "Repetido", "Solaris"]) {
      await client.query("UPDATE catalog_items SET kind = 'film' WHERE id = $1", [item(title)]);
    }
    await client.query("INSERT INTO challenge_libraries (challenge_id, group_id, kind, position) SELECT $1, $2, 'film', 1 ON CONFLICT DO NOTHING", [shelf, gid]);
    // já existe um livro com o mesmo título e autor: mexer no filme colidiria com ele
    await client.query(
      `INSERT INTO catalog_items (id, group_id, kind, title, normalized_title, author, created_by_user_id)
       VALUES (gen_random_uuid()::text, $1, 'book', 'Repetido', 'repetido', 'Autor', $2)`, [gid, owner.user.id],
    );
    // "Solaris" também é usado por um desafio de cinema: ambíguo
    await client.query("INSERT INTO challenge_items (id, challenge_id, catalog_item_id, semantic_key, title, position, metadata) VALUES (gen_random_uuid()::text, $1, $2, 'solaris_filme', 'Solaris', 5, '{}'::jsonb)", [cinema, item("Solaris")]);
    await client.query("DELETE FROM challenge_libraries WHERE challenge_id = $1 AND kind = 'book'", [both]);
    await client.query("INSERT INTO challenge_libraries (challenge_id, group_id, kind, position) VALUES ($1, $2, 'film', 0) ON CONFLICT DO NOTHING", [both, gid]);

    for (const statement of statements) await client.query(statement);

    const kinds = new Map((await client.query<{ title: string; kind: string }>("SELECT title, kind FROM catalog_items WHERE group_id = $1 AND archived_at IS NULL AND title <> 'Repetido' OR (title = 'Repetido' AND kind = 'film' AND group_id = $1)", [gid])).rows.map((row) => [row.title, row.kind]));
    assert.equal(kinds.get("Ficciones"), "book");
    assert.equal(kinds.get("Perfume"), "book");
    assert.equal(kinds.get("Dom Casmurro"), "book");
    assert.equal(kinds.get("Repetido"), "film", "o que colidiria com um livro que já existe fica como está");
    assert.equal(kinds.get("Solaris"), "film", "o que também é usado por um desafio de cinema fica como está");
    assert.equal(kinds.get("Aftersun"), "film", "filmes de verdade não mudam");

    const links = async (id: string) => (await client.query<{ kind: string }>("SELECT kind FROM challenge_libraries WHERE challenge_id = $1 ORDER BY position", [id])).rows.map((row) => row.kind);
    // Repetido ainda é um filme nesta estante, então o vínculo com Screens continua fazendo sentido
    assert.deepEqual((await links(shelf)).sort(), ["book", "film"]);
    assert.deepEqual(await links(club), ["book"]);
    assert.deepEqual(await links(cinema), ["film"], "desafio de cinema não é tocado");
    assert.deepEqual(await links(both), ["film"], "sem livros movidos, o vínculo não muda");
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

test("o acervo diz em quantos desafios cada item está e remove em lote os que estão em nenhum — pulando o que um desafio em andamento ainda usa", async () => {
  const owner = await register("Tais", "tais_faxina");
  const member = await register("Beto", "beto_faxina");
  const gid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Faxina" } })).body as { id: string }).id;
  const inv = (await call("POST", `/api/groups/${gid}/invites`, { session: owner, body: { expiresInDays: 7, maxUses: 1 } })).body as { token: string };
  await call("POST", `/api/invites/${inv.token}`, { session: member, body: {} });

  const made = async (title: string) => ((await call("POST", `/api/groups/${gid}/catalog/items`, { session: owner, body: { kind: "other", title } })).body as { id: string }).id;
  const [orphanA, orphanB] = [await made("Sobrou A"), await made("Sobrou B")];
  const created = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner, body: { recipe: "cinema", title: "Ciclo", participantIds: [owner.user.id], items: [{ title: "Em uso" }] },
  });
  const cid = (created.body as { id: string }).id;
  assert.equal((await call("POST", `/api/challenges/${cid}/transition`, { session: owner, body: { status: "active" } })).response.status, 200);

  const listed = async () => ((await call("GET", `/api/groups/${gid}/catalog`, { session: owner })).body as { items: Array<{ id: string; title: string; challengeCount?: number }> }).items;
  const before = await listed();
  const inUse = before.find((item) => item.title === "Em uso")!;
  assert.equal(inUse.challengeCount, 1, "o item de um desafio conta 1");
  assert.equal(before.find((item) => item.id === orphanA)?.challengeCount, 0, "o que nenhum desafio usa conta 0");

  const forbidden = await call("POST", `/api/groups/${gid}/catalog/remove`, { session: member, body: { itemIds: [orphanA] } });
  assert.equal(forbidden.response.status, 403, "participante comum não remove do acervo");

  const result = await call("POST", `/api/groups/${gid}/catalog/remove`, { session: owner, body: { itemIds: [orphanA, orphanB, orphanA, inUse.id, "nao-existe"] } });
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  const body = result.body as { removed: number; removedIds: string[]; skipped: Array<{ id: string; reason: string }> };
  assert.equal(body.removed, 2, "só os dois sem desafio saem, e o repetido conta uma vez");
  assert.deepEqual([...body.removedIds].sort(), [orphanA, orphanB].sort());
  assert.deepEqual(body.skipped.map((entry) => [entry.id, entry.reason]).sort(), [[inUse.id, "in_use"], ["nao-existe", "not_found"]].sort());

  const after = await listed();
  assert.deepEqual(after.map((item) => item.title), ["Em uso"], "o item em uso continua no acervo");
  const binned = await adminPool.query("SELECT 1 FROM trash_items WHERE entity_id = ANY($1::text[])", [[orphanA, orphanB]]);
  assert.equal(binned.rowCount, 2, "os removidos vão para a lixeira, não somem");

  const personal = async (title: string) => ((await call("POST", "/api/personal/catalog/items", { session: owner, body: { kind: "other", title } })).body as { id: string }).id;
  const mine = [await personal("Leitura solta"), await personal("Corrida solta")];
  const personalResult = await call("POST", "/api/personal/catalog/remove", { session: owner, body: { itemIds: mine } });
  assert.equal(personalResult.response.status, 200, JSON.stringify(personalResult.body));
  assert.equal((personalResult.body as { removed: number }).removed, 2);
  assert.equal(((await call("GET", "/api/personal/catalog", { session: owner })).body as { items: unknown[] }).items.length, 0);

  const empty = await call("POST", `/api/groups/${gid}/catalog/remove`, { session: owner, body: { itemIds: [] } });
  assert.equal(empty.response.status, 400, "sem itens não há o que remover");
});

test("excluir uma biblioteca: pede confirmação se tem itens, respeita desafio em andamento, manda os itens para a lixeira e restaurar um deles traz a biblioteca de volta", async () => {
  const owner = await register("Lia", "lia_biblioteca");
  const member = await register("Rui", "rui_biblioteca");
  const gid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Estantes" } })).body as { id: string }).id;
  const inv = (await call("POST", `/api/groups/${gid}/invites`, { session: owner, body: { expiresInDays: 7, maxUses: 1 } })).body as { token: string };
  await call("POST", `/api/invites/${inv.token}`, { session: member, body: {} });

  const libraries = async () => ((await call("GET", `/api/groups/${gid}/catalog/libraries`, { session: owner })).body as { libraries: Array<{ id: string; kind: string; source: string }> }).libraries;
  const shelf = (await call("POST", `/api/groups/${gid}/catalog/libraries`, { session: owner, body: { label: "Estante extra" } })).body as { id: string; kind: string };
  const empty = (await call("POST", `/api/groups/${gid}/catalog/libraries`, { session: owner, body: { label: "Vazia" } })).body as { id: string };
  for (const title of ["Item 1", "Item 2"]) {
    const made = await call("POST", `/api/groups/${gid}/catalog/items`, { session: owner, body: { libraryId: shelf.id, title } });
    assert.equal(made.response.status, 201, JSON.stringify(made.body));
  }

  assert.equal((await call("DELETE", `/api/catalog/libraries/${shelf.id}?deleteItems=1`, { session: member })).response.status, 403, "participante comum não exclui biblioteca");

  const removedEmpty = await call("DELETE", `/api/catalog/libraries/${empty.id}`, { session: owner });
  assert.equal(removedEmpty.response.status, 200, JSON.stringify(removedEmpty.body));
  assert.equal((await libraries()).some((library) => library.id === empty.id), false, "a vazia some da lista");

  const needsOk = await call("DELETE", `/api/catalog/libraries/${shelf.id}`, { session: owner });
  assert.equal(needsOk.response.status, 409);
  assert.equal((needsOk.body as { error: string }).error, "library_has_items");
  assert.equal((needsOk.body as { details: { count: number } }).details.count, 2, "diz quantos itens iriam junto");
  assert.equal((await libraries()).some((library) => library.id === shelf.id), true, "sem confirmar, nada muda");

  await call("POST", `/api/groups/${gid}/catalog/items`, { session: owner, body: { kind: "film", title: "Aftersun" } });
  const screens = (await libraries()).find((library) => library.source === "screens")!;
  const builtIn = await call("DELETE", `/api/catalog/libraries/${screens.id}?deleteItems=1`, { session: owner });
  assert.equal(builtIn.response.status, 409);
  assert.equal((builtIn.body as { error: string }).error, "library_builtin", "Screens e Pages ficam");

  const created = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner, body: { recipe: "custom", title: "Ciclo", libraryId: shelf.id, participantIds: [owner.user.id], items: [{ title: "Item 3" }] },
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  const cid = (created.body as { id: string }).id;
  assert.equal((await call("POST", `/api/challenges/${cid}/transition`, { session: owner, body: { status: "active" } })).response.status, 200);
  const busy = await call("DELETE", `/api/catalog/libraries/${shelf.id}?deleteItems=1`, { session: owner });
  assert.equal(busy.response.status, 409, JSON.stringify(busy.body));
  assert.equal((busy.body as { error: string }).error, "library_busy");
  assert.deepEqual((busy.body as { details: { challenges: string[] } }).details.challenges, ["Ciclo"], "diz quais desafios seguram");
  assert.equal((await libraries()).some((library) => library.id === shelf.id), true);

  assert.equal((await call("POST", `/api/challenges/${cid}/transition`, { session: owner, body: { status: "closed" } })).response.status, 200);
  const itemIds = ((await call("GET", `/api/groups/${gid}/catalog`, { session: owner })).body as { items: Array<{ id: string; kind: string; title: string }> })
    .items.filter((item) => item.kind === shelf.kind).map((item) => item.id);
  assert.equal(itemIds.length, 3);
  const gone = await call("DELETE", `/api/catalog/libraries/${shelf.id}?deleteItems=1`, { session: owner });
  assert.equal(gone.response.status, 200, JSON.stringify(gone.body));
  assert.equal((gone.body as { items: number }).items, 3);
  assert.equal((await libraries()).some((library) => library.id === shelf.id), false, "a biblioteca sai da lista");
  const catalog = ((await call("GET", `/api/groups/${gid}/catalog`, { session: owner })).body as { items: Array<{ id: string }> }).items;
  assert.equal(catalog.some((item) => itemIds.includes(item.id)), false, "os itens saem do acervo");
  const binned = await adminPool.query("SELECT 1 FROM trash_items WHERE entity_kind = 'catalog_item' AND entity_id = ANY($1::text[])", [itemIds]);
  assert.equal(binned.rowCount, 3, "e vão para a lixeira");
  const links = await adminPool.query("SELECT 1 FROM challenge_libraries WHERE challenge_id = $1 AND kind = $2", [cid, shelf.kind]);
  assert.equal(links.rowCount, 0, "o vínculo do desafio encerrado com a biblioteca cai");

  const restored = await call("POST", `/api/groups/${gid}/trash/restore`, { session: owner, body: { kind: "catalog_item", id: itemIds[0] } });
  assert.equal(restored.response.status, 200, JSON.stringify(restored.body));
  assert.equal((await libraries()).some((library) => library.id === shelf.id), true, "restaurar um item traz a biblioteca de volta");

  const personal = (await call("POST", "/api/personal/catalog/libraries", { session: owner, body: { label: "Minha" } })).body as { id: string };
  assert.equal((await call("DELETE", `/api/catalog/libraries/${personal.id}`, { session: member })).response.status, 403, "biblioteca pessoal só o dono exclui");
  assert.equal((await call("DELETE", `/api/catalog/libraries/${personal.id}`, { session: owner })).response.status, 200);
});

test("o acervo devolve quando cada item entrou — é o que ordena \"adicionados recentemente\"", async () => {
  const owner = await register("Nina", "nina_recente");
  const gid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Recentes" } })).body as { id: string }).id;
  for (const title of ["Primeiro", "Segundo"]) {
    assert.equal((await call("POST", `/api/groups/${gid}/catalog/items`, { session: owner, body: { kind: "film", title } })).response.status, 201);
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  const items = ((await call("GET", `/api/groups/${gid}/catalog`, { session: owner })).body as { items: Array<{ title: string; createdAt: string }> }).items;
  const at = (title: string) => Date.parse(items.find((item) => item.title === title)!.createdAt);
  assert.ok(Number.isFinite(at("Primeiro")), "createdAt é uma data ISO");
  assert.ok(at("Segundo") > at("Primeiro"), "o mais novo tem a data mais recente");
  const personal = await call("POST", "/api/personal/catalog/items", { session: owner, body: { kind: "film", title: "Solto" } });
  assert.equal(personal.response.status, 201);
  const mine = ((await call("GET", "/api/personal/catalog", { session: owner })).body as { items: Array<{ createdAt?: string }> }).items;
  assert.ok(mine.every((item) => typeof item.createdAt === "string"), "o acervo pessoal também");
});

test("o ano de um item vai de antes de Cristo a 2200: Crime e castigo (1866) e a Odisseia entram, e o que passa disso é recusado", async () => {
  const owner = await register("Lia", "lia_classicos");
  const gid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Clássicos" } })).body as { id: string }).id;
  const add = (body: Record<string, unknown>) => call("POST", `/api/groups/${gid}/catalog/items`, { session: owner, body });

  const crime = await add({ kind: "book", title: "Crime e castigo", author: "Dostoiévski", year: 1866 });
  assert.equal(crime.response.status, 201, JSON.stringify(crime.body));
  const odyssey = await add({ kind: "book", title: "Odisseia", author: "Homero", year: -700 });
  assert.equal(odyssey.response.status, 201, JSON.stringify(odyssey.body));

  const tooFar = await add({ kind: "book", title: "Do futuro", author: "Alguém", year: 3000 });
  assert.equal(tooFar.response.status, 400);
  assert.equal((tooFar.body as { error: string }).error, "invalid_number");
  const notWhole = await add({ kind: "book", title: "Quebrado", author: "Alguém", year: 1866.5 });
  assert.equal(notWhole.response.status, 400);

  const items = ((await call("GET", `/api/groups/${gid}/catalog`, { session: owner })).body as { items: Array<{ title: string; year: number | null }> }).items;
  assert.equal(items.find((item) => item.title === "Crime e castigo")?.year, 1866);
  assert.equal(items.find((item) => item.title === "Odisseia")?.year, -700);

  // o banco também aceita — e recusa fora da faixa mesmo sem passar pela API
  await assert.rejects(adminPool.query("UPDATE catalog_items SET year = 2201 WHERE group_id = $1", [gid]), /catalog_items_year_check/);
  await adminPool.query("UPDATE catalog_items SET year = -3000 WHERE group_id = $1 AND title = 'Odisseia'", [gid]);

  // a importação de lista lê o mesmo intervalo
  const created = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner, body: { recipe: "bookshelf", title: "Estante clássica", participantIds: [owner.user.id], items: [{ title: "Dom Casmurro", author: "Machado de Assis", year: 1899 }] },
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  const preview = await call("POST", `/api/challenges/${(created.body as { id: string }).id}/items/preview`, {
    session: owner, body: { json: JSON.stringify([{ title: "Dom Quixote", author: "Cervantes", year: 1605 }, { title: "Ilíada", author: "Homero", year: -750 }]) },
  });
  assert.equal(preview.response.status, 200, JSON.stringify(preview.body));
  const rows = (preview.body as { rows: Array<{ title: string; mapped: { year: number | null } }> }).rows;
  assert.deepEqual(rows.map((row) => row.mapped.year), [1605, -750]);
});

test("métricas combinadas: qualquer pessoa cria no próprio desafio uma métrica que soma ou tira a média de vários campos", async () => {
  const owner = await register("Dona Métricas", "dona_metricas");
  const gid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Clube das Métricas" } })).body as { id: string }).id;
  const created = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner,
    body: { recipe: "cinema", title: "Crítica completa", participantIds: [owner.user.id], items: [{ title: "Aftersun" }] },
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  const cid = (created.body as { id: string }).id;
  const itemId = ((await call("GET", `/api/challenges/${cid}`, { session: owner })).body as { items: Array<{ id: string }> }).items[0].id;

  const notaId = ((await call("GET", `/api/challenges/${cid}`, { session: owner })).body as { fields: Array<{ id: string; key: string }> })
    .fields.find((field) => field.key === "nota")!.id;
  const direcao = await call("POST", `/api/challenges/${cid}/fields`, { session: owner, body: { label: "Direção", type: "rating", required: false } });
  const roteiro = await call("POST", `/api/challenges/${cid}/fields`, { session: owner, body: { label: "Roteiro", type: "rating", required: false } });
  assert.equal(direcao.response.status, 201, JSON.stringify(direcao.body));
  const direcaoId = (direcao.body as { id: string }).id;
  const roteiroId = (roteiro.body as { id: string }).id;

  await call("POST", `/api/challenges/${cid}/transition`, { session: owner, body: { status: "active" } });
  // A field added after creation has its own generated semantic key — look it up rather than guessing it.
  const detailFields = (await call("GET", `/api/challenges/${cid}`, { session: owner })).body as { fields: Array<{ id: string; key: string }> };
  const keyOf = (id: string) => detailFields.fields.find((field) => field.id === id)!.key;
  const entryResp = await call("POST", `/api/challenges/${cid}/entries`, {
    session: owner, body: { itemId, values: { nota: 4, [keyOf(direcaoId)]: 5, [keyOf(roteiroId)]: 3 } },
  });
  assert.equal(entryResp.response.status, 201, JSON.stringify(entryResp.body));

  // menos de dois campos: recusado
  const tooFew = await call("POST", `/api/challenges/${cid}/metrics`, {
    session: owner, body: { label: "Só um", operation: "average", fieldIds: [notaId], groupBy: "item" },
  });
  assert.equal(tooFew.response.status, 400, JSON.stringify(tooFew.body));

  // campo duplicado: recusado
  const dup = await call("POST", `/api/challenges/${cid}/metrics`, {
    session: owner, body: { label: "Duplicado", operation: "average", fieldIds: [notaId, notaId], groupBy: "item" },
  });
  assert.equal(dup.response.status, 400, JSON.stringify(dup.body));

  // campo que não existe: recusado
  const bogus = await call("POST", `/api/challenges/${cid}/metrics`, {
    session: owner, body: { label: "Campo fantasma", operation: "average", fieldIds: [notaId, "campo_inexistente"], groupBy: "item" },
  });
  assert.equal(bogus.response.status, 400, JSON.stringify(bogus.body));

  // campo de texto (comentário) não é numérico: recusado
  const comentarioId = detailFields.fields.find((field) => field.key === "comentario")!.id;
  const notNumeric = await call("POST", `/api/challenges/${cid}/metrics`, {
    session: owner, body: { label: "Com texto", operation: "average", fieldIds: [notaId, comentarioId], groupBy: "item" },
  });
  assert.equal(notNumeric.response.status, 400, JSON.stringify(notNumeric.body));

  // campos de tipos de registro diferentes: recusado (misturaria a maioria dos registros de fora)
  const sharedType = await call("POST", `/api/challenges/${cid}/entry-types`, {
    session: owner,
    body: { name: "Nota da crítica", sharedEditPolicy: "members_fill_admin_corrects", field: { key: "critica", label: "Nota da crítica", type: "rating", required: false } },
  });
  assert.equal(sharedType.response.status, 201, JSON.stringify(sharedType.body));
  // A shared type's field lives on its own entry type, not the primary one — the flat `fields` list on
  // challenge detail only ever shows the primary form, so read the id straight off the creation response.
  const criticaId = (sharedType.body as { fieldId: string }).fieldId;
  const crossType = await call("POST", `/api/challenges/${cid}/metrics`, {
    session: owner, body: { label: "Tipos diferentes", operation: "average", fieldIds: [notaId, criticaId], groupBy: "item" },
  });
  assert.equal(crossType.response.status, 400, JSON.stringify(crossType.body));

  // a métrica combinada de verdade: soma dos três — para o único item, 4 + 5 + 3 = 12
  const summed = await call("POST", `/api/challenges/${cid}/metrics`, {
    session: owner,
    body: { label: "Nota combinada", operation: "average", groupBy: "item", fieldIds: [notaId, direcaoId, roteiroId], combineOp: "sum" },
  });
  assert.equal(summed.response.status, 201, JSON.stringify(summed.body));
  const metricId = (summed.body as { id: string }).id;

  const withMetric = (await call("GET", `/api/challenges/${cid}`, { session: owner })).body as {
    metrics: Array<{ id: string; fieldIds?: string[]; fieldLabels?: string[]; combineOp?: string; value: number | null; series?: Array<{ label: string; value: number | null }> }>;
  };
  const combined = withMetric.metrics.find((metric) => metric.id === metricId)!;
  assert.deepEqual(combined.fieldIds, [notaId, direcaoId, roteiroId]);
  assert.deepEqual(combined.fieldLabels, ["Nota", "Direção", "Roteiro"]);
  assert.equal(combined.combineOp, "sum");
  assert.equal(combined.series?.[0]?.value, 12, JSON.stringify(combined.series));

  // editar a mesma métrica para média em vez de soma — agora (4 + 5 + 3) / 3 = 4
  const edited = await call("PATCH", `/api/challenges/${cid}/metrics/${metricId}`, {
    session: owner,
    body: { label: "Nota combinada", operation: "average", groupBy: "item", fieldIds: [notaId, direcaoId, roteiroId], combineOp: "average" },
  });
  assert.equal(edited.response.status, 200, JSON.stringify(edited.body));
  const withAverage = (await call("GET", `/api/challenges/${cid}`, { session: owner })).body as {
    metrics: Array<{ id: string; combineOp?: string; series?: Array<{ value: number | null }> }>;
  };
  const averaged = withAverage.metrics.find((metric) => metric.id === metricId)!;
  assert.equal(averaged.combineOp, "average");
  assert.equal(averaged.series?.[0]?.value, 4, JSON.stringify(averaged.series));

  // voltando a um único campo (edição também sabe desfazer a combinação)
  const backToOne = await call("PATCH", `/api/challenges/${cid}/metrics/${metricId}`, {
    session: owner, body: { label: "Só direção", operation: "average", fieldId: direcaoId, groupBy: "item" },
  });
  assert.equal(backToOne.response.status, 200, JSON.stringify(backToOne.body));
  const single = (await call("GET", `/api/challenges/${cid}`, { session: owner })).body as {
    metrics: Array<{ id: string; fieldIds?: string[]; fieldId?: string | null }>;
  };
  const undone = single.metrics.find((metric) => metric.id === metricId)!;
  assert.equal(undone.fieldId, direcaoId);
  assert.equal(undone.fieldIds, undefined);
});

test("ranking de itens: a média de várias notas é a nota geral de cada item, e os itens saem ordenados por ela — numa receita personalizada também", async () => {
  const owner = await register("Rita Ranking", "rita_ranking");
  const guest = await register("Caio Ranking", "caio_ranking");
  const gid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Onde comer" } })).body as { id: string }).id;
  const invite = await call("POST", `/api/groups/${gid}/invites`, { session: owner, body: { expiresInDays: 7, maxUses: 1 } });
  await call("POST", `/api/invites/${(invite.body as { token: string }).token}`, { session: guest, body: {} });
  const library = (await call("POST", `/api/groups/${gid}/catalog/libraries`, { session: owner, body: { label: "Restaurantes" } })).body as { id: string };

  const rating = (key: string, label: string) => ({ key, label, type: "rating", required: true, config: { min: 0, max: 5, step: 0.5 } });
  const created = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner,
    body: {
      recipe: "custom", title: "Melhor lugar", libraryId: library.id, participantIds: [owner.user.id, guest.user.id],
      items: [{ title: "Cantina" }, { title: "Sushi" }, { title: "Padaria" }],
      fields: [rating("comida", "Comida"), rating("ambiente", "Ambiente"), rating("custo", "Custo-benefício")],
    },
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  const cid = (created.body as { id: string }).id;
  await call("POST", `/api/challenges/${cid}/transition`, { session: owner, body: { status: "active" } });
  const detail = (await call("GET", `/api/challenges/${cid}`, { session: owner })).body as {
    items: Array<{ id: string; title: string }>; fields: Array<{ id: string; key: string }>;
  };
  const itemId = (title: string) => detail.items.find((item) => item.title === title)!.id;
  const fieldId = (key: string) => detail.fields.find((field) => field.key === key)!.id;

  // Cantina tem a comida nota 5 mas o resto fraco; Sushi é bom em tudo; a Padaria só uma pessoa avaliou.
  const give = async (who: typeof owner, title: string, comida: number, ambiente: number, custo: number) => {
    const response = await call("POST", `/api/challenges/${cid}/entries`, { session: who, body: { itemId: itemId(title), values: { comida, ambiente, custo } } });
    assert.equal(response.response.status, 201, JSON.stringify(response.body));
  };
  await give(owner, "Cantina", 5, 2, 2);
  await give(guest, "Cantina", 5, 3, 1);
  await give(owner, "Sushi", 4, 4, 4);
  await give(guest, "Sushi", 5, 4, 3);
  await give(owner, "Padaria", 5, 5, 5);

  const ranking = await call("POST", `/api/challenges/${cid}/metrics`, {
    session: owner,
    body: { label: "Melhores lugares", operation: "average", groupBy: "item", fieldIds: [fieldId("comida"), fieldId("ambiente"), fieldId("custo")], combineOp: "average" },
  });
  assert.equal(ranking.response.status, 201, JSON.stringify(ranking.body));
  const adjusted = await call("POST", `/api/challenges/${cid}/metrics`, {
    session: owner,
    body: { label: "Melhores lugares (ajustada)", operation: "bayesian_average", groupBy: "item", fieldIds: [fieldId("comida"), fieldId("ambiente"), fieldId("custo")], combineOp: "average" },
  });
  assert.equal(adjusted.response.status, 201, JSON.stringify(adjusted.body));

  const metrics = (await call("GET", `/api/challenges/${cid}`, { session: owner })).body as {
    metrics: Array<{ id: string; label: string; series?: Array<{ label: string; value: number | null; sampleSize: number }> }>;
  };
  const series = metrics.metrics.find((metric) => metric.id === (ranking.body as { id: string }).id)!.series!;
  // Cada registro vira uma nota só (a média das três); depois cada item é a média de quem o avaliou.
  // Padaria 5; Sushi ((4+4+4)/3 + (5+4+3)/3)/2 = 4; Cantina ((5+2+2)/3 + (5+3+1)/3)/2 = 3 — e a ordem segue a nota geral, não a comida sozinha.
  assert.deepEqual(series.map((entry) => [entry.label, entry.value, entry.sampleSize]), [["Padaria", 5, 1], ["Sushi", 4, 2], ["Cantina", 3, 2]]);
  const adjustedSeries = metrics.metrics.find((metric) => metric.id === (adjusted.body as { id: string }).id)!.series!;
  assert.deepEqual(adjustedSeries.map((entry) => entry.label), ["Padaria", "Sushi", "Cantina"], "a nota ajustada mantém a ordem com amostras parecidas");
  const padaria = adjustedSeries.find((entry) => entry.label === "Padaria")!;
  assert.ok(padaria.value !== null && padaria.value < 5, "com um voto só, a ajustada puxa o item para a média geral em vez de deixá-lo no 5");
});

test("check-in com vários itens: um treino guarda um registro por exercício, e a frequência, o histórico e as métricas saem daí", async () => {
  const owner = await register("Tati Treino", "tati_treino");
  const gid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Academia" } })).body as { id: string }).id;
  const library = (await call("POST", `/api/groups/${gid}/catalog/libraries`, { session: owner, body: { label: "Exercícios" } })).body as { id: string };
  const number = (key: string, label: string) => ({ key, label, type: "number", required: true, config: { min: 0, step: 0.5 } });
  const created = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner,
    body: {
      recipe: "custom", recordingMode: "session", sessionName: "Treino", title: "Meu treino", libraryId: library.id,
      participantIds: [owner.user.id],
      items: [{ title: "Supino reto" }, { title: "Agachamento" }, { title: "Puxada" }],
      fields: [number("carga", "Carga (kg)"), number("reps", "Repetições")],
    },
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  const cid = (created.body as { id: string }).id;
  await call("POST", `/api/challenges/${cid}/transition`, { session: owner, body: { status: "active" } });

  type Detail = {
    items: Array<{ id: string; title: string }>;
    entryTypes: Array<{ id: string; name: string; semanticKey: string; parentTypeId: string | null; isPrimary: boolean; fields: Array<{ id: string; key: string }> }>;
    metrics: Array<{ id: string; label: string; value: number | null; series?: Array<{ label: string; value: number | null }> }>;
  };
  const detail = async () => (await call("GET", `/api/challenges/${cid}`, { session: owner })).body as Detail;
  const d = await detail();
  const visitType = d.entryTypes.find((type) => type.semanticKey === "sessao")!;
  const recordType = d.entryTypes.find((type) => type.semanticKey === "desempenho")!;
  assert.equal(visitType.name, "Treino", "o check-in tem o nome que o criador deu");
  assert.equal(recordType.parentTypeId, visitType.id, "o registro de cada item mora dentro do check-in");
  assert.equal(recordType.isPrimary, true, "os campos que o criador definiu são os do registro por item");
  assert.deepEqual(recordType.fields.map((field) => field.key), ["carga", "reps"]);
  const item = (title: string) => d.items.find((entry) => entry.title === title)!.id;

  const listed = async () => ((await call("GET", `/api/challenges/${cid}/entries`, { session: owner })).body as { entries: Array<{
    id: string; entryTypeId: string; parentEntryId: string | null; itemId: string | null; occurredOn: string | null; values: Record<string, unknown>;
  }> }).entries;
  const carga = recordType.fields.find((field) => field.key === "carga")!.id;

  // um registro sozinho não tem onde morar — recusado; um check-in vazio também
  const alone = await call("POST", `/api/challenges/${cid}/entries`, { session: owner, body: { entryTypeId: recordType.id, itemId: item("Puxada"), values: { carga: 45, reps: 10 } } });
  assert.equal(alone.response.status, 400, JSON.stringify(alone.body));
  const empty = await call("POST", `/api/challenges/${cid}/entries`, { session: owner, body: { entryTypeId: visitType.id, occurredOn: "2026-09-19", children: [] } });
  assert.equal(empty.response.status, 400, JSON.stringify(empty.body));
  const badItem = await call("POST", `/api/challenges/${cid}/entries`, { session: owner, body: { entryTypeId: visitType.id, occurredOn: "2026-09-19", children: [{ itemId: "nao-existe", values: { carga: 1, reps: 1 } }] } });
  assert.equal(badItem.response.status, 400, JSON.stringify(badItem.body));
  const missingField = await call("POST", `/api/challenges/${cid}/entries`, { session: owner, body: { entryTypeId: visitType.id, occurredOn: "2026-09-19", children: [{ itemId: item("Puxada"), values: { carga: 45 } }] } });
  assert.equal(missingField.response.status, 400, "cada registro valida os campos do criador");
  assert.equal((await listed()).length, 0, "nada disso deixou linha pela metade");

  // treino 19/09: dois exercícios → um check-in e dois registros, numa transação só
  const first = await call("POST", `/api/challenges/${cid}/entries`, {
    session: owner,
    body: {
      entryTypeId: visitType.id, occurredOn: "2026-09-19",
      children: [{ itemId: item("Supino reto"), values: { carga: 55, reps: 6 } }, { itemId: item("Agachamento"), values: { carga: 70, reps: 8 } }],
    },
  });
  assert.equal(first.response.status, 201, JSON.stringify(first.body));
  const firstId = (first.body as { id: string; children: Array<{ id: string }> }).id;
  assert.equal((first.body as { children: unknown[] }).children.length, 2);
  // treino 22/09: três exercícios, o supino de novo
  const second = await call("POST", `/api/challenges/${cid}/entries`, {
    session: owner,
    body: {
      entryTypeId: visitType.id, occurredOn: "2026-09-22", values: { nota_sessao: "Dia bom" },
      children: [
        { itemId: item("Supino reto"), values: { carga: 55, reps: 8 } },
        { itemId: item("Agachamento"), values: { carga: 70, reps: 8 } },
        { itemId: item("Puxada"), values: { carga: 45, reps: 10 } },
      ],
    },
  });
  assert.equal(second.response.status, 201, JSON.stringify(second.body));
  const secondId = (second.body as { id: string }).id;

  const after = await listed();
  const visits = after.filter((entry) => entry.entryTypeId === visitType.id);
  const records = after.filter((entry) => entry.entryTypeId === recordType.id);
  assert.equal(visits.length, 2, "duas idas à academia");
  assert.equal(records.length, 5, "cinco registros de exercício");
  assert.ok(visits.every((visit) => visit.parentEntryId === null));
  assert.deepEqual(records.filter((record) => record.parentEntryId === secondId).map((record) => record.occurredOn), ["2026-09-22", "2026-09-22", "2026-09-22"], "cada registro herda a data do treino");
  // a progressão do supino, lida do histórico — sem nenhum "recorde atual" digitado
  const bench = records.filter((record) => record.itemId === item("Supino reto")).sort((a, b) => (a.occurredOn ?? "").localeCompare(b.occurredOn ?? ""));
  assert.deepEqual(bench.map((record) => [record.occurredOn, record.values[carga]]), [["2026-09-19", 55], ["2026-09-22", 55]]);

  // as métricas de partida: frequência (visitas) e registros por item
  const seeded = await detail();
  assert.equal(seeded.metrics.find((metric) => metric.label === "Frequência")?.value, 2, "a frequência conta treinos, não exercícios");
  const perItem = seeded.metrics.find((metric) => metric.label === "Registros por item")!.series!;
  assert.deepEqual(perItem.map((entry) => [entry.label, entry.value]).sort(), [["Agachamento", 2], ["Puxada", 1], ["Supino reto", 2]]);
  // e uma métrica de recorde do próprio usuário: a maior carga por exercício
  const record = await call("POST", `/api/challenges/${cid}/metrics`, { session: owner, body: { label: "Maior carga", operation: "max", fieldId: carga, groupBy: "item" } });
  assert.equal(record.response.status, 201, JSON.stringify(record.body));
  const records2 = (await detail()).metrics.find((metric) => metric.label === "Maior carga")!.series!;
  assert.deepEqual(records2.map((entry) => [entry.label, entry.value]).sort(), [["Agachamento", 70], ["Puxada", 45], ["Supino reto", 55]]);

  // o progresso do card na Home conta treinos (o check-in), não registros de exercício
  const boot = (await call("GET", "/api/bootstrap", { session: owner })).body as { challenges: Array<{ id: string; completedCount: number; totalCount: number | null }> };
  assert.equal(boot.challenges.find((challenge) => challenge.id === cid)?.completedCount, 2);

  // editar o treino: muda uma carga, tira a puxada, põe outro supino — e "salvar" deixa exatamente o que o formulário mostrava
  const secondRecords = after.filter((entry) => entry.parentEntryId === secondId);
  const benchRow = secondRecords.find((entry) => entry.itemId === item("Supino reto"))!;
  const squatRow = secondRecords.find((entry) => entry.itemId === item("Agachamento"))!;
  const edited = await call("PATCH", `/api/entries/${secondId}`, {
    session: owner,
    body: {
      values: { nota_sessao: "Dia ótimo" },
      children: [
        { id: benchRow.id, itemId: item("Supino reto"), values: { carga: 57.5, reps: 8 } },
        { id: squatRow.id, itemId: item("Agachamento"), values: { carga: 70, reps: 8 } },
        { itemId: item("Supino reto"), values: { carga: 50, reps: 12 } },
      ],
    },
  });
  assert.equal(edited.response.status, 200, JSON.stringify(edited.body));
  const reread = (await listed()).filter((entry) => entry.parentEntryId === secondId);
  assert.equal(reread.length, 3);
  assert.equal(reread.find((entry) => entry.id === benchRow.id)?.values[carga], 57.5, "o registro existente foi atualizado, com o mesmo id");
  assert.ok(!reread.some((entry) => entry.itemId === item("Puxada")), "a puxada saiu do treino");
  assert.equal((await adminPool.query("SELECT 1 FROM entries WHERE parent_entry_id = $1 AND item_id = $2", [secondId, item("Puxada")])).rowCount, 0, "e não ficou linha fantasma");
  // mudar só a data leva os registros junto
  await call("PATCH", `/api/entries/${firstId}`, { session: owner, body: { occurredOn: "2026-09-18" } });
  assert.deepEqual((await listed()).filter((entry) => entry.parentEntryId === firstId).map((entry) => entry.occurredOn), ["2026-09-18", "2026-09-18"]);
  // um registro solto não se edita nem se apaga por fora do treino
  assert.equal((await call("PATCH", `/api/entries/${benchRow.id}`, { session: owner, body: { values: { carga: 1, reps: 1 } } })).response.status, 400);
  assert.equal((await call("DELETE", `/api/entries/${benchRow.id}`, { session: owner })).response.status, 400);

  // apagar o treino manda os registros junto para a lixeira; restaurar traz tudo de volta
  assert.equal((await call("DELETE", `/api/entries/${secondId}`, { session: owner })).response.status, 200);
  assert.equal((await listed()).filter((entry) => entry.id === secondId || entry.parentEntryId === secondId).length, 0);
  assert.equal((await detail()).metrics.find((metric) => metric.label === "Frequência")?.value, 1, "a frequência cai");
  const restored = await call("POST", `/api/challenges/${cid}/trash/restore`, { session: owner, body: { kind: "entry", id: secondId } });
  assert.equal(restored.response.status, 200, JSON.stringify(restored.body));
  assert.equal((await listed()).filter((entry) => entry.parentEntryId === secondId).length, 3, "os três registros voltam com o treino");

  // a estrutura do treino não se desmonta por fora
  const lock = await call("DELETE", `/api/challenges/${cid}/entry-types/${recordType.id}`, { session: owner });
  assert.equal(lock.response.status, 409, JSON.stringify(lock.body));

  // copiar o desafio leva a estrutura: o tipo de registro continua dentro do tipo de check-in
  const otherGroup = ((await call("POST", "/api/groups", { session: owner, body: { name: "Outra academia" } })).body as { id: string }).id;
  const copy = await call("POST", `/api/challenges/${cid}/duplicate`, { session: owner, body: { title: "Cópia do treino", targetGroupId: otherGroup } });
  assert.equal(copy.response.status, 201, JSON.stringify(copy.body));
  const copied = (await call("GET", `/api/challenges/${(copy.body as { challengeId: string }).challengeId}`, { session: owner })).body as Detail;
  const copiedVisit = copied.entryTypes.find((type) => type.semanticKey === "sessao")!;
  assert.equal(copied.entryTypes.find((type) => type.semanticKey === "desempenho")?.parentTypeId, copiedVisit.id);
});

test("check-in com vários itens só existe num desafio personalizado", async () => {
  const owner = await register("Otto Sessão", "otto_sessao");
  const gid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Grupo" } })).body as { id: string }).id;
  const cinema = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner, body: { recipe: "cinema", recordingMode: "session", title: "Filmes", participantIds: [owner.user.id], items: [{ title: "Aftersun" }] },
  });
  assert.equal(cinema.response.status, 400, JSON.stringify(cinema.body));
  const invalid = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner, body: { recipe: "habit", recordingMode: "varios", title: "Hábito", participantIds: [owner.user.id] },
  });
  assert.equal(invalid.response.status, 400, JSON.stringify(invalid.body));
});

test("um desafio personalizado aceita uma biblioteca embutida que ainda não tem itens, escolhida só pelo tipo, e guarda o modo de check-in", async () => {
  const owner = await register("Ana Embutida", "ana_embutida");
  const gid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Biblioteca nova" } })).body as { id: string }).id;
  const created = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner,
    body: {
      recipe: "custom", title: "Treino", participantIds: [owner.user.id],
      recordingMode: "session", sessionName: "Treino", sessionNoteLabel: "Como foi?",
      libraries: [{ libraryKind: "film" }],
      fields: [{ key: "carga", label: "Carga", type: "number", required: true }],
      items: [{ title: "Supino", libraryKind: "film" }],
    },
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  const id = (created.body as { id: string }).id;
  const types = await adminPool.query<{ purpose: string; parent_type_id: string | null }>(
    "SELECT purpose, parent_type_id FROM entry_types WHERE challenge_id = $1 AND archived_at IS NULL", [id],
  );
  assert.ok(types.rows.some((row) => row.parent_type_id !== null), "o desafio nasceu em modo check-in, com um tipo filho por item");
});

test("prateleira do acervo: uma chamada traz as bibliotecas, a contagem de cada uma e só os 10 itens mais novos, com os atributos", async () => {
  const owner = await register("Paula Prateleira", "paula_prateleira");
  const stranger = await register("Rui Estranho", "rui_estranho");
  const gid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Prateleira" } })).body as { id: string }).id;
  const titles: string[] = [];
  for (let n = 1; n <= 12; n += 1) {
    const title = `Filme ${String(n).padStart(2, "0")}`;
    titles.push(title);
    assert.equal((await call("POST", `/api/groups/${gid}/catalog/items`, { session: owner, body: { kind: "film", title } })).response.status, 201);
  }
  const library = (await call("POST", `/api/groups/${gid}/catalog/libraries`, { session: owner, body: { label: "Treinos" } })).body as { id: string; kind: string };
  const def = (await call("POST", `/api/groups/${gid}/catalog-attributes`, { session: owner, body: { libraryId: library.id, label: "Carga" } })).body as { key: string };
  const workout = await call("POST", `/api/groups/${gid}/catalog/items`, {
    session: owner, body: { libraryId: library.id, title: "Agachamento", attributes: { [def.key]: "80 kg" } },
  });
  assert.equal(workout.response.status, 201, JSON.stringify(workout.body));

  type Shelf = {
    libraries: Array<{ kind: string }>;
    counts: Record<string, number>;
    items: Array<{ id: string; title: string; kind: string; createdAt: string; attributes: Array<{ label: string; value: unknown }> }>;
  };
  const shelf = await call("GET", `/api/groups/${gid}/catalog/shelf`, { session: owner });
  assert.equal(shelf.response.status, 200, JSON.stringify(shelf.body));
  const data = shelf.body as Shelf;

  assert.equal(data.counts.film, 12, "a contagem é do acervo todo, não do que veio");
  assert.equal(data.counts[library.kind], 1);
  assert.ok(data.libraries.some((entry) => entry.kind === "film") && data.libraries.some((entry) => entry.kind === library.kind));

  const films = data.items.filter((item) => item.kind === "film");
  assert.equal(films.length, 10, "no máximo 10 por biblioteca");
  assert.deepEqual(films.map((item) => item.title).sort(), titles.slice(2).sort(), "os 10 mais novos: 03 a 12");
  assert.ok(films.every((item) => typeof item.createdAt === "string"));
  const squat = data.items.find((item) => item.title === "Agachamento");
  assert.deepEqual(squat?.attributes.map((a) => [a.label, a.value]), [["Carga", "80 kg"]], "os atributos vêm junto");

  // o que já foi para a lixeira sai da prateleira e da contagem
  const removed = await call("POST", `/api/groups/${gid}/catalog/remove`, { session: owner, body: { itemIds: [data.items.find((item) => item.title === "Filme 12")!.id] } });
  assert.equal(removed.response.status, 200, JSON.stringify(removed.body));
  const after = (await call("GET", `/api/groups/${gid}/catalog/shelf`, { session: owner })).body as Shelf;
  assert.equal(after.counts.film, 11);
  const filmsAfter = after.items.filter((item) => item.kind === "film").map((item) => item.title).sort();
  assert.deepEqual(filmsAfter, titles.slice(1, 11).sort(), "o próximo mais novo ocupa o lugar");

  // só quem é do grupo vê; o resto da API do acervo não muda
  const denied = await call("GET", `/api/groups/${gid}/catalog/shelf`, { session: stranger });
  assert.ok([403, 404].includes(denied.response.status), `estranho recebeu ${denied.response.status}`);
  assert.equal((await call("GET", `/api/groups/${gid}/catalog/shelf`)).response.status, 401);
  const full = (await call("GET", `/api/groups/${gid}/catalog`, { session: owner })).body as { items: unknown[] };
  assert.equal(full.items.length, 12, "a lista completa continua devolvendo tudo");
});

test("prateleira do acervo pessoal: só o acervo de quem pede, com contagem e limite por biblioteca", async () => {
  const owner = await register("Pedro Pessoal", "pedro_pessoal");
  const other = await register("Olga Outra", "olga_outra");
  for (let n = 1; n <= 11; n += 1) {
    assert.equal((await call("POST", "/api/personal/catalog/items", { session: owner, body: { kind: "film", title: `Meu ${String(n).padStart(2, "0")}` } })).response.status, 201);
  }
  assert.equal((await call("POST", "/api/personal/catalog/items", { session: other, body: { kind: "film", title: "Da Olga" } })).response.status, 201);

  type Shelf = { counts: Record<string, number>; items: Array<{ title: string }> };
  const mine = (await call("GET", "/api/personal/catalog/shelf", { session: owner })).body as Shelf;
  assert.equal(mine.counts.film, 11);
  assert.equal(mine.items.length, 10);
  assert.ok(!mine.items.some((item) => item.title === "Meu 01"), "o mais antigo fica de fora");
  assert.ok(!mine.items.some((item) => item.title === "Da Olga"), "nada de outra conta");

  const theirs = (await call("GET", "/api/personal/catalog/shelf", { session: other })).body as Shelf;
  assert.deepEqual([theirs.counts.film, theirs.items.map((item) => item.title)], [1, ["Da Olga"]]);
  assert.equal((await call("GET", "/api/personal/catalog/shelf")).response.status, 401);

  // quem nunca abriu o espaço pessoal recebe uma prateleira vazia, não um erro
  const fresh = await register("Nova Pessoa", "nova_pessoa_prateleira");
  const empty = await call("GET", "/api/personal/catalog/shelf", { session: fresh });
  assert.equal(empty.response.status, 200, JSON.stringify(empty.body));
  assert.deepEqual((empty.body as Shelf).items, []);
});

test("sessão: a última atividade só é regravada depois de 15 minutos, mas a sessão continua valendo", async () => {
  const user = await register("Sara Sessão", "sara_sessao_touch");
  const userSessions = async () => (await adminPool.query<{ id: string; last_seen_at: Date }>("SELECT id, last_seen_at FROM sessions WHERE user_id = $1", [user.user.id])).rows;
  const [before] = await userSessions();
  assert.ok(before, "a sessão existe");

  // um pedido logo em seguida não mexe na marca
  assert.equal((await call("GET", "/api/bootstrap", { session: user })).response.status, 200);
  const [soon] = await userSessions();
  assert.equal(soon.last_seen_at.getTime(), before.last_seen_at.getTime());

  // passados 15 minutos, o próximo pedido atualiza
  await adminPool.query("UPDATE sessions SET last_seen_at = now() - interval '20 minutes' WHERE id = $1", [before.id]);
  assert.equal((await call("GET", "/api/bootstrap", { session: user })).response.status, 200);
  const [later] = await userSessions();
  assert.ok(Date.now() - later.last_seen_at.getTime() < 5 * 60 * 1000, "voltou a ser recente");
});
