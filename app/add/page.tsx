"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";

export default function AddPostcard() {
  const router = useRouter();
  const [files, setFiles] = useState<{ file: File; side: string; preview: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState("");
  const frontRef = useRef<HTMLInputElement>(null);
  const backRef = useRef<HTMLInputElement>(null);

  const handleFileAdd = (e: React.ChangeEvent<HTMLInputElement>, side: string) => {
    const file = e.target.files?.[0];
    if (file) {
      const preview = URL.createObjectURL(file);
      setFiles((prev) => [...prev.filter((f) => f.side !== side), { file, side, preview }]);
    }
  };

  const submit = async () => {
    if (files.length === 0) return;
    setSubmitting(true);
    try {
      setStatus("Creating postcard...");
      const res = await fetch("/api/postcards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const postcard = await res.json();

      setStatus("Uploading photos...");
      for (const { file, side } of files) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("postcardId", postcard.id.toString());
        formData.append("side", side);
        await fetch("/api/upload", { method: "POST", body: formData });
      }

      setStatus("Starting AI analysis...");
      fetch(`/api/postcards/${postcard.id}/analyze`, { method: "POST" }).catch(() => {});

      router.push(`/inventory/${postcard.id}`);
    } catch {
      setStatus("");
      alert("Failed to save postcard");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto">
      <h1
        className="text-2xl font-bold text-[#2D2A26] mb-2"
        style={{ fontFamily: "'DM Serif Display', Georgia, serif" }}
      >
        Add Postcard
      </h1>
      <p className="text-sm text-[#B8B0A4] mb-8">
        Snap front and back photos. AI will identify the card, era, publisher, condition, and more.
      </p>

      <div className="space-y-4">
        {/* Front photo */}
        <div
          onClick={() => frontRef.current?.click()}
          className="relative cursor-pointer rounded-xl border-2 border-dashed border-[#FFF0D4] hover:border-[#F7B733] transition-all overflow-hidden bg-white"
        >
          <input
            ref={frontRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => handleFileAdd(e, "front")}
          />
          {files.find((f) => f.side === "front") ? (
            <div className="aspect-[4/3]">
              <img
                src={files.find((f) => f.side === "front")!.preview}
                alt="Front"
                className="w-full h-full object-cover"
              />
              <div className="absolute top-2 left-2 bg-white/90 text-[#8A8278] text-xs px-2 py-1 rounded-lg font-medium">
                Front
              </div>
            </div>
          ) : (
            <div className="aspect-[4/3] flex flex-col items-center justify-center gap-2">
              <div className="w-12 h-12 rounded-full bg-[#FFF4D6] flex items-center justify-center text-2xl text-[#F7B733]">
                +
              </div>
              <span className="text-sm font-medium text-[#8A8278]">Front of card</span>
              <span className="text-xs text-[#B8B0A4]">Tap to take photo or choose file</span>
            </div>
          )}
        </div>

        {/* Back photo */}
        <div
          onClick={() => backRef.current?.click()}
          className="relative cursor-pointer rounded-xl border-2 border-dashed border-[#FFF0D4] hover:border-[#F7B733] transition-all overflow-hidden bg-white"
        >
          <input
            ref={backRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => handleFileAdd(e, "back")}
          />
          {files.find((f) => f.side === "back") ? (
            <div className="aspect-[4/3]">
              <img
                src={files.find((f) => f.side === "back")!.preview}
                alt="Back"
                className="w-full h-full object-cover"
              />
              <div className="absolute top-2 left-2 bg-white/90 text-[#8A8278] text-xs px-2 py-1 rounded-lg font-medium">
                Back
              </div>
            </div>
          ) : (
            <div className="aspect-[4/3] flex flex-col items-center justify-center gap-2">
              <div className="w-12 h-12 rounded-full bg-[#F0EBE3] flex items-center justify-center text-2xl text-[#B8B0A4]">
                +
              </div>
              <span className="text-sm font-medium text-[#8A8278]">Back of card</span>
              <span className="text-xs text-[#B8B0A4]">Recommended for better analysis</span>
            </div>
          )}
        </div>
      </div>

      {/* Submit */}
      <button
        onClick={submit}
        disabled={submitting || files.length === 0}
        className="w-full mt-6 bg-gradient-to-br from-[#F7B733] to-[#F0A030] text-white py-3 rounded-xl text-sm font-semibold shadow-[0_2px_8px_rgba(247,183,51,0.25)] hover:shadow-[0_4px_12px_rgba(247,183,51,0.4)] hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:hover:translate-y-0 disabled:cursor-not-allowed"
      >
        {submitting ? status || "Saving..." : "Add & Analyze"}
      </button>

      {files.length === 0 && (
        <p className="text-center text-xs text-[#B8B0A4] mt-3">
          Add at least one photo to continue
        </p>
      )}
    </div>
  );
}
