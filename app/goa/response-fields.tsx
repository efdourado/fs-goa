"use client";

import { useTranslations } from "next-intl";
import { FieldRows } from "./fields";
import type { ChallengeField } from "./types";
import { SelectableCards } from "./ui";

export function ResponseFields({ fields, onChange, linked, dated, answerScope, onScope }: {
  fields: ChallengeField[]; onChange: (fields: ChallengeField[]) => void; linked: boolean; dated: boolean;
  answerScope: "individual" | "shared"; onScope: (scope: "individual" | "shared") => void;
}) {
  const t = useTranslations("challengeCreate");
  const tr = useTranslations("createChallenge");
  return <div className="space-y-5">
    <p className="text-sm leading-6 text-[var(--muted)]">{t(dated ? linked ? "dailyItemFieldsHint" : "dailyFieldsHint" : "listFieldsHint")}</p>
    {linked && !dated ? <SelectableCards value={answerScope} onChange={onScope} options={[
      { value: "individual", label: tr("scopeIndividual"), hint: tr("scopeIndividualHint") },
      { value: "shared", label: tr("scopeShared"), hint: tr("scopeSharedHint") },
    ]} /> : null}
    <FieldRows fields={fields} onChange={onChange} />
  </div>;
}
