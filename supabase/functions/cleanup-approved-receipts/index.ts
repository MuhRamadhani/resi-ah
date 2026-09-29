import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  const authHeader = req.headers.get("Authorization") ?? "";
  if (authHeader !== `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Ambil semua receipts
  const { data: receipts, error: fetchErr } = await supabase
    .from("receipts")
    .select("id, nama, nomor_hp, nominal, jam_transfer, image_url, created_at")
    .order("created_at", { ascending: true }); // oldest first → yang disimpan adalah yang pertama

  if (fetchErr) {
    return new Response(JSON.stringify({ error: fetchErr.message }), { status: 500 });
  }

  if (!receipts || receipts.length === 0) {
    return new Response(JSON.stringify({ success: true, images_removed: 0, duplicates_deleted: 0 }), { status: 200 });
  }

  // ── 1. Hapus SEMUA image dari Storage ───────────────────────────
  const allFilePaths = receipts
    .map((r: any) => extractFilePath(r.image_url))
    .filter(Boolean) as string[];

  let imagesRemoved = 0;
  if (allFilePaths.length > 0) {
    for (let i = 0; i < allFilePaths.length; i += 100) {
      const batch = allFilePaths.slice(i, i + 100);
      const { error: storErr } = await supabase.storage.from("receipts").remove(batch);
      if (storErr) console.error("Storage remove error:", storErr.message);
      else imagesRemoved += batch.length;
    }
  }

  // Set image_url = null untuk semua (gambar sudah dihapus)
  await supabase.from("receipts").update({ image_url: null }).not("image_url", "is", null);

  // ── 2. Hapus row duplikat dari DB ────────────────────────────────
  // Duplikat = nama + nomor_hp + nominal + jam_transfer sama
  // Simpan 1 (yang created_at paling awal), hapus sisanya
  const seen = new Map<string, string>(); // key → id yang disimpan
  const duplicateIds: string[] = [];

  for (const r of receipts) {
    const key = [
      (r.nama || "").toLowerCase().trim(),
      (r.nomor_hp || "").trim(),
      String(r.nominal || 0),
      (r.jam_transfer || "").trim(),
    ].join("|");

    // Skip jika key kosong semua
    if (key === "|||") continue;

    if (!seen.has(key)) {
      seen.set(key, r.id);
    } else {
      duplicateIds.push(r.id);
    }
  }

  let duplicatesDeleted = 0;
  if (duplicateIds.length > 0) {
    // Hapus receipt_wa_messages dulu
    await supabase.from("receipt_wa_messages").delete().in("receipt_id", duplicateIds);
    // Hapus row duplikat
    for (let i = 0; i < duplicateIds.length; i += 500) {
      const batch = duplicateIds.slice(i, i + 500);
      const { error: delErr } = await supabase.from("receipts").delete().in("id", batch);
      if (!delErr) duplicatesDeleted += batch.length;
      else console.error("Delete duplicate error:", delErr.message);
    }
  }

  console.log(
    `cleanup-approved-receipts: ${imagesRemoved} images removed, ${duplicatesDeleted} duplicate rows deleted`
  );

  return new Response(
    JSON.stringify({
      success: true,
      images_removed: imagesRemoved,
      duplicates_deleted: duplicatesDeleted,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});

function extractFilePath(imageUrl: string | null): string | null {
  if (!imageUrl) return null;
  try {
    const marker = "/storage/v1/object/public/receipts/";
    const idx = imageUrl.indexOf(marker);
    if (idx !== -1) return imageUrl.slice(idx + marker.length);
    return null;
  } catch {
    return null;
  }
}
