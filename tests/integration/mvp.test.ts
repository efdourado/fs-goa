import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL é obrigatória para o teste de integração.");
process.env.APP_ORIGIN = "http://goa.test";

const { DELETE, GET, PATCH, POST } = await import("../../app/api/[...path]/route");
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

  const challengeResponse = await call("POST", `/api/groups/${groupId}/challenges`, {
    session: owner,
    body: {
      template: "cine",
      title: "Cine — 2 filmes",
      description: "Piloto de cinema",
      rules: "Assistir e avaliar.",
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
  const results = await call("POST", `/api/challenges/${challengeId}/results`, {
    session: owner,
    body: {
      headline: "Duas histórias na tela",
      summary: "Nosso primeiro piloto concluído.",
      metricIds: finalMetrics.map((metric) => metric.id),
      comments: [{ entryId, fieldId: commentId }],
    },
  });
  assert.equal(results.response.status, 200, JSON.stringify(results.body));
  const shareToken = (results.body as { shareToken: string }).shareToken;
  assert.ok(shareToken);
  const showcase = await call("GET", `/api/results/${shareToken}`);
  assert.equal(showcase.response.status, 200, JSON.stringify(showcase.body));
  assert.match(JSON.stringify(showcase.body), /Duas histórias na tela/);

  const crossGroupDuplicate = await call("POST", `/api/challenges/${challengeId}/duplicate`, {
    session: owner, body: { title: "Cópia fora do grupo", targetGroupId: outsiderGroupId },
  });
  assert.equal(crossGroupDuplicate.response.status, 400);

  const duplicate = await call("POST", `/api/challenges/${challengeId}/duplicate`, {
    session: owner, body: { title: "Cine — edição 2" },
  });
  assert.equal(duplicate.response.status, 201, JSON.stringify(duplicate.body));
  const duplicateId = (duplicate.body as { id: string }).id;
  const destination = await adminPool.query<{
    status: string; participants: number; entries: number; values: number; results: number; fields: number; items: number;
  }>(
    `SELECT c.status,
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
    status: "draft", participants: 0, entries: 0, values: 0, results: 0, fields: 2, items: 2,
  });
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

  const sessionDb = await adminPool.query<{ token_hash: string }>("SELECT token_hash FROM sessions LIMIT 1");
  assert.ok(!owner.cookie.includes(sessionDb.rows[0]?.token_hash ?? "impossivel"), "token bruto da sessão não pode estar no banco");
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
