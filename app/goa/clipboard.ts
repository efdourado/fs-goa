type CopySource = Pick<HTMLInputElement | HTMLTextAreaElement, "focus" | "select" | "setSelectionRange" | "value">;

/**
 * Copies sensitive, user-visible text without logging it. The legacy command is
 * kept only as a fallback for browsers and embedded contexts where the modern
 * Clipboard API is unavailable or denied.
 */
export async function copyText(text: string, source?: CopySource | null): Promise<void> {
  if (!text) throw new Error("Não há texto para copiar.");

  if (
    typeof window !== "undefined"
    && window.isSecureContext
    && typeof navigator !== "undefined"
    && navigator.clipboard?.writeText
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // A seleção abaixo ainda pode funcionar quando a permissão da API falha.
    }
  }

  if (typeof document !== "undefined") {
    let temporarySource: HTMLTextAreaElement | null = null;
    let fallbackSource = source;
    if (!fallbackSource && document.body) {
      temporarySource = document.createElement("textarea");
      temporarySource.value = text;
      temporarySource.readOnly = true;
      temporarySource.style.position = "fixed";
      temporarySource.style.opacity = "0";
      temporarySource.style.pointerEvents = "none";
      document.body.appendChild(temporarySource);
      fallbackSource = temporarySource;
    }

    try {
      if (fallbackSource) {
        fallbackSource.focus();
        fallbackSource.select();
        fallbackSource.setSelectionRange(0, fallbackSource.value.length);
        if (typeof document.execCommand === "function" && document.execCommand("copy")) return;
      }
    } catch {
      // A mensagem estável abaixo também cobre falhas do comando legado.
    } finally {
      temporarySource?.remove();
    }
  }

  throw new Error("Não foi possível copiar automaticamente. Selecione o link e copie manualmente.");
}
