import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Security headers for pages: strict Content-Security-Policy with a per-request
 * nonce (Next.js auto-applies it to its inline scripts/styles), plus
 * frame/clickjacking protection. API routes are excluded here — they get the
 * static headers from next.config.ts (nosniff, HSTS, …).
 *
 * Following the official Next.js CSP guide:
 * https://nextjs.org/docs/app/guides/content-security-policy
 */

const isDev = process.env.NODE_ENV === "development";

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");

  const csp = [
    "default-src 'self'",
    // 'strict-dynamic' lets nonce'd framework scripts load the rest.
    // 'unsafe-eval' is required by React's dev-mode debugging only.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'`,
    // map tiles (OSM/Carto/Esri) + photos proxied from /api/photo (self)
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    // Supabase REST + realtime (wss) are the only cross-origin fetches
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    /*
     * All request paths except:
     * - api (API routes get headers from next.config)
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     * Also skip next/link prefetch requests (no page rendered → no nonce).
     */
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
