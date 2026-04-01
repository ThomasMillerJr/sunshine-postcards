import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sunshine Postcards",
  description: "Postcard inventory management",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-50 min-h-screen">
        <nav className="bg-white border-b px-6 py-4 flex items-center gap-6">
          <a href="/" className="font-bold text-lg">Sunshine Postcards</a>
          <a href="/inventory" className="text-gray-600 hover:text-gray-900">Inventory</a>
          <a href="/add" className="text-gray-600 hover:text-gray-900">Add Postcard</a>
          <a href="/research" className="text-gray-600 hover:text-gray-900">Research</a>
        </nav>
        <main className="max-w-6xl mx-auto px-6 py-8">
          {children}
        </main>
      </body>
    </html>
  );
}
