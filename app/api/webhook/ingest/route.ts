import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { postcards, postcardImages } from "@/lib/schema";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

const UPLOADS_DIR = path.join(process.cwd(), "uploads");
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"];

export async function POST(request: NextRequest) {
  const secret = request.headers.get("x-webhook-secret");
  if (!secret || secret !== process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const files: File[] = [];

  // Collect all image files — iOS Shortcuts sends as "front", "back", or "images"
  for (const key of ["front", "back", "images"]) {
    const entries = formData.getAll(key);
    for (const entry of entries) {
      if (entry instanceof File && ALLOWED_TYPES.includes(entry.type)) {
        files.push(entry);
      }
    }
  }

  if (files.length === 0) {
    return NextResponse.json(
      { error: "No valid image files provided. Send as 'front', 'back', or 'images' fields (JPEG, PNG, WebP, HEIC)." },
      { status: 400 }
    );
  }

  const db = getDb();
  await mkdir(UPLOADS_DIR, { recursive: true });

  // Create a postcard with a timestamp title (AI analysis will fill metadata later)
  const now = new Date();
  const label = now.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  const [postcard] = db
    .insert(postcards)
    .values({ title: `New Postcard — ${label}` })
    .returning()
    .all();

  // Save each image
  const savedImages = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const ext = file.name.split(".").pop() || "jpg";
    const filename = `${randomUUID()}.${ext}`;
    const filePath = path.join(UPLOADS_DIR, filename);

    const bytes = new Uint8Array(await file.arrayBuffer());
    await writeFile(filePath, bytes);

    // First file = front, second = back, rest = front
    const side = i === 1 ? "back" : "front";

    const [image] = db
      .insert(postcardImages)
      .values({
        postcardId: postcard.id,
        side,
        filePath: filename,
        originalFilename: file.name,
      })
      .returning()
      .all();

    savedImages.push(image);
  }

  return NextResponse.json(
    {
      postcard,
      images: savedImages,
      message: `Created postcard #${postcard.id} with ${savedImages.length} image(s)`,
    },
    { status: 201 }
  );
}
