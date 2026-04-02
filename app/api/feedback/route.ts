import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "Feedback not configured" },
      { status: 500 }
    );
  }

  let body: { title?: string; description?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const title = body.title?.trim();
  const description = body.description?.trim() || "";

  if (!title) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }
  if (title.length > 200) {
    return NextResponse.json(
      { error: "Title must be 200 characters or less" },
      { status: 400 }
    );
  }
  if (description.length > 5000) {
    return NextResponse.json(
      { error: "Description must be 5000 characters or less" },
      { status: 400 }
    );
  }

  const res = await fetch(
    "https://api.github.com/repos/ThomasMillerJr/sunshine-postcards/issues",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title,
        body: description || undefined,
        labels: ["feedback"],
      }),
    }
  );

  if (!res.ok) {
    const error = await res.text();
    console.error("GitHub API error:", res.status, error);
    return NextResponse.json(
      { error: "Failed to create issue" },
      { status: 502 }
    );
  }

  const data = await res.json();
  return NextResponse.json({
    success: true,
    issueUrl: data.html_url,
  });
}
