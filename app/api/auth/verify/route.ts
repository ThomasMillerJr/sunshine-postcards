import { NextRequest, NextResponse } from "next/server";
import {
  verifyPin,
  createSession,
  checkRateLimit,
  recordFailedAttempt,
  clearAttempts,
  COOKIE_NAME,
} from "@/lib/auth";

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for") || "unknown";

  const { allowed, retryAfter } = checkRateLimit(ip);
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later.", retryAfter },
      { status: 429 }
    );
  }

  const { pin } = await request.json();

  if (!verifyPin(pin)) {
    recordFailedAttempt(ip);
    return NextResponse.json({ error: "Invalid PIN" }, { status: 401 });
  }

  clearAttempts(ip);
  const token = await createSession();

  const response = NextResponse.json({ success: true });
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60, // 7 days
    path: "/",
  });

  return response;
}
