/**
 * Saves a rendered piece of the page (a card, the whole poster) as a PNG. The library is loaded only
 * when someone actually downloads — nobody pays for it on page load. Elements marked
 * `data-story-skip` (the download buttons themselves) are left out of the picture.
 */
export async function downloadNode(node: HTMLElement, filename: string): Promise<void> {
  const { toPng } = await import("html-to-image");
  const background = getComputedStyle(node).backgroundColor;
  const url = await toPng(node, {
    pixelRatio: 2,
    cacheBust: true,
    backgroundColor: background && background !== "rgba(0, 0, 0, 0)" ? background : getComputedStyle(document.body).backgroundColor,
    filter: (element) => !(element instanceof HTMLElement && element.dataset.storySkip !== undefined),
  });
  const link = document.createElement("a");
  link.href = url;
  link.download = `${slug(filename)}.png`;
  link.click();
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
