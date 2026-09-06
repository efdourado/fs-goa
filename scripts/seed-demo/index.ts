import process from "node:process";

import { createGroup } from "../../lib/goa/domain/groups";
import { createInvite, acceptInvite } from "../../lib/goa/domain/invites";
import { setGroupMemberRole } from "../../lib/goa/domain/groups";
import { ApiError } from "../../lib/http";

import {
  closePool, confirmRemote, DEMO_GROUP_DESCRIPTION, DEMO_GROUP_NAME, fail, findDemoGroup,
  isSeedError, looksRemote, parseArgs, resetDemoGroup, resolveAccounts, sessionFor,
  type DemoRole, type SeedContext,
} from "./runtime";
import { selectScenarios, type ScenarioResult } from "./scenarios";

const ROLES: DemoRole[] = ["owner", "admin", "participant"];
const ORIGIN = (process.env.APP_ORIGIN ?? "http://localhost:3000").replace(/\/$/, "");

function heading(text: string): void {
  console.log(`\n\x1b[1m${text}\x1b[0m`);
}

async function buildGroup(context: Omit<SeedContext, "groupId">): Promise<string> {
  const { session, accounts, log } = context;
  log(`criando o grupo "${DEMO_GROUP_NAME}"`);
  const group = await createGroup(session.owner, {
    name: DEMO_GROUP_NAME,
    description: DEMO_GROUP_DESCRIPTION,
  });
  log("convidando admin e teste");
  const invite = await createInvite(session.owner, group.id, { maxUses: 5, expiresInDays: 7 });
  for (const role of ["admin", "participant"] as const) {
    await acceptInvite(session[role], invite.token);
  }
  await setGroupMemberRole(session.owner, group.id, accounts.admin.id, { role: "admin" });
  return group.id;
}

function printSummary(results: ScenarioResult[]): void {
  heading("Resumo");
  console.log(`Grupo: ${DEMO_GROUP_NAME}`);
  console.log(`Origem: ${ORIGIN}\n`);
  for (const result of results) {
    console.log(`  ${result.label}`);
    console.log(`    gestão:      ${ORIGIN}${result.adminPath}`);
    console.log(`    participante: ${ORIGIN}${result.participantPath}`);
    console.log(`    modelo:      ${ORIGIN}${result.templatePath}`);
    console.log(
      `    resultado:   ${result.publicResultToken ? `${ORIGIN}/results/${result.publicResultToken}` : "(não publicado)"}`,
    );
    console.log(`    contagens:   ${Object.entries(result.counts).map(([k, v]) => `${k}=${v}`).join("  ")}`);
  }
  console.log("\nTodos os dados acima são sintéticos.");
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const scenarios = selectScenarios(options.scenario);

  heading("db:seed-demo");
  console.log(`cenário: ${options.scenario}${options.dryRun ? "  (dry-run)" : ""}${options.reset ? "  --reset" : ""}`);
  console.log(`banco: ${looksRemote() ? "REMOTO (Neon?)" : "local"}`);

  const accounts = await resolveAccounts();
  console.log(
    `contas: ${ROLES.map((role) => `${role}=${accounts[role].username}`).join("  ")}  ✓`,
  );

  const baseContext = {
    options,
    accounts,
    session: Object.fromEntries(
      ROLES.map((role) => [role, sessionFor(accounts[role])]),
    ) as SeedContext["session"],
    log: (message: string) => console.log(`  · ${message}`),
  };

  const existing = await findDemoGroup(accounts.owner.id);

  // --- dry run: validate + print, write nothing --------------------------
  if (options.dryRun) {
    heading("Plano (nada será gravado)");
    if (existing) {
      console.log(
        `Já existe um grupo de demonstração (id ${existing.id}, criado ${existing.created_at.toISOString().slice(0, 10)}, `
        + `${existing.challenges} desafio(s), ${existing.entries} registro(s)). Uma execução real exigiria --reset.`,
      );
    }
    for (const scenario of scenarios) {
      console.log(`\n${scenario.title}`);
      console.log(scenario.plan({ ...baseContext, groupId: "(a criar)" }));
    }
    console.log("\nOK — o dry-run não tocou no banco.");
    return;
  }

  // --- existing group: reset or refuse ----------------------------------
  if (existing) {
    if (!options.reset) {
      fail(
        `Já existe um grupo de demonstração (id ${existing.id}, ${existing.challenges} desafio(s), `
        + `${existing.entries} registro(s)). Rode com --reset para removê-lo e recriar.`,
      );
    }
    heading("Reset");
    console.log(
      `Vai remover em definitivo o grupo ${existing.id} — ${existing.challenges} desafio(s), `
      + `${existing.members} membro(s), ${existing.entries} registro(s).`,
    );
    await confirmRemote("apagar o grupo de demonstração no banco remoto");
    await resetDemoGroup(existing);
    console.log("  · grupo de demonstração removido.");
  } else if (options.reset) {
    console.log("(nada a resetar — nenhum grupo de demonstração existente.)");
  }

  await confirmRemote("gravar o grupo de demonstração no banco remoto");

  // --- build ------------------------------------------------------------
  heading("Construindo");
  const groupId = await buildGroup(baseContext);
  const context: SeedContext = { ...baseContext, groupId };

  const results: ScenarioResult[] = [];
  for (const scenario of scenarios) {
    heading(scenario.title);
    results.push(await scenario.run(context));
  }

  printSummary(results);
}

main()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch(async (error: unknown) => {
    if (isSeedError(error)) {
      console.error(`\n\x1b[31m${error.message}\x1b[0m`);
    } else if (error instanceof ApiError) {
      console.error(`\n\x1b[31mErro do domínio (${error.status} ${error.code}): ${error.message}\x1b[0m`);
    } else {
      console.error("\n\x1b[31mFalha inesperada:\x1b[0m", error);
    }
    console.error(
      "\nSe um grupo parcial ficou para trás, rode de novo com --reset para limpá-lo antes de recriar.",
    );
    await closePool().catch(() => undefined);
    process.exit(1);
  });
