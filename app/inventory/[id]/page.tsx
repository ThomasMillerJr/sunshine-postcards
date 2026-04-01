"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

interface PostcardData {
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
  }[];
  research: { id: number; source: string; data: string; createdAt: string }[];
}

export default function PostcardDetail() {
  const { id } = useParams();
  const router = useRouter();
  const [postcard, setPostcard] = useState<PostcardData | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [activeImage, setActiveImage] = useState(0);
  const [researching, setResearching] = useState(false);
  const [researchError, setResearchError] = useState("");

  const runResearch = async () => {
    setResearching(true);
    setResearchError("");
    try {
      const res = await fetch(`/api/research/${id}`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Research failed");
      }
      // Reload postcard to get new research data
      const refreshed = await fetch(`/api/postcards/${id}`).then((r) => r.json());
      setPostcard(refreshed);
    } catch (err) {
      setResearchError(err instanceof Error ? err.message : "Research failed");
    } finally {
      setResearching(false);
    }
  };

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
      setPostcard((prev) => prev ? { ...prev, ...updated } : prev);
      setEditing(false);
    }
  };

  const remove = async () => {
    if (!confirm("Delete this postcard?")) return;
    await fetch(`/api/postcards/${id}`, { method: "DELETE" });
    router.push("/inventory");
  };

  if (!postcard) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-[#FFF0D4] border-t-[#F7B733] rounded-full animate-spin"></div>
      </div>
    );
  }

  const fields = [
    { key: "title", label: "Title" },
    { key: "description", label: "Description" },
    { key: "category", label: "Category" },
    { key: "era", label: "Era" },
    { key: "condition", label: "Condition" },
    { key: "locationDepicted", label: "Location" },
    { key: "publisher", label: "Publisher" },
    { key: "notes", label: "Notes" },
  ];

  return (
    <div>
      {/* Back link */}
      <Link
        href="/inventory"
        className="inline-flex items-center gap-1 text-sm text-[#B8B0A4] hover:text-[#E8634A] transition-colors mb-6"
      >
        ← Back to Inventory
      </Link>

      {/* Hero: Image + Info */}
      <div className="flex gap-6 mb-8 flex-col sm:flex-row">
        {/* Image section */}
        <div className="w-full sm:w-56 flex-shrink-0">
          {postcard.images.length > 0 ? (
            <>
              <div className="aspect-[4/3] rounded-xl overflow-hidden bg-[#F0EBE3] mb-2">
                <img
                  src={`/api/images/${postcard.images[activeImage]?.id}`}
                  alt={postcard.images[activeImage]?.side}
                  className="w-full h-full object-cover"
                />
              </div>
              {postcard.images.length > 1 && (
                <div className="flex gap-2">
                  {postcard.images.map((img, i) => (
                    <button
                      key={img.id}
                      onClick={() => setActiveImage(i)}
                      className={`w-12 h-9 rounded-lg overflow-hidden border-2 transition-all ${
                        i === activeImage ? "border-[#E8634A]" : "border-[#FFF0D4] hover:border-[#F7B733]"
                      }`}
                    >
                      <img src={`/api/images/${img.id}`} alt={img.side} className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="aspect-[4/3] rounded-xl bg-[#F0EBE3] flex items-center justify-center">
              <span className="text-4xl text-[#D4CFC6]">No image</span>
            </div>
          )}
        </div>

        {/* Info section */}
        <div className="flex-1">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-[#2D2A26]" style={{ fontFamily: "'DM Serif Display', Georgia, serif" }}>
                {postcard.title || "Untitled"}
              </h1>
              <p className="text-sm text-[#B8B0A4] mt-1">
                {[postcard.era, postcard.condition, postcard.category].filter(Boolean).join(" \u00b7 ") || "No details"}
              </p>
              {postcard.publisher && (
                <p className="text-xs text-[#B8B0A4] mt-0.5">Publisher: {postcard.publisher}</p>
              )}
              {postcard.locationDepicted && (
                <p className="text-xs text-[#B8B0A4] mt-0.5">Location: {postcard.locationDepicted}</p>
              )}
            </div>
            <div className="flex gap-2 flex-shrink-0">
              {editing ? (
                <>
                  <button
                    onClick={save}
                    className="bg-gradient-to-br from-[#F7B733] to-[#F0A030] text-white px-4 py-2 rounded-lg text-sm font-semibold shadow-[0_2px_8px_rgba(247,183,51,0.25)] hover:shadow-[0_4px_12px_rgba(247,183,51,0.4)] transition-all"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => { setEditing(false); setForm(postcard as unknown as Record<string, unknown>); }}
                    className="border border-[#FFF0D4] px-4 py-2 rounded-lg text-sm text-[#8A8278] hover:border-[#B8B0A4] transition-all"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => setEditing(true)}
                    className="border border-[#FFF0D4] px-4 py-2 rounded-lg text-sm text-[#8A8278] hover:border-[#F7B733] hover:text-[#8A6A10] transition-all"
                  >
                    Edit
                  </button>
                  <button
                    onClick={remove}
                    className="border border-[#FFF0EB] text-[#E8634A] px-4 py-2 rounded-lg text-sm hover:bg-[#FFF0EB] transition-all"
                  >
                    Delete
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Value badge */}
          <div className="mt-4">
            {postcard.estimatedValue ? (
              <span className="inline-block bg-gradient-to-r from-[#F7B733] to-[#F0A030] text-white px-4 py-1.5 rounded-lg text-sm font-bold shadow-[0_2px_8px_rgba(247,183,51,0.2)]">
                Est. ${postcard.estimatedValue.toFixed(2)}
              </span>
            ) : (
              <span className="inline-block bg-[#F5F0EA] text-[#B8B0A4] px-4 py-1.5 rounded-lg text-sm">
                No estimate yet
              </span>
            )}
          </div>

          {/* Description */}
          {postcard.description && !editing && (
            <p className="text-sm text-[#8A8278] mt-4 leading-relaxed">{postcard.description}</p>
          )}
          {postcard.notes && !editing && (
            <p className="text-xs text-[#B8B0A4] mt-2 italic">Note: {postcard.notes}</p>
          )}
        </div>
      </div>

      {/* Edit form */}
      {editing && (
        <div className="bg-white rounded-xl border border-[#FFF0D4] p-6 mb-8">
          <div className="grid grid-cols-2 gap-4">
            {fields.map(({ key, label }) => (
              <div key={key}>
                <label className="block text-xs uppercase tracking-wider text-[#B8B0A4] mb-1">{label}</label>
                <input
                  className="w-full border border-[#FFF0D4] rounded-lg px-3 py-2 text-sm text-[#2D2A26] focus:border-[#F7B733] focus:ring-2 focus:ring-[#F7B73340] focus:outline-none transition-all"
                  value={(form[key] as string) || ""}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                />
              </div>
            ))}
            <div>
              <label className="block text-xs uppercase tracking-wider text-[#B8B0A4] mb-1">Estimated Value ($)</label>
              <input
                type="number"
                step="0.01"
                className="w-full border border-[#FFF0D4] rounded-lg px-3 py-2 text-sm text-[#2D2A26] focus:border-[#F7B733] focus:ring-2 focus:ring-[#F7B73340] focus:outline-none transition-all"
                value={(form.estimatedValue as number) ?? ""}
                onChange={(e) =>
                  setForm({ ...form, estimatedValue: e.target.value ? parseFloat(e.target.value) : null })
                }
              />
            </div>
          </div>
        </div>
      )}

      {/* Research Cards */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-[#2D2A26]" style={{ fontFamily: "'DM Serif Display', Georgia, serif" }}>
            Research
          </h2>
          <button
            onClick={runResearch}
            disabled={researching}
            className="bg-gradient-to-br from-[#F7B733] to-[#F0A030] text-white px-5 py-2 rounded-lg text-sm font-semibold shadow-[0_2px_8px_rgba(247,183,51,0.25)] hover:shadow-[0_4px_12px_rgba(247,183,51,0.4)] hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:hover:translate-y-0 flex items-center gap-2"
          >
            {researching ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                Researching...
              </>
            ) : (
              <>Run Research</>
            )}
          </button>
        </div>
        {researchError && (
          <p className="text-sm text-[#E8634A] bg-[#FFF0EB] rounded-lg px-4 py-2">{researchError}</p>
        )}

        {/* AI Analysis */}
        <div className="bg-white rounded-xl border border-[#FFF0D4] p-5">
          <h3 className="text-[10px] uppercase tracking-[1.2px] text-[#B8B0A4] font-medium mb-3">AI Analysis</h3>
          {postcard.research.find((r) => r.source === "ai_analysis") ? (
            <div className="bg-[#FFFCF5] rounded-lg p-4 text-sm text-[#8A8278] leading-relaxed">
              {(() => {
                try {
                  const data = JSON.parse(postcard.research.find((r) => r.source === "ai_analysis")!.data);
                  return data.summary || data.analysis || JSON.stringify(data);
                } catch {
                  return postcard.research.find((r) => r.source === "ai_analysis")!.data;
                }
              })()}
            </div>
          ) : (
            <div className="bg-[#FFFCF5] rounded-lg p-4 text-sm text-[#B8B0A4] text-center">
              No AI analysis yet. Run analysis to identify this postcard.
            </div>
          )}
        </div>

        {/* eBay Comparables */}
        <div className="bg-white rounded-xl border border-[#FFF0D4] p-5">
          <h3 className="text-[10px] uppercase tracking-[1.2px] text-[#B8B0A4] font-medium mb-3">eBay Sold Comparables</h3>
          {postcard.research.find((r) => r.source === "ebay_sold") ? (
            <div>
              {(() => {
                try {
                  const data = JSON.parse(postcard.research.find((r) => r.source === "ebay_sold")!.data);
                  const items = Array.isArray(data) ? data : data.items || [];
                  return items.slice(0, 15).map((item: Record<string, unknown>, i: number) => {
                    const title = (item.title || item.name || "Unknown") as string;
                    const price = (item.price || item.soldPrice || item.totalPrice || 0) as number;
                    return (
                      <div key={i} className="flex justify-between items-center py-2 border-b border-[#FFF8F0] last:border-0">
                        <span className="text-sm text-[#2D2A26] truncate mr-4">{title}</span>
                        <span className="text-sm font-bold text-[#2E7D32] flex-shrink-0">
                          {typeof price === "number" && price > 0 ? `$${price.toFixed(2)}` : "—"}
                        </span>
                      </div>
                    );
                  });
                } catch {
                  return <p className="text-sm text-[#8A8278]">{postcard.research.find((r) => r.source === "ebay_sold")!.data}</p>;
                }
              })()}
            </div>
          ) : (
            <div className="bg-[#FFFCF5] rounded-lg p-4 text-sm text-[#B8B0A4] text-center">
              No comparables found yet. Run research to find similar sold listings.
            </div>
          )}
        </div>

        {/* Price Recommendation */}
        <div className="bg-white rounded-xl border border-[#FFF0D4] p-5">
          <h3 className="text-[10px] uppercase tracking-[1.2px] text-[#B8B0A4] font-medium mb-3">Price Recommendation</h3>
          {postcard.research.find((r) => r.source === "price_recommendation") ? (
            <div className="flex gap-3">
              {(() => {
                try {
                  const data = JSON.parse(postcard.research.find((r) => r.source === "price_recommendation")!.data);
                  return (
                    <>
                      <div className="flex-1 text-center bg-[#FFF8F0] rounded-lg p-3">
                        <div className="text-[10px] text-[#B8B0A4]">Quick Sale</div>
                        <div className="text-lg font-bold text-[#2D2A26] mt-1">${data.quick || data.low || "\u2014"}</div>
                      </div>
                      <div className="flex-1 text-center bg-gradient-to-b from-[#FFF4D6] to-[#FFE8B0] rounded-lg p-3">
                        <div className="text-[10px] text-[#8A6A10] font-medium">Recommended</div>
                        <div className="text-lg font-bold text-[#2D2A26] mt-1">${data.recommended || data.mid || "\u2014"}</div>
                      </div>
                      <div className="flex-1 text-center bg-[#FFF8F0] rounded-lg p-3">
                        <div className="text-[10px] text-[#B8B0A4]">Collector</div>
                        <div className="text-lg font-bold text-[#2D2A26] mt-1">${data.collector || data.high || "\u2014"}</div>
                      </div>
                    </>
                  );
                } catch {
                  return <p className="text-sm text-[#8A8278]">Unable to parse pricing data.</p>;
                }
              })()}
              {(() => {
                try {
                  const data = JSON.parse(postcard.research.find((r) => r.source === "price_recommendation")!.data);
                  if (data.reasoning) {
                    return (
                      <p className="text-xs text-[#8A8278] mt-3 italic leading-relaxed">{data.reasoning}</p>
                    );
                  }
                } catch { /* ignore */ }
                return null;
              })()}
            </div>
          ) : (
            <div className="flex gap-3">
              <div className="flex-1 text-center bg-[#FFF8F0] rounded-lg p-3">
                <div className="text-[10px] text-[#B8B0A4]">Quick Sale</div>
                <div className="text-lg font-bold text-[#D4CFC6] mt-1">{"\u2014"}</div>
              </div>
              <div className="flex-1 text-center bg-[#FFF8F0] rounded-lg p-3">
                <div className="text-[10px] text-[#B8B0A4]">Recommended</div>
                <div className="text-lg font-bold text-[#D4CFC6] mt-1">{"\u2014"}</div>
              </div>
              <div className="flex-1 text-center bg-[#FFF8F0] rounded-lg p-3">
                <div className="text-[10px] text-[#B8B0A4]">Collector</div>
                <div className="text-lg font-bold text-[#D4CFC6] mt-1">{"\u2014"}</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
