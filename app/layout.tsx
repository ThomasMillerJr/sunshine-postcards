import type { Metadata } from "next";
import "./globals.css";
import Link from "next/link";
import Image from "next/image";
import FeedbackBubble from "./components/FeedbackBubble";

export const metadata: Metadata = {
  title: "Sunshine Postcards",
  description: "Postcard inventory & research tool",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <nav className="bg-white border-b-2 border-card-border px-7 flex items-center h-16 sticky top-0 z-50">
          <Link href="/" className="flex items-center gap-2.5 mr-8">
            <Image src="/logo.png" alt="Sunshine Postcards" width={120} height={65} priority />
          </Link>
          <div className="flex gap-1 h-full items-stretch">
            <Link
              href="/inventory"
              className="flex items-center px-4 text-sm font-medium text-text-muted hover:text-coral hover:bg-coral-light border-b-2 border-transparent -mb-[2px] transition-all"
            >
              Inventory
            </Link>
            <Link
              href="/research"
              className="flex items-center px-4 text-sm font-medium text-text-muted hover:text-coral hover:bg-coral-light border-b-2 border-transparent -mb-[2px] transition-all"
            >
              Research
            </Link>
          </div>
          <div className="ml-auto">
            <Link
              href="/add"
              className="bg-gradient-to-br from-sun-gold to-[#F0A030] text-white px-5 py-2.5 rounded-lg text-sm font-semibold shadow-[0_2px_8px_rgba(247,183,51,0.25)] hover:shadow-[0_4px_12px_rgba(247,183,51,0.4)] hover:-translate-y-0.5 transition-all"
            >
              + Add Postcard
            </Link>
          </div>
        </nav>
        <main className="max-w-[1100px] mx-auto px-7 py-8">
          {children}
        </main>
        <FeedbackBubble />
      </body>
    </html>
  );
}
