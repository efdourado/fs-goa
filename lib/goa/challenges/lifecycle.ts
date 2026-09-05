import type { SessionContext } from "../../auth";
import { inTransaction } from "../../db";
import { challengeAccess, writeAudit } from "../../goa-domain";
import { ApiError } from "../../http";
import { archiveOrphanedCatalogItemsForChallenge } from "../catalog";
import { computePreflight, type PreflightIssue } from "./preflight";
import { generateShowcase } from "./showcase";

export async function transitionChallenge(
  session: SessionContext,
  challengeId: string,
  body: Record<string, unknown>,
) {
  const target = body.status;
  if (target !== "active" && target !== "closed") throw new ApiError(400, "invalid_status", "Transição inválida.");
  return inTransaction(async (client) => {
    const access = await challengeAccess(session.user.id, challengeId, client, true);
    if (!access.canManage) throw new ApiError(403, "forbidden", "Somente administradores podem mudar o estado.");
    // A list has no round to end — it just grows. Delete it if it is no longer
    // wanted. `kind` is decided once at creation (see `createChallenge`), not
    // re-derived from whether dates exist today.
    if (access.challenge.kind === "list" && target === "closed") {
      throw new ApiError(409, "living_list_no_close", "Uma lista pessoal não é encerrada. Apague-a se não precisar mais dela.");
    }
    const reopening = access.challenge.status === "closed" && target === "active";
    const valid = (access.challenge.status === "draft" && target === "active") ||
      (access.challenge.status === "active" && target === "closed") ||
      reopening;
    if (!valid) throw new ApiError(409, "invalid_transition", "A transição de estado não é permitida.");
    if (reopening) {
      // Reabrir não repete a checagem de prontidão (já passou por ela uma vez) —
      // apenas libera os registros de novo e limpa a marca de encerramento.
      // Uma vitrine publicada exige um desafio fechado (CHECK do banco) e o link é
      // um snapshot congelado, então a mesma transação revoga a publicação e o
      // token. Republicar depois de fechar de novo gera um link novo.
      const wasPublished = access.challenge.results_published_at !== null;
      await client.query(
        `UPDATE challenges
            SET status='active', closed_at=NULL,
                results_published_at=NULL, result_share_token_hash=NULL,
                results_published_snapshot=NULL, updated_at=now()
          WHERE id=$1`,
        [challengeId],
      );
      if (wasPublished) {
        await writeAudit(client, access.challenge.group_id, challengeId, session.user.id,
          "results.unpublished", "challenge", challengeId, null, null, { reason: "reopen" });
      }
    } else if (target === "active") {
      // The preflight review is the single source of truth for "can this go
      // live" — the same errors the admin sees are the hard gate here.
      const report = await computePreflight(client, challengeId);
      if (!report.ready) {
        throw new ApiError(409, "challenge_incomplete", report.errors[0]?.message ?? "O desafio ainda não está pronto para ativar.", {
          issues: report.errors.map((issue: PreflightIssue) => issue.code),
        });
      }
      await client.query("UPDATE challenges SET status='active', activated_at=now(), updated_at=now() WHERE id=$1", [challengeId]);
    } else {
      await client.query("UPDATE challenges SET status='closed', closed_at=now(), updated_at=now() WHERE id=$1", [challengeId]);
      // Rebuilds the showcase every time — cheap (delete + re-insert) and it's the
      // only way a re-close after `reopening` picks up whatever changed meanwhile.
      await generateShowcase(client, challengeId, session.user.id);
    }
    await writeAudit(client, access.challenge.group_id, challengeId, session.user.id,
      `challenge.${target}`, "challenge", challengeId, { status: access.challenge.status }, { status: target });
    return { id: challengeId, status: target };
  });
}

export async function softDeleteChallenge(session: SessionContext, challengeId: string) {
  return inTransaction(async (client) => {
    const access = await challengeAccess(session.user.id, challengeId, client, true);
    if (!access.canManage) {
      throw new ApiError(403, "forbidden", "Somente administradores podem apagar o desafio.");
    }
    await client.query(
      `UPDATE challenges
          SET deleted_at = now(), deleted_by_user_id = $2, updated_at = now()
        WHERE id = $1`,
      [challengeId, session.user.id],
    );
    await archiveOrphanedCatalogItemsForChallenge(client, session.user.id, access.challenge.group_id, challengeId);
    await writeAudit(
      client,
      access.challenge.group_id,
      challengeId,
      session.user.id,
      "challenge.deleted",
      "challenge",
      challengeId,
      { title: access.challenge.title, status: access.challenge.status },
      null,
    );
    return { id: challengeId, deleted: true };
  });
}
