"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";

export default function FeedbackBubble() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  if (pathname === "/login") return null;

  const reset = () => {
    setTitle("");
    setDescription("");
    setError("");
    setSuccess(false);
  };

  const handleClose = () => {
    setOpen(false);
    reset();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), description: description.trim() }),
      });

      if (!res.ok) {
        try {
          const data = await res.json();
          setError(data.error || "Something went wrong");
        } catch {
          setError("Something went wrong");
        }
        return;
      }

      setSuccess(true);
      setTimeout(() => {
        handleClose();
      }, 2000);
    } catch {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Floating button */}
      {!open && (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 w-12 h-12 rounded-full bg-gradient-to-br from-[#F7B733] to-[#F0A030] text-white shadow-[0_4px_12px_rgba(247,183,51,0.4)] hover:shadow-[0_6px_16px_rgba(247,183,51,0.5)] hover:-translate-y-0.5 transition-all flex items-center justify-center"
        aria-label="Send feedback"
      >
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </button>
      )}

      {/* Modal overlay */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={handleClose} onKeyDown={(e) => { if (e.key === "Escape") handleClose(); }}>
          <div
            className="bg-white rounded-2xl shadow-[0_4px_24px_rgba(247,183,51,0.1)] border border-[#FFF0D4] p-6 w-full max-w-md mx-4"
            onClick={(e) => e.stopPropagation()}
            role="dialog" aria-modal="true"
          >
            {success ? (
              <div className="text-center py-6">
                <div className="text-2xl mb-2">&#10003;</div>
                <p className="text-[#2D2A26] font-medium">Feedback submitted!</p>
                <p className="text-[#8A8278] text-sm mt-1">A GitHub issue has been created.</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit}>
                <h2 className="text-lg font-semibold text-[#2D2A26] mb-4">Send Feedback</h2>

                <label className="block text-sm font-medium text-[#2D2A26] mb-1">
                  Title <span className="text-[#E8634A]">*</span>
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={200}
                  required
                  placeholder="What's on your mind?"
                  className="w-full px-3 py-2 border-2 border-[#FFF0D4] rounded-xl text-sm text-[#2D2A26] placeholder-[#B8B0A4] focus:border-[#F7B733] focus:ring-2 focus:ring-[#F7B73340] focus:outline-none transition-all mb-3"
                />

                <label className="block text-sm font-medium text-[#2D2A26] mb-1">
                  Description
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={5000}
                  rows={4}
                  placeholder="Tell us more (optional)"
                  className="w-full px-3 py-2 border-2 border-[#FFF0D4] rounded-xl text-sm text-[#2D2A26] placeholder-[#B8B0A4] focus:border-[#F7B733] focus:ring-2 focus:ring-[#F7B73340] focus:outline-none transition-all mb-4 resize-none"
                />

                {error && (
                  <div className="bg-[#FFF0EB] rounded-lg p-3 text-sm text-[#E8634A] mb-3">
                    {error}
                  </div>
                )}

                <div className="flex gap-3 justify-end">
                  <button
                    type="button"
                    onClick={handleClose}
                    className="px-4 py-2 text-sm font-medium text-[#8A8278] hover:text-[#2D2A26] transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={loading || !title.trim()}
                    className="bg-gradient-to-br from-[#F7B733] to-[#F0A030] text-white px-5 py-2 rounded-lg text-sm font-semibold shadow-[0_2px_8px_rgba(247,183,51,0.25)] hover:shadow-[0_4px_12px_rgba(247,183,51,0.4)] hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-[0_2px_8px_rgba(247,183,51,0.25)]"
                  >
                    {loading ? (
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      "Submit Feedback"
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
