import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies, headers } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const title = "Goa";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const socialImage = `${protocol}://${host}/og.png`;
  const t = await getTranslations("meta");
  const description = t("description");

  return {
    title,
    description,
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
    },
    openGraph: {
      title,
      description,
      images: [{ url: socialImage, width: 1731, height: 909, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [socialImage],
    },
  };
}

// Runs before first paint. Only an explicit "light"/"dark" choice is written to
// <html> (localStorage is the source of truth, the cookie is the fallback the
// server already read); "system" writes nothing and lets the CSS
// prefers-color-scheme block decide, so dark mode still works with no JS.
const themeBoot = `(function(){try{var p=localStorage.getItem('goa-theme');if(!p){var m=document.cookie.match(/(?:^|; )goa-theme=([^;]+)/);p=m&&m[1];}if(p==='light'||p==='dark')document.documentElement.setAttribute('data-theme',p);}catch(e){}})();`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const cookieStore = await cookies();
  const themeCookie = cookieStore.get("goa-theme")?.value;
  const initialTheme = themeCookie === "dark" || themeCookie === "light" ? themeCookie : undefined;

  return (
    <html lang={locale} data-theme={initialTheme} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBoot }} />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
