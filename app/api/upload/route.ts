import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { postcardImages } from "@/lib/schema";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

const UPLOADS_DIR = path.join(process.cwd(), "uploads");

export async function POST(request: NextRequest) {
  const db = getDb();
  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const postcardId = formData.get("postcardId") as string;
  const side = (formData.get("side") as string) || "front";

  if (!file || !postcardId) {
    return NextResponse.json(
      { error: "file and postcardId are required" },
      { status: 400 }
    );
  }

  const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/heic"];
  if (!allowedTypes.includes(file.type)) {
    return NextResponse.json(
      { error: "Invalid file type. Use JPEG, PNG, WebP, or HEIC." },
      { status: 400 }
    );
  }

  const ext = file.name.split(".").pop() || "jpg";
  const filename = `${randomUUID()}.${ext}`;
  const filePath = path.join(UPLOADS_DIR, filename);

  await mkdir(UPLOADS_DIR, { recursive: true });
  const bytes = new Uint8Array(await file.arrayBuffer());
  await writeFile(filePath, bytes);

  const result = db
    .insert(postcardImages)
    .values({
      postcardId: parseInt(postcardId),
      side,
      filePath: filename,
      originalFilename: file.name,
    })
    .returning()
    .all();

  return NextResponse.json(result[0], { status: 201 });
}
