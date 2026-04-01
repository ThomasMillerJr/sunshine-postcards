"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AddPostcard() {
  const router = useRouter();
  const [form, setForm] = useState({
    title: "",
    description: "",
    category: "",
    era: "",
    condition: "",
    locationDepicted: "",
    publisher: "",
    estimatedValue: "",
    notes: "",
  });
  const [files, setFiles] = useState<{ file: File; side: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const handleFileAdd = (e: React.ChangeEvent<HTMLInputElement>, side: string) => {
    const file = e.target.files?.[0];
    if (file) {
      // Replace existing file for this side (don't append duplicates)
      setFiles([...files.filter((f) => f.side !== side), { file, side }]);
    }
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      const res = await fetch("/api/postcards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          estimatedValue: form.estimatedValue ? parseFloat(form.estimatedValue) : null,
        }),
      });
      const postcard = await res.json();

      for (const { file, side } of files) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("postcardId", postcard.id.toString());
        formData.append("side", side);
        await fetch("/api/upload", { method: "POST", body: formData });
      }

      router.push(`/inventory/${postcard.id}`);
    } catch (err) {
      alert("Failed to save postcard");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <h1 className="text-3xl font-bold mb-8">Add Postcard</h1>
      <div className="bg-white rounded-lg border p-6">
        <div className="mb-6">
          <h2 className="font-semibold mb-3">Photos</h2>
          <div className="flex gap-4">
            <div>
              <label className="block text-sm text-gray-500 mb-1">Front</label>
              <input type="file" accept="image/*" onChange={(e) => handleFileAdd(e, "front")} />
            </div>
            <div>
              <label className="block text-sm text-gray-500 mb-1">Back</label>
              <input type="file" accept="image/*" onChange={(e) => handleFileAdd(e, "back")} />
            </div>
          </div>
          {files.length > 0 && (
            <div className="flex gap-2 mt-3">
              {files.map((f, i) => (
                <div key={i} className="text-sm text-gray-500">
                  {f.side}: {f.file.name}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4 mb-6">
          {(["title", "description", "category", "era", "condition", "locationDepicted", "publisher", "notes"] as const).map(
            (field) => (
              <div key={field}>
                <label className="block text-sm text-gray-500 mb-1 capitalize">
                  {field.replace(/([A-Z])/g, " $1")}
                </label>
                <input
                  className="w-full border rounded px-3 py-2"
                  value={form[field as keyof typeof form]}
                  onChange={(e) => setForm({ ...form, [field]: e.target.value })}
                />
              </div>
            )
          )}
          <div>
            <label className="block text-sm text-gray-500 mb-1">Estimated Value ($)</label>
            <input
              type="number"
              step="0.01"
              className="w-full border rounded px-3 py-2"
              value={form.estimatedValue}
              onChange={(e) => setForm({ ...form, estimatedValue: e.target.value })}
            />
          </div>
        </div>

        <button
          onClick={submit}
          disabled={submitting}
          className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 disabled:opacity-50 text-lg"
        >
          {submitting ? "Saving..." : "Save Postcard"}
        </button>
      </div>
    </div>
  );
}
