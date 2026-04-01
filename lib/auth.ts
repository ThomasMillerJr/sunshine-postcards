import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

const SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "fallback-secret"
);
const COOKIE_NAME = "sunshine-session";
const EXPIRY = "7d";

// Rate limiting (in-memory)
const attempts: Map<string, { count: number; lockedUntil: number }> = new Map();
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

export function checkRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const record = attempts.get(ip);

  if (record && record.lockedUntil > now) {
    return { allowed: false, retryAfter: Math.ceil((record.lockedUntil - now) / 1000) };
  }

  if (record && record.lockedUntil <= now) {
    attempts.delete(ip);
  }

  return { allowed: true };
}

export function recordFailedAttempt(ip: string): void {
  const record = attempts.get(ip) || { count: 0, lockedUntil: 0 };
  record.count += 1;
  if (record.count >= MAX_ATTEMPTS) {
    record.lockedUntil = Date.now() + LOCKOUT_MS;
  }
  attempts.set(ip, record);
}

export function clearAttempts(ip: string): void {
  attempts.delete(ip);
}

export function verifyPin(pin: string): boolean {
  return pin === process.env.APP_PIN;
}

export async function createSession(): Promise<string> {
  return new SignJWT({ authenticated: true })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(EXPIRY)
    .sign(SECRET);
}

export async function verifySession(token: string): Promise<boolean> {
  try {
    await jwtVerify(token, SECRET);
    return true;
  } catch {
    return false;
  }
}

export async function getSession(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return false;
  return verifySession(token);
}

export { COOKIE_NAME };
