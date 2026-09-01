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

  const originalDraftDetail = await call("GET", `/api/challenges/${challengeId}`, { session: owner });
  assert.equal(originalDraftDetail.response.status, 200, JSON.stringify(originalDraftDetail.body));
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

  const archiveUsedItem = await call("DELETE", `/api/challenges/${challengeId}/items/${originalItemIds[0]}`, {
    session: owner,
  });
  assert.equal(archiveUsedItem.response.status, 409, "item com registro não pode ser removido");
  assert.equal((archiveUsedItem.body as { error: string }).error, "item_has_data");

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

  // O link é recuperável: o detalhe do desafio traz o mesmo token.
  const detailWithToken = await call("GET", `/api/challenges/${challengeId}`, { session: owner });
  assert.equal((detailWithToken.body as { result: { shareToken: string } }).result.shareToken, shareToken);

  // Snapshot congelado: salvar rascunho de novo não muda a vitrine pública.
  await call("POST", `/api/challenges/${challengeId}/results`, {
    session: owner,
    body: { headline: "Manchete só no rascunho", summary: "x", metricIds: [], comments: [] },
  });
  const stillFrozen = await call("GET", `/api/results/${shareToken}`);
  assert.match(JSON.stringify(stillFrozen.body), /Duas histórias na tela/, "o link publicado não segue o rascunho");
  assert.doesNotMatch(JSON.stringify(stillFrozen.body), /Manchete só no rascunho/);

  // "Gerar novo link" invalida o token antigo.
  const rotated = await call("POST", `/api/challenges/${challengeId}/results/publish`, {
    session: owner, body: { rotateLink: true },
  });
  const rotatedToken = (rotated.body as { shareToken: string }).shareToken;
  assert.notEqual(rotatedToken, shareToken);
  assert.equal((await call("GET", `/api/results/${shareToken}`)).response.status, 404, "o link antigo para de funcionar");
  assert.equal((await call("GET", `/api/results/${rotatedToken}`)).response.status, 200);

  // Anonimização: marca a opção, republica, e os nomes somem — inclusive das séries por pessoa.
  await call("POST", `/api/challenges/${challengeId}/results`, {
    session: owner,
    body: { headline: "Duas histórias na tela", summary: "s", metricIds: finalMetrics.map((m) => m.id), comments: [], anonymizeParticipants: true },
  });
  const anonToken = ((await call("POST", `/api/challenges/${challengeId}/results/publish`, {
    session: owner, body: {},
  })).body as { shareToken: string }).shareToken;
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
  assert.notEqual((republished.body as { shareToken: string }).shareToken, anonToken, "re-publicar gera um link novo");

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

  const dailyDraft = await call("POST", `/api/groups/${groupId}/challenges`, {
    session: owner,
    body: {
      template: "reading",
      title: "Leitura diária",
      startsOn: "2026-07-01",
      endsOn: "2026-07-03",
      submissionMode: "daily",
      generateDaily: false,
      participantIds: [owner.user.id],
      fields: [{ key: "nota_do_dia", label: "Nota do dia", type: "text", required: true, config: { multiline: true, maxLength: 300 } }],
    },
  });
  assert.equal(dailyDraft.response.status, 201, JSON.stringify(dailyDraft.body));
  const dailyId = (dailyDraft.body as { id: string }).id;

  const incompleteDaily = await call("POST", `/api/challenges/${dailyId}/transition`, {
    session: owner, body: { status: "active" },
  });
  assert.equal(incompleteDaily.response.status, 409, "daily sem checkpoints não pode ser ativado");

  const wrongModeGeneration = await call("POST", `/api/challenges/${duplicateId}/items`, {
    session: owner,
    body: { generate: { frequency: "daily", startsOn: "2026-08-01", endsOn: "2026-08-02" } },
  });
  assert.equal(wrongModeGeneration.response.status, 409, "desafio por item não aceita gerador diário");

  const generated = await call("POST", `/api/challenges/${dailyId}/items`, {
    session: owner,
    body: { generate: { frequency: "daily", startsOn: "2026-07-01", endsOn: "2026-07-03" } },
  });
  assert.equal(generated.response.status, 201, JSON.stringify(generated.body));
  const generatedCheckpointIds = (generated.body as { checkpointIds: string[] }).checkpointIds;
  assert.equal(generatedCheckpointIds.length, 3);

  const checkpointEdit = await call(
    "PATCH",
    `/api/challenges/${dailyId}/items/${generatedCheckpointIds[0]}`,
    {
      session: owner,
      body: { title: "Abertura da leitura", description: "Primeiro encontro do diário." },
    },
  );
  assert.equal(checkpointEdit.response.status, 200, JSON.stringify(checkpointEdit.body));
  assert.deepEqual(checkpointEdit.body, {
    id: generatedCheckpointIds[0],
    title: "Abertura da leitura",
    description: "Primeiro encontro do diário.",
  });

  const rescheduled = await call("PATCH", `/api/challenges/${dailyId}`, {
    session: owner, body: { startsOn: "2026-07-01", endsOn: "2026-07-02" },
  });
  assert.equal(rescheduled.response.status, 200, JSON.stringify(rescheduled.body));
  const dailyDetail = await call("GET", `/api/challenges/${dailyId}`, { session: owner });
  assert.equal(dailyDetail.response.status, 200, JSON.stringify(dailyDetail.body));
  const dailyChallenge = dailyDetail.body as {
    fields: Array<{ id: string; config: { multiline?: boolean } }>;
    items: Array<{ id: string; title: string; status: string }>;
  };
  assert.equal(dailyChallenge.items.length, 2, "regeneração deve arquivar checkpoints excedentes");
  assert.equal(dailyChallenge.items[0].id, generatedCheckpointIds[0], "reagendar deve preservar o ID do checkpoint");
  assert.equal(dailyChallenge.items[0].title, "Abertura da leitura", "reagendar deve preservar o título personalizado");
  assert.equal(dailyChallenge.fields[0].config.multiline, true, "texto longo deve sobreviver ao round-trip");

  const activateDaily = await call("POST", `/api/challenges/${dailyId}/transition`, {
    session: owner, body: { status: "active" },
  });
  assert.equal(activateDaily.response.status, 200, JSON.stringify(activateDaily.body));
  const activeCheckpointEdit = await call(
    "PATCH",
    `/api/challenges/${dailyId}/items/${dailyChallenge.items[0].id}`,
    {
      session: owner,
      body: { title: "Abertura concluída", description: "Título corrigido com o desafio ativo." },
    },
  );
  assert.equal(activeCheckpointEdit.response.status, 200, JSON.stringify(activeCheckpointEdit.body));
  assert.equal((activeCheckpointEdit.body as { id: string }).id, dailyChallenge.items[0].id);
  const dailyEntry = await call("POST", `/api/challenges/${dailyId}/entries`, {
    session: owner,
    body: { checkpointId: dailyChallenge.items[0].id, values: { [dailyChallenge.fields[0].id]: "canario-diario" } },
  });
  assert.equal(dailyEntry.response.status, 201, JSON.stringify(dailyEntry.body));
  const dailyEntryId = (dailyEntry.body as { id: string }).id;
  const dailyCsv = await call("GET", `/api/challenges/${dailyId}/export.csv`, { session: owner });
  assert.equal(dailyCsv.response.status, 200);
  assert.match(dailyCsv.body as string, /Abertura concluída/);

  const dailyExtend = await call("PATCH", `/api/challenges/${dailyId}`, {
    session: owner, body: { startsOn: "2026-07-01", endsOn: "2026-07-05" },
  });
  assert.equal(dailyExtend.response.status, 200, JSON.stringify(dailyExtend.body));
  const dailyAfterExtend = await call("GET", `/api/challenges/${dailyId}`, { session: owner });
  const extendedItems = (dailyAfterExtend.body as { items: Array<{ id: string; title: string }> }).items;
  assert.equal(extendedItems.length, 5, "estender o período de um diário ativo materializa os novos dias");
  assert.equal(extendedItems[0].id, dailyChallenge.items[0].id, "estender preserva o ID do checkpoint com check-in");
  assert.equal(extendedItems[0].title, "Abertura concluída", "estender preserva o título personalizado");

  const dailyShiftAwayFromEntry = await call("PATCH", `/api/challenges/${dailyId}`, {
    session: owner, body: { startsOn: "2026-07-02", endsOn: "2026-07-05" },
  });
  assert.equal(dailyShiftAwayFromEntry.response.status, 409, "remarcar por cima de um check-in é barrado");
  assert.equal((dailyShiftAwayFromEntry.body as { error: string }).error, "schedule_would_strand_entries");

  const dailyDropSchedule = await call("PATCH", `/api/challenges/${dailyId}`, {
    session: owner, body: { startsOn: null, endsOn: null },
  });
  assert.equal(dailyDropSchedule.response.status, 409, "tirar o período de um diário com check-ins é barrado");
  assert.equal((dailyDropSchedule.body as { error: string }).error, "schedule_would_strand_entries");

  const dailyShrinkBack = await call("PATCH", `/api/challenges/${dailyId}`, {
    session: owner, body: { startsOn: "2026-07-01", endsOn: "2026-07-02" },
  });
  assert.equal(dailyShrinkBack.response.status, 200, "encurtar é permitido quando os dias removidos estão vazios");
  const dailyAfterShrink = await call("GET", `/api/challenges/${dailyId}`, { session: owner });
  assert.equal(
    (dailyAfterShrink.body as { items: unknown[] }).items.length,
    2,
    "os dias vazios fora do novo período são arquivados",
  );

  const closeDaily = await call("POST", `/api/challenges/${dailyId}/transition`, {
    session: owner, body: { status: "closed" },
  });
  assert.equal(closeDaily.response.status, 200, JSON.stringify(closeDaily.body));
  const closedCheckpointEdit = await call(
    "PATCH",
    `/api/challenges/${dailyId}/items/${dailyChallenge.items[0].id}`,
    { session: owner, body: { title: "Não pode mudar depois do encerramento" } },
  );
  assert.equal(closedCheckpointEdit.response.status, 409, "checkpoint encerrado deve preservar sua leitura histórica");
  const dailyResult = await call("POST", `/api/challenges/${dailyId}/results`, {
    session: owner,
    body: { headline: "Diário concluído", comments: [{ entryId: dailyEntryId, fieldId: dailyChallenge.fields[0].id }] },
  });
  assert.equal(dailyResult.response.status, 200, JSON.stringify(dailyResult.body));
  const curatedDaily = await call("GET", `/api/challenges/${dailyId}`, { session: owner });
  assert.match(JSON.stringify(curatedDaily.body), /Abertura concluída/, "curadoria diária deve preservar o título do checkpoint");

  const readingCopy = await call("POST", `/api/challenges/${dailyId}/duplicate`, {
    session: owner,
    body: { title: "Leitura diária — outro grupo", targetGroupId },
  });
  assert.equal(readingCopy.response.status, 201, JSON.stringify(readingCopy.body));
  const readingCopyId = (readingCopy.body as { id: string }).id;
  const copiedReading = await adminPool.query<{
    group_id: string; mode: string; recipe_key: string | null; start_date: string | null;
    checkpoints: number; participants: number; entries: number;
  }>(
    `SELECT c.group_id, c.recipe_key, c.start_date::text AS start_date,
            (SELECT submission_mode FROM entry_types WHERE challenge_id=c.id AND archived_at IS NULL LIMIT 1) AS mode,
            (SELECT count(*)::int FROM challenge_checkpoints WHERE challenge_id=c.id AND archived_at IS NULL) AS checkpoints,
            (SELECT count(*)::int FROM challenge_participants WHERE challenge_id=c.id) AS participants,
            (SELECT count(*)::int FROM entries WHERE challenge_id=c.id) AS entries
       FROM challenges c WHERE c.id=$1`,
    [readingCopyId],
  );
  assert.deepEqual(copiedReading.rows[0], {
    group_id: targetGroupId,
    mode: "daily",
    recipe_key: "reading_daily",
    // The copy starts undated: the schedule is relative, so checkpoints regenerate
    // when the admin picks new dates.
    start_date: null,
    checkpoints: 0,
    participants: 0,
    entries: 0,
  }, "um desafio de leitura pode ser reutilizado estruturalmente em outro grupo");

  const futureDaily = await call("POST", `/api/groups/${groupId}/challenges`, {
    session: owner,
    body: {
      template: "reading", title: "Leitura futura", startsOn: "2099-01-01", endsOn: "2099-01-02",
      submissionMode: "daily", participantIds: [owner.user.id],
      fields: [{ key: "paginas", label: "Páginas", type: "number", required: true, config: { min: 0, step: 1 } }],
    },
  });
  assert.equal(futureDaily.response.status, 201, JSON.stringify(futureDaily.body));
  const futureDailyId = (futureDaily.body as { id: string }).id;
  const futureActivation = await call("POST", `/api/challenges/${futureDailyId}/transition`, {
    session: owner, body: { status: "active" },
  });
  assert.equal(futureActivation.response.status, 200, JSON.stringify(futureActivation.body));
  const futureDetail = await call("GET", `/api/challenges/${futureDailyId}`, { session: owner });
  const futureChallenge = futureDetail.body as { fields: Array<{ id: string }>; items: Array<{ id: string; status: string }> };
  assert.equal(futureChallenge.items[0].status, "scheduled");
  const futureSubmission = await call("POST", `/api/challenges/${futureDailyId}/entries`, {
    session: owner,
    body: { checkpointId: futureChallenge.items[0].id, values: { [futureChallenge.fields[0].id]: 10 } },
  });
  assert.equal(futureSubmission.response.status, 409, "checkpoint futuro não pode receber registro");

  const undatedItem = await call("POST", `/api/groups/${groupId}/challenges`, {
    session: owner,
    body: {
      template: "cine",
      title: "Lista contínua sem prazo",
      startsOn: null,
      endsOn: null,
      submissionMode: "item",
      participantIds: [owner.user.id],
      items: [{ title: "Tarefa sem vencimento" }],
      fields: [{ key: "concluida", label: "Concluída", type: "boolean", required: true }],
    },
  });
  assert.equal(undatedItem.response.status, 201, JSON.stringify(undatedItem.body));
  const undatedItemId = (undatedItem.body as { id: string }).id;
  const undatedItemDetail = await call("GET", `/api/challenges/${undatedItemId}`, { session: owner });
  assert.equal(undatedItemDetail.response.status, 200, JSON.stringify(undatedItemDetail.body));
  assert.equal((undatedItemDetail.body as { startsOn: string | null }).startsOn, null);
  assert.equal((undatedItemDetail.body as { endsOn: string | null }).endsOn, null);

  const undatedDaily = await call("POST", `/api/groups/${groupId}/challenges`, {
    session: owner,
    body: {
      template: "reading",
      title: "Hábito diário sem prazo",
      startsOn: null,
      endsOn: null,
      submissionMode: "daily",
      participantIds: [owner.user.id],
      fields: [{ key: "nota", label: "Nota do dia", type: "text", required: true }],
    },
  });
  assert.equal(undatedDaily.response.status, 201, JSON.stringify(undatedDaily.body));
  const undatedDailyId = (undatedDaily.body as { id: string }).id;
  const undatedDailyDetail = await call("GET", `/api/challenges/${undatedDailyId}`, { session: owner });
  assert.equal(undatedDailyDetail.response.status, 200, JSON.stringify(undatedDailyDetail.body));
  const undatedDailyChallenge = undatedDailyDetail.body as {
    startsOn: string | null;
    endsOn: string | null;
    fields: Array<{ id: string }>;
    items: unknown[];
  };
  assert.equal(undatedDailyChallenge.startsOn, null);
  assert.equal(undatedDailyChallenge.endsOn, null);
  assert.deepEqual(undatedDailyChallenge.items, [], "daily sem prazo não materializa checkpoints futuros");
  assert.ok(undatedDailyChallenge.fields[0]?.id);

  const activateUndatedDaily = await call("POST", `/api/challenges/${undatedDailyId}/transition`, {
    session: owner,
    body: { status: "active" },
  });
  assert.equal(activateUndatedDaily.response.status, 200, JSON.stringify(activateUndatedDaily.body));

  const historicalDay = "2020-01-02";
  const firstUndatedCheckIn = await call("POST", `/api/challenges/${undatedDailyId}/entries`, {
    session: owner,
    body: {
      occurredOn: historicalDay,
      values: { [undatedDailyChallenge.fields[0].id]: "registro original" },
    },
  });
  assert.equal(firstUndatedCheckIn.response.status, 201, JSON.stringify(firstUndatedCheckIn.body));
  const firstUndatedEntry = firstUndatedCheckIn.body as {
    id: string;
    occurredOn: string;
    updated: boolean;
  };
  assert.equal(firstUndatedEntry.occurredOn, historicalDay);
  assert.equal(firstUndatedEntry.updated, false);

  const repeatedUndatedCheckIn = await call("POST", `/api/challenges/${undatedDailyId}/entries`, {
    session: owner,
    body: {
      occurredOn: historicalDay,
      values: { [undatedDailyChallenge.fields[0].id]: "registro corrigido" },
    },
  });
  assert.equal(repeatedUndatedCheckIn.response.status, 201, JSON.stringify(repeatedUndatedCheckIn.body));
  const repeatedUndatedEntry = repeatedUndatedCheckIn.body as {
    id: string;
    occurredOn: string;
    updated: boolean;
  };
  assert.equal(repeatedUndatedEntry.id, firstUndatedEntry.id, "o mesmo dia deve atualizar o registro existente");
  assert.equal(repeatedUndatedEntry.occurredOn, historicalDay);
  assert.equal(repeatedUndatedEntry.updated, true);

  const undatedEntries = await call("GET", `/api/challenges/${undatedDailyId}/entries`, { session: owner });
  assert.equal(undatedEntries.response.status, 200, JSON.stringify(undatedEntries.body));
  const entriesForUndatedDaily = (undatedEntries.body as {
    entries: Array<{ id: string; occurredOn: string; values: Record<string, unknown> }>;
  }).entries;
  assert.equal(entriesForUndatedDaily.length, 1, "repetir a data não deve duplicar o check-in");
  assert.equal(entriesForUndatedDaily[0]?.id, firstUndatedEntry.id);
  assert.equal(entriesForUndatedDaily[0]?.occurredOn, historicalDay);
  assert.equal(entriesForUndatedDaily[0]?.values[undatedDailyChallenge.fields[0].id], "registro corrigido");

  const futureUndatedCheckIn = await call("POST", `/api/challenges/${undatedDailyId}/entries`, {
    session: owner,
    body: {
      occurredOn: "2099-01-01",
      values: { [undatedDailyChallenge.fields[0].id]: "não deve entrar" },
    },
  });
  assert.equal(futureUndatedCheckIn.response.status, 409, "daily sem prazo não aceita check-in futuro");
  assert.equal((futureUndatedCheckIn.body as { error: string }).error, "checkin_in_future");

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

  await adminPool.query("UPDATE groups SET deleted_at = now(), deleted_by_user_id = $1 WHERE id = $2", [owner.user.id, groupIds[5]]);
  const afterTrash = await call("POST", "/api/groups", { session: owner, body: { name: "Grupo pós-lixeira" } });
  assert.equal(afterTrash.response.status, 201, "apagar um grupo deve liberar espaço no limite");

  const bootstrapAfter = await call("GET", "/api/bootstrap", { session: owner });
  const visibleGroups = (bootstrapAfter.body as { groups: Array<{ id: string }> }).groups.map((group) => group.id);
  assert.ok(!visibleGroups.includes(groupIds[5]), "grupo na lixeira não aparece no bootstrap");
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

test("área de administração: acesso, painel, lixeira e contas", async () => {
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

  // trash + purge round-trip
  const group = await call("POST", "/api/groups", { session: member, body: { name: "Para purgar" } });
  const groupId = (group.body as { id: string }).id;
  await call("DELETE", `/api/groups/${groupId}`, { session: member });
  const trash = await call("GET", "/api/admin/trash", { session: adminSession });
  const trashed = (trash.body as { items: Array<{ kind: string; id: string }> }).items;
  assert.ok(trashed.some((item) => item.kind === "group" && item.id === groupId), "grupo aparece na lixeira");

  const purge = await call("POST", "/api/admin/trash/purge", { session: adminSession, body: { kind: "group", id: groupId } });
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

  // remoção da conta: bloqueada enquanto há grupo com outra pessoa
  const blocked = await call("DELETE", "/api/account", { session: host });
  assert.equal(blocked.response.status, 409, "não apaga a conta com um grupo compartilhado");
  assert.equal((blocked.body as { error: string }).error, "owns_groups");

  // depois de apagar o grupo compartilhado, a remoção passa
  assert.equal((await call("DELETE", `/api/groups/${sharedGroupId}`, { session: host })).response.status, 200);
  const removed = await call("DELETE", "/api/account", { session: host });
  assert.equal(removed.response.status, 200, JSON.stringify(removed.body));
  assert.match(removed.response.headers.get("set-cookie") ?? "", /__Host-goa_session=;|Max-Age=0/i);
  assert.equal((await call("GET", "/api/bootstrap", { session: host })).response.status, 200);
  assert.equal(
    (await call("POST", "/api/feedback", { session: host, body: { area: "a", goal: "b", impact: "minor" } })).response.status,
    201,
    "a sessão foi revogada, mas o feedback anônimo ainda funciona",
  );
  const soloGone = await adminPool.query<{ deleted_at: Date | null }>("SELECT deleted_at FROM groups WHERE id=$1", [soloGroupId]);
  assert.ok(soloGone.rows[0]?.deleted_at, "grupos solo vão para a lixeira ao apagar a conta");
});

test("fase 1a: acervo do grupo, identidade do filme entre rodadas e indicador", async () => {
  const owner = await register("Clara", "clara_cat");
  const friend = await register("Dan", "dan_cat");
  const groupId = (await call("POST", "/api/groups", { session: owner, body: { name: "Cineclube" } })).body as { id: string };
  const gid = groupId.id;
  const invite = await call("POST", `/api/groups/${gid}/invites`, { session: owner, body: { expiresInDays: 7, maxUses: 1 } });
  await call("POST", `/api/invites/${(invite.body as { token: string }).token}`, { session: friend, body: {} });

  const first = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner,
    body: {
      template: "cine", title: "Rodada 1", submissionMode: "item",
      participantIds: [owner.user.id, friend.user.id],
      fields: [{ key: "nota", label: "Nota", type: "rating", required: true }],
      items: [
        { title: "Aftersun", recommendedByUserId: friend.user.id, year: 2022, genres: ["drama"] },
        { title: "  perfect days ", year: 2023 },
      ],
    },
  });
  assert.equal(first.response.status, 201, JSON.stringify(first.body));
  const firstId = (first.body as { id: string }).id;

  const catalog = await call("GET", `/api/groups/${gid}/catalog`, { session: friend });
  assert.equal(catalog.response.status, 200);
  const catalogItems = (catalog.body as { items: Array<{ id: string; title: string; year: number | null; genres: string[]; roundCount: number }> }).items;
  assert.equal(catalogItems.length, 2, "dois filmes no acervo");
  const aftersun = catalogItems.find((item) => item.title === "Aftersun");
  assert.ok(aftersun);
  assert.equal(aftersun.year, 2022);
  assert.deepEqual(aftersun.genres, ["drama"]);

  const detail = await call("GET", `/api/challenges/${firstId}`, { session: owner });
  const items = (detail.body as { items: Array<{ title: string; catalogItem: { id: string; year: number | null } | null; recommendedBy: { name: string } | null }> }).items;
  assert.equal(items[0].recommendedBy?.name, "Dan");
  assert.equal(items[0].catalogItem?.id, aftersun.id);

  // segunda rodada reusa o mesmo filme por título → mesma identidade no acervo
  const second = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner,
    body: {
      template: "cine", title: "Rodada 2", submissionMode: "item",
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

  // editar atributos no acervo
  const patched = await call("PATCH", `/api/catalog/${aftersun.id}`, { session: owner, body: { runtimeMinutes: 96, genres: ["drama", "coming of age"] } });
  assert.equal(patched.response.status, 200, JSON.stringify(patched.body));
  const afterPatch = await call("GET", `/api/challenges/${firstId}`, { session: owner });
  assert.deepEqual((afterPatch.body as { items: Array<{ catalogItem: { genres: string[]; runtimeMinutes: number | null } | null }> }).items[0].catalogItem?.genres, ["coming of age", "drama"]);

  // ano desambigua: "Dune" (1984) e "Dune" (2021) são dois itens
  const dune = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner,
    body: {
      template: "cine", title: "Duna", submissionMode: "item",
      participantIds: [owner.user.id],
      fields: [{ key: "nota", label: "Nota", type: "rating", required: true }],
      items: [{ title: "Dune", year: 1984 }, { title: "Dune", year: 2021 }],
    },
  });
  assert.equal(dune.response.status, 201, JSON.stringify(dune.body));
  const duneCatalog = (await call("GET", `/api/groups/${gid}/catalog`, { session: owner })).body as { items: Array<{ title: string; year: number | null }> };
  assert.equal(duneCatalog.items.filter((item) => item.title === "Dune").length, 2, "Dune 1984 e Dune 2021 não fundem");

  // indicador precisa ser membro do grupo
  const badRecommender = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner,
    body: {
      template: "cine", title: "Rodada ruim", submissionMode: "item",
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
      template: "cine", title: "Curadoria", submissionMode: "item",
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

test("data do registro é opcional: uma rodada aceita registro sem data, mas o diário não", async () => {
  const owner = await register("Nina", "nina_semdata");
  const gid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Sem data" } })).body as { id: string }).id;
  const today = dateKeyInTimeZone(new Date(), "America/Sao_Paulo");

  const challenge = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner,
    body: {
      template: "cine", title: "Cine livre", submissionMode: "item",
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

  // um tipo diário (once_per_day) ignora o "sem data" e cai no hoje
  const daily = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner,
    body: {
      template: "reading", title: "Hábito", startsOn: null, endsOn: null,
      submissionMode: "daily", participantIds: [owner.user.id],
      fields: [{ key: "linha", label: "Linha do dia", type: "text", required: true }],
    },
  });
  const dailyId = (daily.body as { id: string }).id;
  assert.equal((await call("POST", `/api/challenges/${dailyId}/transition`, { session: owner, body: { status: "active" } })).response.status, 200);
  const dailyField = ((await call("GET", `/api/challenges/${dailyId}`, { session: owner })).body as { fields: Array<{ id: string }> }).fields[0].id;
  const dailyEntry = await call("POST", `/api/challenges/${dailyId}/entries`, {
    session: owner, body: { occurredOn: null, values: { [dailyField]: "oi" } },
  });
  assert.equal(dailyEntry.response.status, 201, JSON.stringify(dailyEntry.body));
  assert.equal((dailyEntry.body as { occurredOn: string }).occurredOn, today);
});

test("fundação: dois livros no mesmo dia, conclusão e nota sem comentário", async () => {
  const owner = await register("Lúcia", "lucia_found");
  const gid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Clube de leitura" } })).body as { id: string }).id;

  // livro sem autor é recusado — autor é obrigatório para o clube de leitura
  const noAuthor = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner,
    body: {
      recipe: "reading_club", title: "Sem autor", participantIds: [owner.user.id],
      items: [{ title: "Norwegian Wood" }],
    },
  });
  assert.equal(noAuthor.response.status, 400, "livro precisa de autor");

  const created = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner,
    body: {
      recipe: "reading_club", title: "Temporada 1", participantIds: [owner.user.id],
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

test("Cine Curadoria: expectativa e avaliação coexistem, e a expectativa trava ao avaliar", async () => {
  const owner = await register("Théo", "theo_cur");
  const gid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Curadoria" } })).body as { id: string }).id;

  const created = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner,
    body: {
      recipe: "cine_curated", title: "Ciclo Lynch", participantIds: [owner.user.id],
      items: [{ title: "Mulholland Drive" }],
    },
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  const challengeId = (created.body as { id: string }).id;
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
      recipe: "cine_curated", title: "Sessão", participantIds: [owner.user.id],
      items: [{ title: "Stalker", year: 1979, genres: ["ficção científica"] }],
    },
  });
  const sourceId = (created.body as { id: string }).id;

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
  assert.equal(row.rows[0].recipe_key, "cine_curated");
  assert.equal(row.rows[0].start_date, null);
  assert.equal(row.rows[0].checkpoints, 0);
  assert.deepEqual(row.rows[0].purposes, ["expectation", "rating"]);
  assert.equal(row.rows[0].catalog_group, target, "o item aponta para o acervo do grupo de destino");
  assert.equal(row.rows[0].catalog_title, "Stalker");
  assert.equal(row.rows[0].recommender, null, "o indicador do grupo de origem não é copiado");
});

type SeriesRow = { key: string; label: string; value: number | null; sampleSize: number };
type ApiMetric = { id: string; label: string; operation: string; groupBy: string; value: number | null; series?: SeriesRow[] };

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
      recipe: "cine_curated", title: "Ciclo 1",
      participantIds: [owner.user.id, bob.user.id, carol.user.id],
      items: [
        { title: "Solaris", recommendedByUserId: owner.user.id },
        { title: "Persona" },
      ],
    },
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  const challengeId = (created.body as { id: string }).id;
  assert.equal((await call("POST", `/api/challenges/${challengeId}/transition`, { session: owner, body: { status: "active" } })).response.status, 200);

  const detail0 = await call("GET", `/api/challenges/${challengeId}`, { session: owner });
  const types = (detail0.body as { entryTypes: Array<{ id: string; purpose: string }> }).entryTypes;
  const items = (detail0.body as { items: Array<{ id: string; title: string }> }).items;
  const expType = types.find((t) => t.purpose === "expectation")!.id;
  const ratingType = types.find((t) => t.purpose === "rating")!.id;
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

  // a vitrine foi gerada sozinha ao encerrar
  const blocks = await adminPool.query<{ kind: string; heading: string | null }>(
    "SELECT kind, heading FROM result_blocks WHERE challenge_id=$1 ORDER BY position",
    [challengeId],
  );
  assert.equal(blocks.rows[0].kind, "text");
  assert.equal(blocks.rows[0].heading, "headline");
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
      body: { recipe: "cine_free", title, participantIds: [owner.user.id], items: [{ title: "Stalker", year: 1979 }] },
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

test("item + checkpoint são ortogonais: um registro carrega filme e sessão", async () => {
  const owner = await register("Ícaro", "icaro_ortho");
  const gid = ((await call("POST", "/api/groups", { session: owner, body: { name: "Sessões" } })).body as { id: string }).id;

  // reading_daily materializa checkpoints; ajustamos o tipo à mão para exigir
  // também um item (nenhuma receita do wizard produz essa combinação ainda).
  const created = await call("POST", `/api/groups/${gid}/challenges`, {
    session: owner,
    body: {
      recipe: "reading_daily", title: "Ciclo de sessões",
      startsOn: "2024-03-01", endsOn: "2024-03-03",
      participantIds: [owner.user.id],
      fields: [{ key: "nota", label: "Nota", type: "rating", required: true }],
    },
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  const challengeId = (created.body as { id: string }).id;

  const checkpointRows = await adminPool.query<{ id: string }>(
    "SELECT id FROM challenge_checkpoints WHERE challenge_id=$1 ORDER BY position", [challengeId]);
  const sessionId = checkpointRows.rows[0].id;
  await adminPool.query("UPDATE entry_types SET target_policy='required' WHERE challenge_id=$1", [challengeId]);
  const itemId = crypto.randomUUID();
  await adminPool.query(
    `INSERT INTO challenge_items (id, challenge_id, checkpoint_id, semantic_key, title, position, metadata, created_at, updated_at)
     VALUES ($1,$2,$3,'sessao_1','Solaris',0,'{}'::jsonb,now(),now())`,
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
    body: { recipe: "cine_free", title: "Auditável", participantIds: [owner.user.id, member.user.id], items: [{ title: "Blow-Up" }] },
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

test("desafio pessoal: workspace criado sob demanda, invisível como grupo e reusado", async () => {
  const owner = await register("Solange", "sol_personal");

  const before = await call("GET", "/api/bootstrap", { session: owner });
  assert.equal((before.body as { personalWorkspaceId: string | null }).personalWorkspaceId, null);
  const groupsBefore = (before.body as { groups: Array<{ id: string }> }).groups.length;

  const first = await call("POST", "/api/personal/challenges", {
    session: owner,
    body: { recipe: "cine_free", title: "Minha maratona", items: [{ title: "Stalker", year: 1979 }] },
  });
  assert.equal(first.response.status, 201, JSON.stringify(first.body));
  const firstId = (first.body as { id: string }).id;

  const after = await call("GET", "/api/bootstrap", { session: owner });
  const workspaceId = (after.body as { personalWorkspaceId: string | null }).personalWorkspaceId;
  assert.ok(workspaceId, "workspace pessoal existe depois do primeiro desafio");
  const groups = (after.body as { groups: Array<{ id: string; kind?: string }> }).groups;
  assert.equal(groups.length, groupsBefore + 1);
  assert.equal(groups.find((group) => group.id === workspaceId)?.kind, "personal");
  const challenges = (after.body as { challenges: Array<{ id: string; groupId: string }> }).challenges;
  assert.equal(challenges.find((challenge) => challenge.id === firstId)?.groupId, workspaceId);

  // segundo desafio pessoal reusa o mesmo workspace
  const second = await call("POST", "/api/personal/challenges", {
    session: owner,
    body: { recipe: "reading_daily", title: "90 dias", startsOn: "2024-01-01", endsOn: "2024-01-30" },
  });
  assert.equal(second.response.status, 201, JSON.stringify(second.body));
  const afterSecond = await call("GET", "/api/bootstrap", { session: owner });
  assert.equal((afterSecond.body as { personalWorkspaceId: string }).personalWorkspaceId, workspaceId);
  assert.equal((afterSecond.body as { groups: unknown[] }).groups.length, groupsBefore + 1, "sem grupo novo");

  // o workspace pessoal não conta contra o limite de grupos do dono
  for (let index = 0; index < 6; index += 1) {
    const group = await call("POST", "/api/groups", { session: owner, body: { name: `Grupo ${index}` } });
    assert.equal(group.response.status, 201, `grupo ${index}: ${JSON.stringify(group.body)}`);
  }
});
