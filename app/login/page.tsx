"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [pin, setPin] = useState(["", "", "", ""]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const router = useRouter();

  const handleChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const newPin = [...pin];
    newPin[index] = value.slice(-1);
    setPin(newPin);
    setError("");

    if (value && index < 3) {
      inputs.current[index + 1]?.focus();
    }

    // Auto-submit when all 4 digits entered
    if (value && index === 3 && newPin.every((d) => d)) {
      submitPin(newPin.join(""));
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !pin[index] && index > 0) {
      inputs.current[index - 1]?.focus();
    }
  };

  const submitPin = async (code: string) => {
    setLoading(true);
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: code }),
      });

      if (res.ok) {
        router.push("/");
        router.refresh();
      } else {
        const data = await res.json();
        setError(data.error || "Invalid PIN");
        setPin(["", "", "", ""]);
        inputs.current[0]?.focus();
      }
    } catch {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#FFFCF5]">
      <div className="bg-white rounded-2xl shadow-[0_4px_24px_rgba(247,183,51,0.1)] border border-[#FFF0D4] p-10 w-full max-w-sm text-center">
        <img
          src="/logo.png"
          alt="Sunshine Postcards"
          className="h-20 mx-auto mb-6"
        />
        <p className="text-[#B8B0A4] text-sm mb-8">Enter your PIN to continue</p>
        <div className="flex gap-3 justify-center mb-5">
          {pin.map((digit, i) => (
            <input
              key={i}
              ref={(el) => { inputs.current[i] = el; }}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={digit}
              onChange={(e) => handleChange(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              disabled={loading}
              className="w-16 h-16 text-center text-2xl font-bold border-2 border-[#FFF0D4] rounded-xl focus:border-[#F7B733] focus:ring-2 focus:ring-[#F7B73340] focus:outline-none transition-all bg-[#FFFCF5] text-[#2D2A26] disabled:opacity-50"
            />
          ))}
        </div>
        {error && <p className="text-[#E8634A] text-sm font-medium">{error}</p>}
        {loading && (
          <div className="mt-4">
            <div className="w-6 h-6 border-2 border-[#FFF0D4] border-t-[#F7B733] rounded-full animate-spin mx-auto"></div>
          </div>
        )}
      </div>
    </div>
  );
}
