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
  images: { id: number; side: string; filePath: string; cropBox: string | null }[];
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

function CroppedImg({ src, alt, cropBox, className }: { src: string; alt: string; cropBox?: string | null; className?: string }) {
  if (!cropBox) {
    return <img src={src} alt={alt} className={className || "w-full h-full object-cover"} />;
  }
  try {
    const { x, y, width, height } = JSON.parse(cropBox);
    // Scale = how much bigger the full image is vs the crop region
    const scaleX = 100 / width;
    const scaleY = 100 / height;
    // Position the image so the crop region's center aligns with the container center
    const posX = -(x * scaleX) + (100 - width * scaleX) / 2;
    const posY = -(y * scaleY) + (100 - height * scaleY) / 2;
    return (
      <img
        src={src}
        alt={alt}
        className={className || "absolute"}
        style={{
          width: `${scaleX * 100}%`,
          height: `${scaleY * 100}%`,
          left: `${posX}%`,
          top: `${posY}%`,
          objectFit: "cover",
        }}
      />
    );
  } catch {
    return <img src={src} alt={alt} className={className || "w-full h-full object-cover"} />;
  }
}

function AnalysisDisplay({ data }: { data: string }) {
  try {
    const analysis = JSON.parse(data);
    const c = analysis.classification;
    const v = analysis.visual_inventory;
    return (
      <div className="space-y-4">
        {/* Summary row */}
        <div className="bg-[#FFFCF5] rounded-lg p-4">
          <div className="flex flex-wrap gap-2 mb-3">
            {c?.card_type?.value && (
              <span className="inline-block bg-[#FFF4D6] text-[#8A6A10] px-2 py-0.5 rounded text-xs font-medium">
                {c.card_type.value.replace(/_/g, " ")}
              </span>
            )}
            {c?.era?.date_range && (
              <span className="inline-block bg-[#F0EBE3] text-[#8A8278] px-2 py-0.5 rounded text-xs">
                {c.era.date_range}
              </span>
            )}
            {c?.condition?.grade && (
              <span className="inline-block bg-[#E8F5E9] text-[#2E7D32] px-2 py-0.5 rounded text-xs font-medium">
                {c.condition.grade}
              </span>
            )}
            {c?.suspected_reproduction?.value && (
              <span className="inline-block bg-[#FFF0EB] text-[#E8634A] px-2 py-0.5 rounded text-xs font-medium">
                Possible Reproduction
              </span>
            )}
          </div>
          {v?.front?.image_description && (
            <p className="text-sm text-[#8A8278] leading-relaxed">{v.front.image_description}</p>
          )}
        </div>

        {/* Classification details */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          {c?.publisher?.name && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#B8B0A4]">Publisher</div>
              <div className="text-[#2D2A26]">{c.publisher.name}</div>
            </div>
          )}
          {c?.location?.city && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#B8B0A4]">Location</div>
              <div className="text-[#2D2A26]">
                {[c.location.specific_place, c.location.city, c.location.state].filter(Boolean).join(", ")}
              </div>
            </div>
          )}
          {c?.primary_subject && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#B8B0A4]">Subject</div>
              <div className="text-[#2D2A26]">{c.primary_subject}</div>
            </div>
          )}
          {c?.condition?.postally_used !== undefined && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#B8B0A4]">Postally Used</div>
              <div className="text-[#2D2A26]">{c.condition.postally_used ? "Yes" : "No"}</div>
            </div>
          )}
        </div>

        {/* Subject tags */}
        {c?.subject_tags?.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[#B8B0A4] mb-1">Tags</div>
            <div className="flex flex-wrap gap-1">
              {c.subject_tags.map((tag: string) => (
                <span key={tag} className="inline-block bg-[#F5F0EA] text-[#8A8278] px-2 py-0.5 rounded text-xs">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Cross-collectible */}
        {c?.cross_collectible_categories?.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[#B8B0A4] mb-1">Cross-Collectible Appeal</div>
            <div className="flex flex-wrap gap-1">
              {c.cross_collectible_categories.map((cat: string) => (
                <span key={cat} className="inline-block bg-[#FFF4D6] text-[#8A6A10] px-2 py-0.5 rounded text-xs">
                  {cat}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Condition defects */}
        {c?.condition?.defects?.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[#B8B0A4] mb-1">Defects</div>
            <ul className="text-xs text-[#8A8278] list-disc list-inside">
              {c.condition.defects.map((d: string, i: number) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Uncertainty flags */}
        {analysis.uncertainty_flags?.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[#B8B0A4] mb-1">Uncertainties</div>
            <div className="space-y-1">
              {analysis.uncertainty_flags.map((f: { field: string; issue: string; recommendation: string }, i: number) => (
                <div key={i} className="bg-[#FFF8F0] rounded p-2 text-xs">
                  <span className="font-medium text-[#8A6A10]">{f.field}:</span>{" "}
                  <span className="text-[#8A8278]">{f.issue}</span>
                  {f.recommendation && (
                    <div className="text-[#B8B0A4] mt-0.5 italic">{f.recommendation}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Handwritten text */}
        {v?.back?.handwritten_text?.present && v.back.handwritten_text.transcription && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[#B8B0A4] mb-1">Handwritten Text</div>
            <div className="bg-[#FFFCF5] rounded p-3 text-sm text-[#8A8278] italic leading-relaxed">
              &ldquo;{v.back.handwritten_text.transcription}&rdquo;
            </div>
          </div>
        )}
      </div>
    );
  } catch {
    return <pre className="text-xs text-[#8A8278] whitespace-pre-wrap overflow-x-auto">{data}</pre>;
  }
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
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

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

  const analyze = async () => {
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const res = await fetch(`/api/postcards/${id}/analyze`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Analysis failed");
      }
      const data = await res.json();
      setPostcard((prev) =>
        prev
          ? {
              ...prev,
              ...data.postcard,
              images: prev.images,
              transactions: prev.transactions,
              research: [
                ...prev.research.filter((r) => r.source !== "ai_analysis"),
                data.analysis,
              ],
            }
          : prev
      );
    } catch (err) {
      setAnalyzeError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setAnalyzing(false);
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
              <div className="aspect-[4/3] rounded-xl overflow-hidden bg-[#F0EBE3] mb-2 relative">
                <CroppedImg
                  src={`/api/images/${postcard.images[activeImage]?.id}`}
                  alt={postcard.images[activeImage]?.side}
                  cropBox={postcard.images[activeImage]?.cropBox}
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

          {/* Badges */}
          <div className="mt-4 flex flex-wrap gap-2">
            {postcard.estimatedValue ? (
              <span className="inline-block bg-gradient-to-r from-[#F7B733] to-[#F0A030] text-white px-4 py-1.5 rounded-lg text-sm font-bold shadow-[0_2px_8px_rgba(247,183,51,0.2)]">
                Est. ${postcard.estimatedValue.toFixed(2)}
              </span>
            ) : (
              <span className="inline-block bg-[#F5F0EA] text-[#B8B0A4] px-4 py-1.5 rounded-lg text-sm">
                No estimate yet
              </span>
            )}
            {(() => {
              const pr = postcard.research.find((r) => r.source === "price_recommendation");
              if (!pr) return null;
              try {
                const data = JSON.parse(pr.data);
                const v = data.verdict as string;
                const label = data.verdictLabel as string;
                const colors: Record<string, string> = {
                  common: "bg-[#F0EBE3] text-[#8A8278]",
                  moderate: "bg-[#FFF4D6] text-[#8A6A10]",
                  collector: "bg-[#E8F5E9] text-[#2E7D32]",
                  unknown: "bg-[#F5F0EA] text-[#B8B0A4]",
                };
                return (
                  <span className={`inline-block px-3 py-1.5 rounded-lg text-sm font-medium ${colors[v] || colors.unknown}`}>
                    {label}
                  </span>
                );
              } catch { return null; }
            })()}
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
        <h2 className="text-lg font-bold text-[#2D2A26]" style={{ fontFamily: "'DM Serif Display', Georgia, serif" }}>
          Research
        </h2>

        {/* AI Analysis */}
        <div className="bg-white rounded-xl border border-[#FFF0D4] p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[10px] uppercase tracking-[1.2px] text-[#B8B0A4] font-medium">AI Analysis</h3>
            <button
              onClick={analyze}
              disabled={analyzing || postcard.images.length === 0}
              className="bg-gradient-to-br from-[#F7B733] to-[#F0A030] text-white px-3 py-1.5 rounded-lg text-xs font-semibold shadow-[0_2px_8px_rgba(247,183,51,0.25)] hover:shadow-[0_4px_12px_rgba(247,183,51,0.4)] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {analyzing ? "Analyzing..." : postcard.research.find((r) => r.source === "ai_analysis") ? "Re-analyze" : "Analyze"}
            </button>
          </div>
          {analyzing && (
            <div className="flex items-center gap-3 bg-[#FFFCF5] rounded-lg p-4">
              <div className="w-5 h-5 border-2 border-[#FFF0D4] border-t-[#F7B733] rounded-full animate-spin flex-shrink-0"></div>
              <span className="text-sm text-[#8A8278]">Analyzing postcard images with Claude...</span>
            </div>
          )}
          {analyzeError && (
            <div className="bg-[#FFF0EB] rounded-lg p-4 text-sm text-[#E8634A]">{analyzeError}</div>
          )}
          {!analyzing && postcard.research.find((r) => r.source === "ai_analysis") && (
            <AnalysisDisplay data={postcard.research.find((r) => r.source === "ai_analysis")!.data} />
          )}
          {!analyzing && !analyzeError && !postcard.research.find((r) => r.source === "ai_analysis") && (
            <div className="bg-[#FFFCF5] rounded-lg p-4 text-sm text-[#B8B0A4] text-center">
              No AI analysis yet. Click Analyze to identify this postcard.
            </div>
          )}
        </div>

        {/* eBay Comparables */}
        <div className="bg-white rounded-xl border border-[#FFF0D4] p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[10px] uppercase tracking-[1.2px] text-[#B8B0A4] font-medium">eBay Sold Comparables</h3>
            <button
              onClick={runResearch}
              disabled={researching}
              className="bg-gradient-to-br from-[#F7B733] to-[#F0A030] text-white px-3 py-1.5 rounded-lg text-xs font-semibold shadow-[0_2px_8px_rgba(247,183,51,0.25)] hover:shadow-[0_4px_12px_rgba(247,183,51,0.4)] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              {researching ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  Researching...
                </>
              ) : (
                <>{postcard.research.find((r) => r.source === "ebay_sold") ? "Re-research" : "Find Comps"}</>
              )}
            </button>
          </div>
          {researchError && (
            <div className="bg-[#FFF0EB] rounded-lg p-3 text-sm text-[#E8634A] mb-3">{researchError}</div>
          )}
          {postcard.research.find((r) => r.source === "ebay_sold") ? (
            <div>
              {(() => {
                try {
                  const data = JSON.parse(postcard.research.find((r) => r.source === "ebay_sold")!.data);
                  const items = Array.isArray(data) ? data : data.items || [];
                  return items.slice(0, 15).map((item: Record<string, unknown>, i: number) => {
                    const title = (item.title || item.name || "Unknown") as string;
                    const soldPrice = parseFloat(String(item.soldPrice || item.price || 0)) || 0;
                    const totalPrice = parseFloat(String(item.totalPrice || 0)) || 0;
                    const shipping = parseFloat(String(item.shippingPrice || 0)) || 0;
                    const url = (item.url as string) || null;
                    const endedAt = (item.endedAt as string) || null;
                    const relevance = (item.relevance as number) ?? null;
                    const reason = (item.matchReason as string) || "";
                    const displayPrice = soldPrice > 0 ? soldPrice : totalPrice;
                    const dateStr = endedAt ? new Date(endedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null;
                    return (
                      <div key={i} className="py-2 border-b border-[#FFF8F0] last:border-0">
                        <div className="flex items-center gap-2">
                          {relevance !== null && (
                            <span
                              className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                                relevance >= 7 ? "bg-[#E8F5E9] text-[#2E7D32]" :
                                relevance >= 4 ? "bg-[#FFF4D6] text-[#8A6A10]" :
                                "bg-[#F0EBE3] text-[#B8B0A4]"
                              }`}
                              title={reason}
                            >
                              {relevance}
                            </span>
                          )}
                          {url ? (
                            <a href={url} target="_blank" rel="noopener noreferrer" className="text-sm text-[#2D2A26] hover:text-[#E8634A] truncate flex-1" title={reason}>
                              {title}
                            </a>
                          ) : (
                            <span className="text-sm text-[#2D2A26] truncate flex-1" title={reason}>{title}</span>
                          )}
                          <span className="text-sm font-bold text-[#2E7D32] flex-shrink-0">
                            {displayPrice > 0 ? `$${displayPrice.toFixed(2)}` : "\u2014"}
                          </span>
                        </div>
                        {(shipping > 0 || dateStr) && (
                          <div className="flex items-center gap-2 ml-8 mt-0.5">
                            {shipping > 0 && <span className="text-[10px] text-[#B8B0A4]">+${shipping.toFixed(2)} ship</span>}
                            {dateStr && <span className="text-[10px] text-[#B8B0A4]">Sold {dateStr}</span>}
                          </div>
                        )}
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
              No comparables found yet. Click Find Comps to search eBay sold listings.
            </div>
          )}
        </div>

        {/* Price Recommendation */}
        <div className="bg-white rounded-xl border border-[#FFF0D4] p-5">
          <h3 className="text-[10px] uppercase tracking-[1.2px] text-[#B8B0A4] font-medium mb-3">Price Recommendation</h3>
          {postcard.research.find((r) => r.source === "price_recommendation") ? (
            <div>
              {(() => {
                try {
                  const data = JSON.parse(postcard.research.find((r) => r.source === "price_recommendation")!.data);
                  return (
                    <>
                      <div className="flex gap-3 mb-3">
                        <div className="flex-1 text-center bg-[#FFF8F0] rounded-lg p-3">
                          <div className="text-[10px] text-[#B8B0A4]">Quick Sale</div>
                          <div className="text-lg font-bold text-[#2D2A26] mt-1">
                            {data.quick > 0 ? `$${data.quick.toFixed(2)}` : "\u2014"}
                          </div>
                        </div>
                        <div className="flex-1 text-center bg-gradient-to-b from-[#FFF4D6] to-[#FFE8B0] rounded-lg p-3">
                          <div className="text-[10px] text-[#8A6A10] font-medium">Recommended</div>
                          <div className="text-lg font-bold text-[#2D2A26] mt-1">
                            {data.recommended > 0 ? `$${data.recommended.toFixed(2)}` : "\u2014"}
                          </div>
                        </div>
                        <div className="flex-1 text-center bg-[#FFF8F0] rounded-lg p-3">
                          <div className="text-[10px] text-[#B8B0A4]">Collector</div>
                          <div className="text-lg font-bold text-[#2D2A26] mt-1">
                            {data.collector > 0 ? `$${data.collector.toFixed(2)}` : "\u2014"}
                          </div>
                        </div>
                      </div>
                      {data.bestCompMatch && (
                        <div className="bg-[#E8F5E9] rounded-lg p-3 mb-2">
                          <div className="text-[10px] uppercase tracking-wider text-[#2E7D32] font-medium mb-0.5">Best Match</div>
                          <p className="text-sm text-[#2D2A26]">{data.bestCompMatch}</p>
                        </div>
                      )}
                      {data.reasoning && (
                        <p className="text-xs text-[#8A8278] italic leading-relaxed">{data.reasoning}</p>
                      )}
                    </>
                  );
                } catch {
                  return <p className="text-sm text-[#8A8278]">Unable to parse pricing data.</p>;
                }
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
