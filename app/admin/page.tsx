import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { csrfForSession, sessionFromToken } from "@/lib/auth";
import { SESSION_COOKIE_NAME } from "@/lib/security";
import AdminConsole from "./AdminConsole";

export const dynamic = "force-dynamic";

export const metadata = { title: "Goa · administração", robots: { index: false, follow: false } };

export default async function AdminPage() {
  const store = await cookies();
  const session = await sessionFromToken(store.get(SESSION_COOKIE_NAME)?.value ?? null);
  if (!session?.user.platformAdmin) notFound();
  return <AdminConsole viewerId={session.user.id} viewerName={session.user.name} csrfToken={await csrfForSession(session)} />;
}
