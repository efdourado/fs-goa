"use client";

import { useLocale, useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";

import { apiRequest } from "./api";
import { useGoaFormat } from "./format";
import { Button, cardClass, cx, inputClass, labelClass, StatusMessage } from "./ui";

const IMPACTS = ["blocked", "effort", "minor", "idea"] as const;
const WORKAROUNDS = ["spreadsheet", "whatsapp", "notion", "other_app", "none"] as const;

export function FeedbackForm() {
  const t = useTranslations("feedbackPage");
  const locale = useLocale();
  const f = useGoaFormat();
  const [succeeded, setSucceeded] = useState<"" | "yes" | "no">("");
  const [ease, setEase] = useState<number | null>(null);
  const [impact, setImpact] = useState<(typeof IMPACTS)[number] | "">("");
  const [contactOk, setContactOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!impact) {
      setError(t("impactRequired"));
      return;
    }
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await apiRequest("/api/feedback", {
        method: "POST",
        body: {
          area: String(form.get("area") ?? "").trim(),
          goal: String(form.get("goal") ?? "").trim(),
          succeeded: succeeded === "" ? null : succeeded === "yes",
          ease,
          friction: String(form.get("friction") ?? "").trim() || null,
          impact,
          workaround: String(form.get("workaround") ?? "") || null,
          wish: String(form.get("wish") ?? "").trim() || null,
          contactOk,
          contactEmail: contactOk ? String(form.get("contactEmail") ?? "").trim() : null,
          route: typeof document !== "undefined" ? new URL(document.referrer || location.href).pathname : null,
          locale,
        },
      });
      setDone(true);
    } catch (cause) {
      setError(f.error(cause));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <section className={cx(cardClass, "p-6 text-center sm:p-10")}>
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[var(--ok-soft)] text-2xl text-[var(--ok)]" aria-hidden="true">✓</span>
        <h2 className="mt-6 text-2xl font-light tracking-[-0.03em]">{t("thanksTitle")}</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--muted)]">{t("thanksBody")}</p>
      </section>
    );
  }

  return (
    <form className={cx(cardClass, "space-y-6 p-6 sm:p-8")} onSubmit={submit}>
      <label className="block">
        <span className={labelClass}>{t("q1")}</span>
        <input className={inputClass} name="area" required maxLength={200} placeholder={t("q1Placeholder")} />
      </label>

      <label className="block">
        <span className={labelClass}>{t("q2")}</span>
        <textarea className={inputClass} name="goal" required rows={2} maxLength={400} />
      </label>

      <fieldset>
        <legend className={labelClass}>{t("q3a")}</legend>
        <div className="flex flex-wrap gap-2">
          {(["yes", "no", ""] as const).map((value) => (
            <button
              key={value || "skip"}
              type="button"
              aria-pressed={succeeded === value}
              onClick={() => setSucceeded(value)}
              className={cx(
                "min-h-10 rounded-xl border px-4 text-sm transition",
                succeeded === value ? "border-[var(--main)] bg-[var(--main-soft)] text-[var(--main-strong)]" : "border-[var(--line)] text-[var(--muted)]",
              )}
            >
              {value === "yes" ? t("yes") : value === "no" ? t("no") : t("partly")}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className={labelClass}>{t("q3b")}</legend>
        <div className="flex gap-1.5">
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={ease === value}
              aria-label={String(value)}
              onClick={() => setEase(value === ease ? null : value)}
              className={cx(
                "grid h-10 w-10 place-items-center rounded-xl border text-sm transition",
                ease === value ? "border-[var(--main)] bg-[var(--main)] text-white" : "border-[var(--line)] text-[var(--muted)] hover:border-[var(--main-line)]",
              )}
            >
              {value}
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-[var(--muted)]">{t("q3bScale")}</p>
      </fieldset>

      <label className="block">
        <span className={labelClass}>{t("q4")}</span>
        <textarea className={inputClass} name="friction" rows={3} maxLength={4000} />
      </label>

      <fieldset>
        <legend className={labelClass}>{t("q5")}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {IMPACTS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={impact === value}
              onClick={() => setImpact(value)}
              className={cx(
                "min-h-11 rounded-xl border px-4 text-left text-sm transition",
                impact === value ? "border-[var(--main)] bg-[var(--main-soft)] text-[var(--main-strong)]" : "border-[var(--line)] text-[var(--muted)]",
              )}
            >
              {t(`impact.${value}`)}
            </button>
          ))}
        </div>
      </fieldset>

      <label className="block">
        <span className={labelClass}>{t("q6")}</span>
        <select className={inputClass} name="workaround" defaultValue="">
          <option value="">{t("q6None")}</option>
          {WORKAROUNDS.map((value) => (
            <option key={value} value={t(`workaround.${value}`)}>{t(`workaround.${value}`)}</option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className={labelClass}>{t("q7")}</span>
        <textarea className={inputClass} name="wish" rows={3} maxLength={4000} />
      </label>

      <fieldset>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={contactOk} onChange={(event) => setContactOk(event.target.checked)} />
          {t("q8")}
        </label>
        {contactOk ? (
          <input className={cx(inputClass, "mt-2")} name="contactEmail" type="email" maxLength={254} placeholder={t("q8Placeholder")} />
        ) : null}
      </fieldset>

      <StatusMessage error={error} />
      <Button type="submit" className="w-full" disabled={busy}>{busy ? t("sending") : t("send")}</Button>
    </form>
  );
}
