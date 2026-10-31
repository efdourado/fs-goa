import { ApiError } from "../../http";

/** Recommendation fields are user-defined now; refuse the retired built-in request keys. */
export function assertNoBuiltInRecommendation(body: Record<string, unknown>): void {
  const retired = ["recommendedByUserId", "recommendedByExternalId", "originNote", "catalogRecommendedByUserId", "catalogRecommendedByExternalId", "catalogOriginNote"];
  if (retired.some((key) => Object.hasOwn(body, key))) {
    throw new ApiError(400, "retired_property", "Indicações não são uma propriedade fixa. Use um campo criado no desafio.");
  }
}
