/**
 * Saves a rendered piece of the page (a card or the whole poster) as a PNG.
 * The library is loaded on demand. Elements
 * marked `data-story-skip` (the download buttons themselves) are left out of the picture.
 */
export function loadPngRenderer() {
  return import("html-to-image");
}

export async function renderPng(node: HTMLElement): Promise<Blob> {
  const { toBlob } = await loadPngRenderer();
  const background = getComputedStyle(node).backgroundColor;
  const blob = await toBlob(node, {
    pixelRatio: 2,
    backgroundColor: background && background !== "rgba(0, 0, 0, 0)" ? background : getComputedStyle(document.body).backgroundColor,
    filter: (element) => !(element instanceof HTMLElement && element.dataset.storySkip !== undefined),
  });
  if (!blob) throw new Error("Could not render the page");
  return blob;
}

export async function downloadNode(node: HTMLElement, filename: string): Promise<void> {
  saveBlob(await renderPng(node), `${slug(filename)}.png`);
}

/** An image already drawn, saved under the name given. */
export function downloadBlob(blob: Blob, filename: string): void {
  saveBlob(blob, filename);
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function slug(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "goa";
}
