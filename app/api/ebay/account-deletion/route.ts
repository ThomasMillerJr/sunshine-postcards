import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";

const VERIFICATION_TOKEN = process.env.EBAY_VERIFICATION_TOKEN || "sunshine-postcards-ebay-verify-2026";

// eBay sends a GET to verify the endpoint during setup
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const challengeCode = searchParams.get("challenge_code");

  if (!challengeCode) {
    return NextResponse.json({ error: "Missing challenge_code" }, { status: 400 });
  }

  // eBay expects: SHA256(challengeCode + verificationToken + endpoint URL)
  // Must match exactly what was registered with eBay
  const endpoint = process.env.EBAY_DELETION_ENDPOINT || "https://sunshinepostcards.com/api/ebay/account-deletion";
  const hash = createHash("sha256")
    .update(challengeCode)
    .update(VERIFICATION_TOKEN)
    .update(endpoint)
    .digest("hex");

  return NextResponse.json({ challengeResponse: hash });
}

// eBay sends a POST when a user requests account deletion
export async function POST() {
  // We don't store any eBay user data, so just acknowledge
  return NextResponse.json({ status: "ok" }, { status: 200 });
}
