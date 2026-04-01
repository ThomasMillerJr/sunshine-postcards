"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

interface Postcard {
  id: number;
  title: string;
  description: string;
  category: string;
  era: string;
  condition: string;
  locationDepicted: string | null;
  publisher: string | null;
  estimatedValue: number | null;
  notes: string | null;
  images: { id: number; side: string; filePath: string }[];
  transactions: {
    id: number;
    status: string;
    platform: string;
    listingPrice: number | null;
    soldPrice: number | null;
    profit: number | null;
    listedAt: string | null;
    soldAt: string | null;
  }[];
}

export default function PostcardDetail() {
  const { id } = useParams();
  const router = useRouter();
  const [postcard, setPostcard] = useState<Postcard | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<Postcard>>({});

  useEffect(() => {
    fetch(`/api/postcards/${id}`)
      .then((r) => r.json())
      .then((data) => {
        setPostcard(data);
        setForm(data);
      });
  }, [id]);

  const save = async () => {
    const res = await fetch(`/api/postcards/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: form.title,
        description: form.description,
        category: form.category,
        era: form.era,
        condition: form.condition,
        locationDepicted: form.locationDepicted,
        publisher: form.publisher,
        estimatedValue: form.estimatedValue,
        notes: form.notes,
      }),
    });
    if (res.ok) {
      const updated = await res.json();
      setPostcard({ ...postcard!, ...updated });
      setEditing(false);
    }
  };

  const remove = async () => {
    if (!confirm("Delete this postcard?")) return;
    await fetch(`/api/postcards/${id}`, { method: "DELETE" });
    router.push("/inventory");
  };

  if (!postcard) return <div className="py-8">Loading...</div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">{postcard.title || "Untitled"}</h1>
        <div className="flex gap-2">
          {editing ? (
            <>
              <button onClick={save} className="bg-blue-600 text-white px-4 py-2 rounded-lg">
                Save
              </button>
              <button onClick={() => setEditing(false)} className="border px-4 py-2 rounded-lg">
                Cancel
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setEditing(true)} className="border px-4 py-2 rounded-lg">
                Edit
              </button>
              <button onClick={remove} className="border border-red-300 text-red-600 px-4 py-2 rounded-lg">
                Delete
              </button>
            </>
          )}
        </div>
      </div>

      {/* Images */}
      <div className="flex gap-4 mb-8">
        {postcard.images.map((img) => (
          <img
            key={img.id}
            src={`/api/images/${img.id}`}
            alt={img.side}
            className="w-64 h-48 object-cover rounded-lg border"
          />
        ))}
        {postcard.images.length === 0 && (
          <div className="w-64 h-48 bg-gray-100 rounded-lg flex items-center justify-center text-gray-400">
            No images
          </div>
        )}
      </div>

      {/* Fields */}
      <div className="bg-white rounded-lg border p-6 mb-8">
        <div className="grid grid-cols-2 gap-4">
          {(["title", "description", "category", "era", "condition", "locationDepicted", "publisher", "notes"] as const).map(
            (field) => (
              <div key={field}>
                <label className="block text-sm text-gray-500 mb-1 capitalize">
                  {field.replace(/([A-Z])/g, " $1")}
                </label>
                {editing ? (
                  <input
                    className="w-full border rounded px-3 py-2"
                    value={(form as Record<string, string>)[field] || ""}
                    onChange={(e) => setForm({ ...form, [field]: e.target.value })}
                  />
                ) : (
                  <p>{(postcard as unknown as Record<string, string>)[field] || "\u2014"}</p>
                )}
              </div>
            )
          )}
          <div>
            <label className="block text-sm text-gray-500 mb-1">Estimated Value</label>
            {editing ? (
              <input
                type="number"
                step="0.01"
                className="w-full border rounded px-3 py-2"
                value={form.estimatedValue ?? ""}
                onChange={(e) =>
                  setForm({ ...form, estimatedValue: e.target.value ? parseFloat(e.target.value) : null })
                }
              />
            ) : (
              <p>{postcard.estimatedValue ? `$${postcard.estimatedValue.toFixed(2)}` : "\u2014"}</p>
            )}
          </div>
        </div>
      </div>

      {/* Transactions */}
      <div className="bg-white rounded-lg border p-6">
        <h2 className="text-xl font-bold mb-4">Transactions</h2>
        {postcard.transactions.length === 0 ? (
          <p className="text-gray-500">No transactions yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="pb-2">Status</th>
                <th className="pb-2">Platform</th>
                <th className="pb-2">Listed</th>
                <th className="pb-2">Sold</th>
                <th className="pb-2">Profit</th>
              </tr>
            </thead>
            <tbody>
              {postcard.transactions.map((txn) => (
                <tr key={txn.id} className="border-b">
                  <td className="py-2 capitalize">{txn.status}</td>
                  <td className="py-2">{txn.platform}</td>
                  <td className="py-2">{txn.listingPrice ? `$${txn.listingPrice.toFixed(2)}` : "\u2014"}</td>
                  <td className="py-2">{txn.soldPrice ? `$${txn.soldPrice.toFixed(2)}` : "\u2014"}</td>
                  <td className="py-2">{txn.profit ? `$${txn.profit.toFixed(2)}` : "\u2014"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
