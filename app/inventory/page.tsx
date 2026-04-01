"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Postcard {
  id: number;
  title: string;
  description: string;
  category: string;
  era: string;
  condition: string;
  locationDepicted: string | null;
  estimatedValue: number | null;
  createdAt: string;
}

interface PostcardImage {
  id: number;
  postcardId: number;
  side: string;
}

export default function InventoryPage() {
  const [postcards, setPostcards] = useState<Postcard[]>([]);
  const [images, setImages] = useState<Map<number, number>>(new Map());
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/postcards?limit=500").then((r) => r.json()),
    ]).then(([data]) => {
      setPostcards(data.postcards || []);
      // Build image map from postcard details (we'll fetch individually or use a bulk approach)
      setLoading(false);
    });
  }, []);

  // Get categories from data
  const categories = ["All", ...Array.from(new Set(postcards.map((p) => p.category).filter(Boolean)))];

  // Filter
  const filtered = postcards
    .filter((p) => {
      if (category !== "All" && p.category !== category) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          p.title.toLowerCase().includes(q) ||
          (p.locationDepicted || "").toLowerCase().includes(q) ||
          p.era.toLowerCase().includes(q)
        );
      }
      return true;
    })
    .sort((a, b) => {
      const av = a.estimatedValue || 0;
      const bv = b.estimatedValue || 0;
      return sortDir === "desc" ? bv - av : av - bv;
    });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-[#FFF0D4] border-t-[#F7B733] rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div>
      {/* Search */}
      <div className="mb-4">
        <div className="relative">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#B8B0A4] text-sm">&#128269;</span>
          <input
            type="text"
            placeholder="Search by title, location, era..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-white border border-[#FFF0D4] rounded-xl py-3 pl-10 pr-4 text-sm text-[#2D2A26] placeholder-[#B8B0A4] focus:border-[#F7B733] focus:ring-2 focus:ring-[#F7B73340] focus:outline-none transition-all"
          />
        </div>
      </div>

      {/* Filters + controls */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setCategory(cat)}
            className={`px-3.5 py-1.5 rounded-full text-xs font-medium border transition-all ${
              category === cat
                ? "bg-[#FFF4D6] border-[#F7B733] text-[#8A6A10] font-semibold"
                : "bg-white border-[#FFF0D4] text-[#8A8278] hover:border-[#F7B733] hover:text-[#8A6A10]"
            }`}
          >
            {cat}
          </button>
        ))}

        <div className="ml-auto flex items-center gap-3">
          <div className="flex border border-[#FFF0D4] rounded-lg overflow-hidden">
            <button
              onClick={() => setView("grid")}
              className={`px-2.5 py-1.5 text-xs ${
                view === "grid"
                  ? "bg-[#E8634A] text-white"
                  : "bg-white text-[#B8B0A4] hover:text-[#8A8278]"
              }`}
            >
              &#9638;
            </button>
            <button
              onClick={() => setView("list")}
              className={`px-2.5 py-1.5 text-xs ${
                view === "list"
                  ? "bg-[#E8634A] text-white"
                  : "bg-white text-[#B8B0A4] hover:text-[#8A8278]"
              }`}
            >
              &#9776;
            </button>
          </div>
          <button
            onClick={() => setSortDir(sortDir === "desc" ? "asc" : "desc")}
            className="text-xs text-[#B8B0A4]"
          >
            Sort: <span className="text-[#E8634A] font-semibold">Value {sortDir === "desc" ? "\u2193" : "\u2191"}</span>
          </button>
        </div>
      </div>

      {/* Count */}
      <p className="text-sm text-[#B8B0A4] mb-4">{filtered.length} postcards</p>

      {/* Empty state */}
      {filtered.length === 0 && !loading && (
        <div className="text-center py-16">
          <p className="text-lg text-[#B8B0A4]">
            {postcards.length === 0 ? "No postcards yet." : "No postcards match your search."}
          </p>
          {postcards.length === 0 && (
            <Link href="/add" className="text-[#E8634A] hover:underline mt-2 inline-block text-sm">
              Add your first postcard
            </Link>
          )}
        </div>
      )}

      {/* Grid view */}
      {view === "grid" && filtered.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filtered.map((pc) => (
            <Link
              key={pc.id}
              href={`/inventory/${pc.id}`}
              className="bg-white rounded-xl border border-[#FFF0D4] shadow-[0_2px_8px_rgba(247,183,51,0.06)] overflow-hidden hover:-translate-y-1 hover:shadow-[0_6px_20px_rgba(0,0,0,0.06)] transition-all"
            >
              <div className="aspect-[4/3] bg-[#F0EBE3] flex items-center justify-center">
                <span className="text-2xl text-[#D4CFC6]">&#128238;</span>
              </div>
              <div className="p-3">
                <p className="text-sm font-semibold text-[#2D2A26] truncate">{pc.title || "Untitled"}</p>
                <p className="text-xs text-[#B8B0A4] mt-0.5">
                  {[pc.era, pc.condition].filter(Boolean).join(" \u00B7 ") || "\u2014"}
                </p>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-sm font-bold text-[#E8634A]">
                    {pc.estimatedValue ? `$${pc.estimatedValue.toFixed(0)}` : "\u2014"}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* List view */}
      {view === "list" && filtered.length > 0 && (
        <div className="bg-white rounded-xl border border-[#FFF0D4] overflow-hidden">
          <div className="flex px-4 py-2 text-[9px] uppercase tracking-wider text-[#B8B0A4] border-b border-[#FFF0D4]">
            <span className="w-12"></span>
            <span className="flex-1">Title</span>
            <span className="w-16">Era</span>
            <span className="w-20">Condition</span>
            <span className="w-16 text-right">Value</span>
          </div>
          {filtered.map((pc, i) => (
            <Link
              key={pc.id}
              href={`/inventory/${pc.id}`}
              className={`flex items-center px-4 py-2.5 border-b border-[#FFF8F0] hover:bg-[#FFFCF5] transition-colors ${
                i % 2 === 0 ? "bg-white" : "bg-[#FFFDF8]"
              }`}
            >
              <div className="w-10 h-7 rounded bg-[#F0EBE3] flex items-center justify-center mr-3 flex-shrink-0">
                <span className="text-xs text-[#D4CFC6]">&#128238;</span>
              </div>
              <span className="flex-1 text-sm font-semibold text-[#2D2A26] truncate">{pc.title || "Untitled"}</span>
              <span className="w-16 text-xs text-[#8A8278]">{pc.era || "\u2014"}</span>
              <span className="w-20 text-xs text-[#8A8278]">{pc.condition || "\u2014"}</span>
              <span className="w-16 text-sm font-bold text-[#E8634A] text-right">
                {pc.estimatedValue ? `$${pc.estimatedValue.toFixed(0)}` : "\u2014"}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
