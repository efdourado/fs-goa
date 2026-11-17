/** The optional, separate per-item goal log. Exercise performance and primary reading logs are not this add-on. */
export const ITEM_GOAL_TRACKING_KEY = "paginas_livro";

export function isItemGoalTrackingType(type: {
  semanticKey?: string;
  purpose?: string | null;
  parentTypeId?: string | null;
  isPrimary?: boolean;
}): boolean {
  return type.semanticKey === ITEM_GOAL_TRACKING_KEY && type.purpose === "progress"
    && !type.parentTypeId && !type.isPrimary;
}
