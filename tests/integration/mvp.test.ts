import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL é obrigatória para o teste de integração.");
process.env.APP_ORIGIN = "http://goa.test";

const { GET, PATCH, POST } = await import("../../app/api/[...path]/route");
const adminPool = new pg.Pool({ connectionString: databaseUrl, max: 1 });

type ClientSession = { cookie: string; csrf: string; user: { id: string; name: string; username: string } };

async function call(
  method: "GET" | "POST" | "PATCH",
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
  const response = method === "GET" ? await GET(request) : method === "POST" ? await POST(request) : await PATCH(request);
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

  const hiddenDraft = await call("GET", `/api/challenges/${challengeId}`, { session: participant });
  assert.equal(hiddenDraft.response.status, 404, "participante não pode descobrir rascunho antes da ativação");
  const crossTenant = await call("GET", `/api/challenges/${challengeId}`, { session: outsider });
  assert.equal(crossTenant.response.status, 404, "membro de outro grupo não pode descobrir o desafio");
  const missingCsrf = await call("POST", `/api/challenges/${challengeId}/transition`, {
    session: { ...owner, csrf: "" }, body: { status: "active" }, csrf: false,
  });
  assert.equal(missingCsrf.response.status, 403);

  const activated = await call("POST", `/api/challenges/${challengeId}/transition`, {
    session: owner, body: { status: "active" },
  });
  assert.equal(activated.response.status, 200, JSON.stringify(activated.body));

  const detail = await call("GET", `/api/challenges/${challengeId}`, { session: participant });
  assert.equal(detail.response.status, 200, JSON.stringify(detail.body));
  const challenge = detail.body as {
    fields: Array<{ id: string; key: string }>;
    items: Array<{ id: string; title: string }>;
    metrics: Array<{ id: string }>;
  };
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

  const closed = await call("POST", `/api/challenges/${challengeId}/transition`, {
    session: owner, body: { status: "closed" },
  });
  assert.equal(closed.response.status, 200, JSON.stringify(closed.body));
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
  assert.equal((generated.body as { checkpointIds: string[] }).checkpointIds.length, 3);

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
  assert.equal(dailyChallenge.fields[0].config.multiline, true, "texto longo deve sobreviver ao round-trip");

  const activateDaily = await call("POST", `/api/challenges/${dailyId}/transition`, {
    session: owner, body: { status: "active" },
  });
  assert.equal(activateDaily.response.status, 200, JSON.stringify(activateDaily.body));
  const dailyEntry = await call("POST", `/api/challenges/${dailyId}/entries`, {
    session: owner,
    body: { checkpointId: dailyChallenge.items[0].id, values: { [dailyChallenge.fields[0].id]: "canario-diario" } },
  });
  assert.equal(dailyEntry.response.status, 201, JSON.stringify(dailyEntry.body));
  const dailyEntryId = (dailyEntry.body as { id: string }).id;
  const dailyCsv = await call("GET", `/api/challenges/${dailyId}/export.csv`, { session: owner });
  assert.equal(dailyCsv.response.status, 200);
  assert.match(dailyCsv.body as string, /Dia 1/);

  const closeDaily = await call("POST", `/api/challenges/${dailyId}/transition`, {
    session: owner, body: { status: "closed" },
  });
  assert.equal(closeDaily.response.status, 200, JSON.stringify(closeDaily.body));
  const dailyResult = await call("POST", `/api/challenges/${dailyId}/results`, {
    session: owner,
    body: { headline: "Diário concluído", comments: [{ entryId: dailyEntryId, fieldId: dailyChallenge.fields[0].id }] },
  });
  assert.equal(dailyResult.response.status, 200, JSON.stringify(dailyResult.body));
  const curatedDaily = await call("GET", `/api/challenges/${dailyId}`, { session: owner });
  assert.match(JSON.stringify(curatedDaily.body), /Dia 1/, "curadoria diária deve preservar o título do checkpoint");

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
