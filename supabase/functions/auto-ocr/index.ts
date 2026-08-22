/**
 * auto-ocr — Fire-and-forget OCR untuk resi yang baru masuk dari wa-webhook.
 *
 * Flow:
 *   1. Terima { receipt_id }
 *   2. Ambil receipt dari DB (image_url, status)
 *   3. Panggil ocr-receipt-ai dengan image_url
 *   4. Cek blocked list (blocked_identifiers)
 *   5. Update receipt: nominal, jam_transfer, nama (dari OCR), status
 *      - Jika blocked → delete receipt (sama dengan perilaku AdminDashboard)
 *      - Jika OCR gagal → biarkan status "Pending", admin bisa OCR manual
 *   6. Trigger auto-match untuk tanggal transaksi
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  try {
    const { receipt_id } = await req.json();
    if (!receipt_id) {
      return new Response(JSON.stringify({ error: "receipt_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Ambil receipt
    const { data: receipt, error: rErr } = await supabase
      .from("receipts")
      .select("id, image_url, status, nama, nomor_hp, keterangan")
      .eq("id", receipt_id)
      .single();

    if (rErr || !receipt) {
      return new Response(JSON.stringify({ error: "receipt not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!receipt.image_url) {
      return new Response(JSON.stringify({ error: "no image_url" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Panggil ocr-receipt-ai
    const ocrResp = await fetch(`${SUPABASE_URL}/functions/v1/ocr-receipt-ai`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_ROLE}`,
      },
      body: JSON.stringify({ image_url: receipt.image_url }),
    });

    if (!ocrResp.ok) {
      console.error("[auto-ocr] ocr-receipt-ai error", ocrResp.status, await ocrResp.text());
      return new Response(JSON.stringify({ success: false, reason: "ocr_error" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ocr = await ocrResp.json();
    console.log("[auto-ocr] ocr result:", JSON.stringify(ocr));

    // OCR gagal parse — nominal atau jam null/0 berarti gambar tidak terbaca
    if (ocr.error || ocr.nominal == null || ocr.jam == null) {
      console.error("[auto-ocr] OCR tidak berhasil baca nominal/jam", ocr);
      return new Response(JSON.stringify({ success: false, reason: "ocr_incomplete", ocr }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Cek blocked list
    const { data: blockedRows } = await supabase
      .from("blocked_identifiers")
      .select("type, value");

    const blockedNames: string[] = [];
    const blockedPhones: string[] = [];
    for (const row of blockedRows || []) {
      if (row.type === "name") blockedNames.push((row.value as string).toLowerCase());
      else if (row.type === "phone") blockedPhones.push(row.value as string);
    }

    // Teks gabungan untuk cek nama
    const checkText = [
      ocr.nama_penerima || "",
      ocr.keterangan || "",
      receipt.nama || "",
      receipt.keterangan || "",
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    const isNameBlocked = blockedNames.some((n) => n && checkText.includes(n));
    const isPhoneBlocked = blockedPhones.some(
      (p) =>
        (receipt.nomor_hp || "").replace(/[^0-9]/g, "").includes(p.replace(/[^0-9]/g, "")) ||
        p.replace(/[^0-9]/g, "").includes((receipt.nomor_hp || "").replace(/[^0-9]/g, "")),
    );

    if (isNameBlocked || isPhoneBlocked) {
      // Hapus receipt (sama dengan perilaku auto-delete di AdminDashboard)
      await supabase.from("receipts").delete().eq("id", receipt_id);
      console.error(
        `[auto-ocr] Receipt ${receipt_id} dihapus (blocked: name=${isNameBlocked}, phone=${isPhoneBlocked})`,
      );
      return new Response(
        JSON.stringify({ success: true, action: "deleted_blocked" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 4. Update receipt dengan hasil OCR
    const keteranganFull = [ocr.nama_penerima, ocr.keterangan]
      .filter(Boolean)
      .join(" · ") || receipt.keterangan || "";

    const updatePayload: Record<string, unknown> = {
      nominal: ocr.nominal,
      jam_transfer: ocr.jam,
      updated_at: new Date().toISOString(),
    };
    if (ocr.keterangan || ocr.nama_penerima) {
      // Simpan keterangan gabungan (nama_penerima + catatan)
      updatePayload.keterangan = keteranganFull || receipt.keterangan;
    }

    await supabase
      .from("receipts")
      .update(updatePayload)
      .eq("id", receipt_id);

    // 5. Trigger auto-match untuk tanggal hari ini (atau tanggal dari OCR jika ada)
    const targetDate =
      ocr.tanggal || new Date().toISOString().slice(0, 10);

    const matchResp = await fetch(`${SUPABASE_URL}/functions/v1/auto-match`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_ROLE}`,
      },
      body: JSON.stringify({ mode: "apply", transaction_date: targetDate }),
    });

    const matched = matchResp.ok;
    if (!matchResp.ok) {
      console.error("[auto-ocr] auto-match failed", matchResp.status);
    }

    return new Response(
      JSON.stringify({
        success: true,
        receipt_id,
        ocr: { nominal: ocr.nominal, jam: ocr.jam, tanggal: ocr.tanggal },
        matched,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[auto-ocr] fatal", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
