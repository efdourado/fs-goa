"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { useGoaFormat } from "../format";
import { Brand, Button, cardClass, cx, StatusMessage } from "../ui";

export function AccountDeactivatedScreen({
  onReactivate,
  onLogout,
}: {
  onReactivate: () => Promise<void>;
  onLogout: () => void;
}) {
  const t = useTranslations("accountDeactivated");
  const f = useGoaFormat();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reactivate() {
    setBusy(true);
    setError(null);
    try {
      await onReactivate();
    } catch (cause) {
      setError(f.error(cause));
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center px-4 py-12 text-center">
      <Brand />
      <section className={cx(cardClass, "mt-8 w-full p-6 sm:p-8")}>
        <h1 className="text-xl font-light">{t("title")}</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{t("body")}</p>
        <div className="mt-4"><StatusMessage error={error} /></div>
        <div className="mt-5 flex flex-col gap-2">
          <Button onClick={() => void reactivate()} disabled={busy}>
            {busy ? t("reactivating") : t("reactivate")}
          </Button>
          <Button variant="ghost" onClick={onLogout} disabled={busy}>{t("logout")}</Button>
        </div>
      </section>
    </main>
  );
}
