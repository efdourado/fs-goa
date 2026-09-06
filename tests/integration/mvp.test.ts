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
  const csv = await call("GET", `/api/challenges/${challengeId}/export.csv`, { session: owner });
  assert.equal(csv.response.status, 200);
  assert.match(csv.body as string, /canario-pessoal/);
  assert.match(csv.body as string, /Aftersun \(2022\)/, "a exportação deve usar o título corrigido");

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

  // O token não é guardado: o detalhe do desafio só diz que existe um link.
  const detailWithToken = await call("GET", `/api/challenges/${challengeId}`, { session: owner });
  assert.equal((detailWithToken.body as { result: { hasPublishedLink: boolean; shareToken?: unknown } }).result.hasPublishedLink, true);
  assert.equal((detailWithToken.body as { result: { shareToken?: unknown } }).result.shareToken, undefined, "o token nunca volta na resposta");

  // Snapshot congelado: salvar rascunho de novo não muda a vitrine pública.
  await call("POST", `/api/challenges/${challengeId}/results`, {
    session: owner,
    body: { headline: "Manchete só no rascunho", summary: "x", metricIds: [], comments: [] },
  });
  const stillFrozen = await call("GET", `/api/results/${shareToken}`);
  assert.match(JSON.stringify(stillFrozen.body), /Duas histórias na tela/, "o link publicado não segue o rascunho");
  assert.doesNotMatch(JSON.stringify(stillFrozen.body), /Manchete só no rascunho/);

  // Re-publicar sem rotacionar mantém o mesmo link e não devolve token novo.
  const republishSame = await call("POST", `/api/challenges/${challengeId}/results/publish`, { session: owner, body: {} });
  assert.equal((republishSame.body as { shareToken: string | null }).shareToken, null, "re-publicar não entrega um token novo");
  assert.equal((republishSame.body as { url: string | null }).url, null);
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
      title: "Cine clube do mês", startsOn: "2026-09-01", endsOn: "2026-09-30", submissionMode: "item",
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

  const published = await call("POST", `/api/challenges/${challengeId}/template`, {
    session: adminSession,
    body: { summary: "Um cine clube pronto para começar." },
  });
  assert.equal(published.response.status, 200, JSON.stringify(published.body));
  assert.equal((published.body as { publishedAsTemplate: boolean }).publishedAsTemplate, true);

  const gallery = await call("GET", "/api/templates");
  assert.equal(gallery.response.status, 200);
  const listed = (gallery.body as { templates: Array<{ id: string; summary: string; itemCount: number }> }).templates;
  const mine = listed.find((entry) => entry.id === challengeId);
  assert.ok(mine, "o modelo publicado aparece na galeria pública");
  assert.equal(mine?.summary, "Um cine clube pronto para começar.");
  assert.equal(mine?.itemCount, 2);

  const detail = await call("GET", `/api/templates/${challengeId}`);
  assert.equal(detail.response.status, 200, JSON.stringify(detail.body));
  const detailBody = detail.body as Record<string, unknown>;
  assert.equal(detailBody.title, "Cine clube do mês");
  assert.ok(Array.isArray(detailBody.fields) && (detailBody.fields as unknown[]).length === 1);
  assert.ok(!("participants" in detailBody), "o detalhe público não expõe participantes");
  assert.ok(!("result" in detailBody), "o detalhe público não expõe resultados");

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

test("e-mail, login por e-mail, conta e redefinição de senha", async () => {
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
  assert.equal((await call("POST", "/api/auth/login", { body: { username: "carla_email", password: "uma senha segura 123" } })).response.status, 200, "login por usuário");

  // forgot -> pending flag in admin -> admin mints a link
  assert.equal((await call("POST", "/api/auth/forgot", { body: { email: "carla@example.com" } })).response.status, 202);
  const users = await call("GET", "/api/admin/users", { session: adminSession });
  const carlaRow = (users.body as { users: Array<{ username: string; pendingReset: unknown }> }).users.find((u) => u.username === "carla_email");
  assert.ok(carlaRow?.pendingReset, "reset pendente aparece no painel");
  const carlaId = (users.body as { users: Array<{ id: string; username: string }> }).users.find((u) => u.username === "carla_email")!.id;

  const link = await call("POST", "/api/admin/users/reset-link", { session: adminSession, body: { userId: carlaId } });
  assert.equal(link.response.status, 200, JSON.stringify(link.body));
  const token = new URL((link.body as { url: string }).url).searchParams.get("reset");
  assert.ok(token && token.length >= 40);

  // reset sets a new password, kills old sessions, auto-logs-in
  const reset = await call("POST", "/api/auth/reset", { body: { token, password: "nova senha bem forte 9" } });
  assert.equal(reset.response.status, 200, JSON.stringify(reset.body));
  assert.match(reset.response.headers.get("set-cookie") ?? "", /__Host-goa_session=/);
  assert.equal((await call("POST", "/api/auth/login", { body: { username: "carla_email", password: "uma senha segura 123" } })).response.status, 401, "senha antiga não vale mais");
  const relog = await call("POST", "/api/auth/login", { body: { username: "carla_email", password: "nova senha bem forte 9" } });
  assert.equal(relog.response.status, 200);
  assert.equal((await call("POST", "/api/auth/reset", { body: { token, password: "outra senha qualquer 1" } })).response.status, 400, "token de uso único não repete");
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
    const r = await call("POST", "/api/auth/login", { body: { username: "carla_email", password: "nova senha bem forte 9" } });
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

test("registros podem ser excluídos: pelo autor ou pelo admin, só com o desafio ativo", async () => {
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

  // admin apaga registro de participante e isso vira auditoria
  const ownerEntry = await call("POST", `/api/challenges/${challengeId}/entries`, {
    session: owner, body: { participantId: author.user.id, itemId: items[1].id, values: { nota: 5 } },
  });
  const ownerEntryId = (ownerEntry.body as { id: string }).id;
  assert.equal((await call("DELETE", `/api/entries/${ownerEntryId}`, { session: owner })).response.status, 200);
  const audited = await adminPool.query<{ action: string }>(
    "SELECT action FROM audit_events WHERE entity_type='entry' AND entity_id=$1 AND action='entry.deleted'",
    [ownerEntryId],
  );
  assert.equal(audited.rows.length, 1, "a exclusão administrativa fica na auditoria");

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
  assert.equal(personaRow.value, null, "Persona abaixo do mínimo de amostra (minSample 3) fica sem valor");
  assert.equal(personaRow.sampleSize, 1);

  const surprise = metrics.find((m) => m.operation === "surprise")!;
  const solarisSurprise = surprise.series!.find((s) => s.label === "Solaris")!;
  assert.ok(solarisSurprise.value !== null && solarisSurprise.value > 0, "Solaris superou a expectativa");

  const bias = metrics.find((m) => m.operation === "indicator_bias")!;
  const anaBias = bias.series!.find((s) => s.label === "Ana");
  assert.ok(anaBias && anaBias.value !== null, "viés do indicador calculado para quem indicou");

  // a vitrine foi gerada sozinha ao encerrar — com resumo, mas sem repetir o
  // título do desafio como manchete (o admin escreve uma se quiser).
  const blocks = await adminPool.query<{ kind: string; heading: string | null }>(
    "SELECT kind, heading FROM result_blocks WHERE challenge_id=$1 ORDER BY position",
    [challengeId],
  );
  assert.ok(!blocks.rows.some((b) => b.heading === "headline"), "nenhuma manchete é gerada automaticamente");
  assert.equal(blocks.rows[0].kind, "text");
  assert.equal(blocks.rows[0].heading, "summary");
  assert.ok(blocks.rows.some((b) => b.kind === "metric"), "vitrine automática tem blocos de métrica");

  // regenerar substitui os blocos
  const regen = await call("POST", `/api/challenges/${challengeId}/results`, { session: owner, body: { regenerate: true } });
  assert.equal(regen.response.status, 200, JSON.stringify(regen.body));
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

test("auditoria de correção de registro guarda só metadados", async () => {
  const owner = await register("Nara", "nara_audit");
  const member = await register("Bruno", "bruno_audit");
  const gid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Auditoria" } })).body as { id: string }).id;
  const inv = (await call("POST", `/api/groups/${gid}/invites`, { session: owner, body: { expiresInDays: 7, maxUses: 1 } })).body as { token: string };
  await call("POST", `/api/invites/${inv.token}`, { session: member, body: {} });

  const created = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner,
    body: {
      recipe: "cinema", title: "Auditável", startsOn: "2026-08-01", endsOn: "2026-12-31",
      participantIds: [owner.user.id, member.user.id], items: [{ title: "Blow-Up" }],
    },
  });
  const challengeId = (created.body as { id: string }).id;
  assert.equal((await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "active" } })).response.status, 200);
  const detail = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    fields: Array<{ id: string; type: string }>; items: Array<{ id: string }>;
  };
  const ratingField = detail.fields.find((entry) => entry.type === "rating")!.id;
  const commentField = detail.fields.find((entry) => entry.type === "text")!.id;
  const itemId = detail.items[0].id;

  const entry = await call("POST", `/api/challenges/${challengeId}/entries`, {
    session: member, body: { itemId, values: { [ratingField]: 3, [commentField]: "texto secreto do participante" } },
  });
  const entryId = (entry.body as { id: string }).id;

  const corrected = await call("PATCH", `/api/entries/${entryId}`, {
    session: owner, body: { values: { [ratingField]: 5, [commentField]: "outro texto secreto" }, reason: "ajuste combinado" },
  });
  assert.equal(corrected.response.status, 200, JSON.stringify(corrected.body));

  const audit = await adminPool.query<{ before: unknown; after: unknown; metadata: { fields?: string[]; reason?: string } }>(
    "SELECT before, after, metadata FROM audit_events WHERE challenge_id=$1 AND action='entry.corrected'", [challengeId]);
  assert.equal(audit.rows[0].before, null, "sem before/after com valores");
  assert.equal(audit.rows[0].after, null);
  assert.deepEqual([...(audit.rows[0].metadata.fields ?? [])].sort(), [commentField, ratingField].sort());
  assert.equal(audit.rows[0].metadata.reason, "ajuste combinado");
  assert.doesNotMatch(JSON.stringify(audit.rows[0]), /texto secreto/, "nenhum conteúdo do participante na auditoria");
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
  // defaults to minSample:3, which would null out both numbers with just one
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
  await call("POST", `/api/challenges/${challengeId}/results`, { session: owner, body: { regenerate: true } });

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

test("blocos organizáveis: o admin reordena e esconde blocos, e os valores ficam congelados", async () => {
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

  const before = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    result: { blocks: Array<{ id: string; kind: string; position: number; visible: boolean; metric?: { value: number | null } }> };
  };
  assert.ok(before.result.blocks.length >= 2, "a vitrine gerada tem blocos");
  const metricBlock = before.result.blocks.find((block) => block.kind === "metric")!;
  const frozenValue = metricBlock.metric?.value ?? null;

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
  assert.equal(after.result.blocks.find((block) => block.kind === "metric")?.metric?.value, frozenValue, "o valor da métrica não mudou");

  // Bloco de outra vitrine é recusado.
  assert.equal((await call("PATCH", `/api/challenges/${challengeId}/results/blocks`, { session: owner, body: { blocks: [{ id: "nao-existe", visible: true }] } })).response.status, 404);
});

test("quem sai do grupo despublica e regenera a vitrine; resultado público e template são conceitos separados", async () => {
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
  await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "closed" } });
  await call("POST", `/api/challenges/${challengeId}/results`, { session: owner, body: { regenerate: true } });
  const pub = await call("POST", `/api/challenges/${challengeId}/results/publish`, { session: owner, body: {} });
  const token = (pub.body as { url: string }).url.split("/results/")[1];
  assert.equal((await call("GET", `/api/results/${token}`)).response.status, 200);

  // O template é outro conceito: publicar um não publica o outro.
  const detailAfterPublish = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as { publishedAsTemplate?: boolean };
  assert.notEqual(detailAfterPublish.publishedAsTemplate, true, "publicar a vitrine não cria template");

  // Vai Embora sai do grupo → o link cai e a vitrine é regenerada.
  assert.equal((await call("POST", `/api/groups/${groupId}/leave`, { session: leaver, body: {} })).response.status, 200);
  assert.equal((await call("GET", `/api/results/${token}`)).response.status, 404, "o link publicado para de funcionar quando alguém sai");
  const reopened = (await call("GET", `/api/challenges/${challengeId}`, { session: owner })).body as {
    result: { publishedAt: string | null; hasPublishedLink?: boolean };
  };
  assert.equal(reopened.result.publishedAt, null, "a publicação foi retirada até a regeneração");

  // O admin republica; um link novo é gerado.
  const republish = await call("POST", `/api/challenges/${challengeId}/results/publish`, { session: owner, body: {} });
  const newToken = (republish.body as { url: string }).url.split("/results/")[1];
  assert.notEqual(newToken, token);
  assert.equal((await call("GET", `/api/results/${newToken}`)).response.status, 200);
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

  // 21. Anonimizar quem sai do grupo (a publicação existente é regenerada anonimamente).
  const pub3 = await call("POST", `/api/challenges/${challengeId}/results/publish`, { session: owner, body: {} });
  const token3 = (pub3.body as { shareToken: string }).shareToken;
  assert.equal((await call("POST", `/api/groups/${groupId}/leave`, { session: members[0], body: {} })).response.status, 200);
  assert.equal((await call("GET", `/api/results/${token3}`)).response.status, 404, "sair do grupo despublica até a regeneração");
  const pub4 = await call("POST", `/api/challenges/${challengeId}/results/publish`, { session: owner, body: {} });
  const afterLeave = (await call("GET", `/api/results/${(pub4.body as { shareToken: string }).shareToken}`)).body as { challenge: { participants: string[] } };
  assert.ok(!afterLeave.challenge.participants.includes("Aceite B"), "o nome de quem saiu não volta na republicação");

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

test("P0: revogar consentimento nominal invalida a vitrine publicada; sair reinicia o consentimento", async () => {
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

  // Bela revoga → o link cai.
  assert.equal((await call("PATCH", `/api/challenges/${challengeId}/consent`, { session: b, body: { nameConsent: false } })).response.status, 200);
  assert.equal((await call("GET", `/api/results/${token}`)).response.status, 404, "revogar consentimento tira o link do ar");

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
