/**
 * cleanup-approved-receipts
 * Dijalankan setiap jam 12 malam WIB via pg_cron.
 *
 * Yang dilakukan:
 * 1. Hapus SEMUA image dari Storage bucket "receipts"
 * 2. Hapus row duplikat dari DB (keep row terlama per nomor_hp+nominal+jam_transfer)
 * 3. Set image_url = null untuk semua approved receipts
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function extractFilePath(url: string | null): string | null {
  if (!url) return null;
  const marker = "/storage/v1/object/public/receipts/";
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return url.slice(idx + marker.length);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  try {
    // 1. Ambil semua receipts yang punya image_url
    const { data: receipts, error: fetchErr } = await supabase
      .from("receipts")
      .select("id, image_url, nama, nomor_hp, nominal, jam_transfer, created_at")
      .not("image_url", "is", null);

    if (fetchErr) throw fetchErr;
    if (!receipts || receipts.length === 0) {
      return new Response(JSON.stringify({ success: true, message: "Tidak ada image untuk dihapus" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[cleanup] Ditemukan ${receipts.length} receipts dengan image`);

    // 2. Kumpulkan semua file path
    const allFilePaths = receipts
      .map((r) => extractFilePath(r.image_url))
      .filter((p): p is string => !!p);

    // 3. Hapus dari Storage dalam batch 100
    let storageDeleted = 0;
    let storageErrors = 0;
    for (let i = 0; i < allFilePaths.length; i += 100) {
      const batch = allFilePaths.slice(i, i + 100);
      const { data, error } = await supabase.storage.from("receipts").remove(batch);
      if (error) {
        console.error(`[cleanup] Storage batch error:`, error.message);
        storageErrors++;
      } else {
        storageDeleted += (data || []).length;
      }
    }

    console.log(`[cleanup] Storage: ${storageDeleted} dihapus, ${storageErrors} batch error`);

    // 4. Set image_url = null untuk semua receipts
    const allIds = receipts.map((r) => r.id);
    for (let i = 0; i < allIds.length; i += 500) {
      const batch = allIds.slice(i, i + 500);
      await supabase.from("receipts").update({ image_url: null }).in("id", batch);
    }

    // 5. Cari duplikat: sama nomor_hp + nominal + jam_transfer → keep terlama, hapus sisanya
    const seen = new Map<string, string>(); // key → id terlama
    const duplicateIds: string[] = [];

    // Sort by created_at ASC agar terlama duluan
    const sorted = [...receipts].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );

    for (const r of sorted) {
      const key = [
        (r.nama || "").toLowerCase().trim(),
        (r.nomor_hp || "").replace(/[^0-9]/g, ""),
        String(r.nominal || ""),
        (r.jam_transfer || "").trim(),
      ].join("|");

      if (!seen.has(key)) {
        seen.set(key, r.id);
      } else {
        duplicateIds.push(r.id);
      }
    }

    let dbDeleted = 0;
    if (duplicateIds.length > 0) {
      console.log(`[cleanup] Menghapus ${duplicateIds.length} row duplikat`);
      // Hapus receipt_wa_messages dulu (FK)
      for (let i = 0; i < duplicateIds.length; i += 100) {
        const batch = duplicateIds.slice(i, i + 100);
        await supabase.from("receipt_wa_messages").delete().in("receipt_id", batch);
      }
      // Hapus receipts duplikat
      for (let i = 0; i < duplicateIds.length; i += 100) {
        const batch = duplicateIds.slice(i, i + 100);
        const { error } = await supabase.from("receipts").delete().in("id", batch);
        if (!error) dbDeleted += batch.length;
      }
    }

    const result = {
      success: true,
      storage_deleted: storageDeleted,
      storage_errors: storageErrors,
      db_duplicates_deleted: dbDeleted,
      total_receipts_processed: receipts.length,
    };

    console.log("[cleanup] Selesai:", result);

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[cleanup] Fatal error:", msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
