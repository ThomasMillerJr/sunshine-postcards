import { getDb } from "@/lib/db";
import { postcards, postcardImages } from "@/lib/schema";
import { desc } from "drizzle-orm";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  const db = getDb();
  const allPostcards = db
    .select()
    .from(postcards)
    .orderBy(desc(postcards.createdAt))
    .all();

  const allImages = db.select().from(postcardImages).all();
  const imageMap = new Map<number, typeof allImages[0]>();
  for (const img of allImages) {
    if (!imageMap.has(img.postcardId)) {
      imageMap.set(img.postcardId, img);
    }
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">Inventory</h1>
        <Link
          href="/add"
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
        >
          Add Postcard
        </Link>
      </div>

      {allPostcards.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <p className="text-lg">No postcards yet.</p>
          <Link href="/add" className="text-blue-600 hover:underline mt-2 inline-block">
            Add your first postcard
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {allPostcards.map((pc) => {
            const thumb = imageMap.get(pc.id);
            return (
              <Link
                key={pc.id}
                href={`/inventory/${pc.id}`}
                className="bg-white rounded-lg border shadow-sm overflow-hidden hover:shadow-md transition-shadow"
              >
                {thumb ? (
                  <img
                    src={`/api/images/${thumb.id}`}
                    alt={pc.title}
                    className="w-full h-40 object-cover"
                  />
                ) : (
                  <div className="w-full h-40 bg-gray-100 flex items-center justify-center text-gray-400">
                    No image
                  </div>
                )}
                <div className="p-3">
                  <p className="font-medium truncate">{pc.title || "Untitled"}</p>
                  <p className="text-sm text-gray-500">{pc.era} &middot; {pc.condition}</p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
