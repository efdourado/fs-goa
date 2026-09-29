import { getTranslations } from "next-intl/server";

import { DemoExperience } from "@/app/goa/story/demo";

export async function generateMetadata() {
  const t = await getTranslations("demo");
  return { title: `${t("title")} — Goa`, description: t("body") };
}

/** A public, clearly-labelled example of a group reveal and recap — no account needed. */
export default function DemoPage() {
  return <DemoExperience />;
}
