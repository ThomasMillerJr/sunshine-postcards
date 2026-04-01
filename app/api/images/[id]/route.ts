import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { postcardImages } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { readFile } from "fs/promises";
import path from "path";

const UPLOADS_DIR = path.join(process.cwd(), "uploads");

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const db = getDb();
  const { id } = await params;
  const results = db
    .select()
    .from(postcardImages)
    .where(eq(postcardImages.id, parseInt(id)))
    .all();
  const image = results[0];

  if (!image) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const filePath = path.join(UPLOADS_DIR, image.filePath);

  try {
    const buffer = await readFile(filePath);
    const ext = image.filePath.split(".").pop() || "jpg";
    const contentType =
      {
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        png: "image/png",
        webp: "image/webp",
      }[ext] || "application/octet-stream";

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "File not found on disk" },
      { status: 404 }
    );
  }
}
