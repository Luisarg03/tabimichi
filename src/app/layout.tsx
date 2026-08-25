import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { I18nProvider, type Locale } from "@/lib/i18n";
import { AuthProvider } from "@/lib/auth-context";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tabimichi 旅道 — Discover what to do today",
  description:
    'Tabimichi (旅道, "the road of the journey") is a local discovery app: tell it where you are and how much time you have, and it recommends nearby places based on weather, time and your mood.',
};

/** Mobile-web viewport: `viewport-fit=cover` is required for the
 *  env(safe-area-inset-*) utilities used by .tabi-safe-* to apply on
 *  notched devices (iOS). */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#454e95", // aizome indigo (accent)
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The saved locale travels in a cookie so the server renders the page in
  // the user's language from the start. Client and server then always agree
  // during hydration (no mismatch, no flash); I18nProvider receives the same
  // value as its server snapshot. Note: reading cookies opts the shell out of
  // static prerendering, which is fine for this client-driven app.
  const cookieStore = await cookies();
  const locale: Locale = cookieStore.get("tabi.locale")?.value === "en" ? "en" : "es";

  return (
    <html lang={locale} className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <AuthProvider>
          <I18nProvider initialLocale={locale}>{children}</I18nProvider>
        </AuthProvider>
        <SpeedInsights />
      </body>
    </html>
  );
}
