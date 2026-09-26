import { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = "aba_owner_session";

function toBase64Url(bytes: ArrayBuffer) {
  const binary = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function validSession(token: string | undefined, secret: string | undefined) {
  if (!token || !secret) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [value, signature] = parts;
  const match = /^owner:(\d+)$/.exec(value);
  if (!match || Number(match[1]) < Date.now()) return false;

  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = toBase64Url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
  return expected === signature;
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (pathname === "/login" || pathname.startsWith("/api/auth")) return NextResponse.next();
  if (pathname.startsWith("/_next/") || pathname === "/favicon.ico") return NextResponse.next();

  const authenticated = await validSession(request.cookies.get(COOKIE_NAME)?.value, process.env.AUTH_SECRET);
  if (authenticated) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });
  }

  const login = new URL("/login", request.url);
  login.searchParams.set("next", pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
