import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "aba_owner_session";
const MAX_AGE = 60 * 60 * 24 * 7;

function sign(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(a: string, b: string) {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

export async function POST(req: Request) {
  const password = process.env.OWNER_PASSWORD;
  const secret = process.env.AUTH_SECRET;
  if (!password || !secret) {
    return NextResponse.json({ ok: false, error: "Owner authentication is not configured." }, { status: 503 });
  }

  let body: { password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const supplied = typeof body.password === "string" ? body.password : "";
  const passwordOk = safeEqual(supplied, password);
  if (!passwordOk) {
    return NextResponse.json({ ok: false, error: "Incorrect password." }, { status: 401 });
  }

  const value = `owner:${Date.now() + MAX_AGE * 1000}`;
  const token = `${value}.${sign(value, secret)}`;
  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
  return response;
}
