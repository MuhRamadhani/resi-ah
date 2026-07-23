import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DAY_MINUTES = 24 * 60;

// Parse HH:mm, HH:mm:ss, HH.mm, or AM/PM to minutes since midnight.
function toMinutes(t: string): number {
  const raw = String(t || "").trim();
  const m = /(\d{1,2})\s*[:.]\s*(\d{2})(?::\d{2})?\s*([ap]\.?m\.?)?/i.exec(raw);
  if (!m) return -1;

  let hour = parseInt(m[1], 10);
  const minute = parseInt(m[2], 10);
  const ampm = (m[3] || "").toLowerCase().replace(/\./g, "");

  if (minute < 0 || minute > 59) return -1;
  if (ampm === "pm" && hour < 12) hour += 12;
  if (ampm === "am" && hour === 12) hour = 0;
  if (hour < 0 || hour > 23) return -1;

  return hour * 60 + minute;
}

function normalizeMinute(value: number): number {
  return ((value % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
}

function formatMinute(value: number): string {
  const min = normalizeMinute(value);
  const hh = String(Math.floor(min / 60)).padStart(2, "0");
  const mm = String(min % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

function exactTimezoneOffsetHours(txMinute: number, receiptMinute: number): number | null {
  // Supports same timezone and ±1 hour timezone difference, but the minute must be exact.
  for (const offsetMinutes of [0, -60, 60]) {
    if (normalizeMinute(txMinute + offsetMinutes) === receiptMinute) {
      return offsetMinutes / 60;
    }
  }
  return null;
}

function circularDiffMinutes(a: number, b: number): number {
  const diff = Math.abs(normalizeMinute(a) - normalizeMinute(b));
  return Math.min(diff, DAY_MINUTES - diff);
}

function roundNominal(value: unknown): number {
  return Math.round(Number(value) || 0);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  try {
    const body = await req.json().catch(() => ({}));
    const url = new URL(req.url);
    const mode = (body.mode || url.searchParams.get("mode") || "preview") as "preview" | "apply";
    const video_id: string | undefined = body.video_id || undefined;
    const targetDate: string =
      body.transaction_date || new Date().toISOString().slice(0, 10);

    // Load unmatched transactions (scoped)
    let txQuery = supabase
      .from("transactions")
      .select("id, nominal, transaction_date, transaction_time, kode_transaksi, video_id, status_match")
      .eq("status_match", "unmatched")
      .eq("transaction_date", targetDate);
    if (video_id) txQuery = txQuery.eq("video_id", video_id);
    const { data: txs, error: txErr } = await txQuery;
    if (txErr) throw txErr;

    // Load ALL pending receipts (not scoped to date, karena user upload resi bisa lintas hari)
    const { data: receipts, error: rErr } = await supabase
      .from("receipts")
      .select("id, nominal, jam_transfer, nomor_hp, nama, status, created_at")
      .ilike("status", "pending")
      .limit(5000);
    if (rErr) throw rErr;
    console.log(`[auto-match] tx=${(txs||[]).length} pending_receipts=${(receipts||[]).length} date=${targetDate}`);

    const txItems = (txs || [])
      .map((tx: any) => ({
        ...tx,
        nominal_round: roundNominal(tx.nominal),
        minute: toMinutes(tx.transaction_time as unknown as string),
      }))
      .sort((a: any, b: any) => a.minute - b.minute || String(a.id).localeCompare(String(b.id)));

    const receiptItems = (receipts || [])
      .map((r: any) => ({
        ...r,
        nominal_round: roundNominal(r.nominal),
        minute: toMinutes(r.jam_transfer as unknown as string),
      }))
      .sort((a: any, b: any) => String(a.created_at || "").localeCompare(String(b.created_at || "")) || String(a.id).localeCompare(String(b.id)));

    const usedReceipts = new Set<string>();
    const handledTx = new Set<string>();
    const auto_approve: Array<{
      transaction_id: string;
      receipt_id: string;
      confidence: number;
      nominal: number;
      tx_time: string;
      receipt_time: string;
      time_offset_hours: number;
      reason: string;
    }> = [];
    const review: Array<{
      transaction_id: string;
      candidates: string[];
      confidence: number;
      nominal: number;
      tx_time: string;
      reason: string;
    }> = [];
    const unmatched: Array<{
      transaction_id: string;
      nominal: number;
      tx_time: string;
      reason: string;
    }> = [];

    function pushApprove(tx: any, receipt: any, offsetHours: number, reason: string) {
      auto_approve.push({
        transaction_id: tx.id,
        receipt_id: receipt.id,
        confidence: 100,
        nominal: tx.nominal_round,
        tx_time: formatMinute(tx.minute),
        receipt_time: formatMinute(receipt.minute),
        time_offset_hours: offsetHours,
        reason,
      });
      usedReceipts.add(receipt.id);
      handledTx.add(tx.id);
    }

    function availableReceiptsFor(tx: any, offsets: number[]) {
      return receiptItems
        .filter((r: any) => !usedReceipts.has(r.id))
        .filter((r: any) => r.minute >= 0 && r.nominal_round === tx.nominal_round)
        .map((r: any) => ({ r, offsetHours: exactTimezoneOffsetHours(tx.minute, r.minute) }))
        .filter((c: any) => c.offsetHours !== null && offsets.includes(c.offsetHours));
    }

    // Phase 1: exact same nominal + exact same minute. Multiple identical rows are paired one-by-one.
    for (const tx of txItems) {
      if (tx.minute < 0 || tx.nominal_round <= 0) continue;
      const exact = availableReceiptsFor(tx, [0])[0];
      if (exact) pushApprove(tx, exact.r, 0, "Nominal dan jam sama persis");
    }

    // Phase 2: timezone tolerance ±1 hour, minute must still be exact.
    for (const tx of txItems) {
      if (handledTx.has(tx.id)) continue;
      if (tx.minute < 0 || tx.nominal_round <= 0) continue;

      const zoneCandidates = availableReceiptsFor(tx, [-1, 1]);
      const distinctOffsets = new Set(zoneCandidates.map((c: any) => c.offsetHours));

      if (zoneCandidates.length === 0) continue;

      if (distinctOffsets.size > 1) {
        review.push({
          transaction_id: tx.id,
          candidates: zoneCandidates.slice(0, 10).map((c: any) => c.r.id),
          confidence: 95,
          nominal: tx.nominal_round,
          tx_time: formatMinute(tx.minute),
          reason: "Ada kandidat di +1 jam dan -1 jam, perlu pilih manual",
        });
        handledTx.add(tx.id);
        continue;
      }

      const picked = zoneCandidates[0];
      pushApprove(
        tx,
        picked.r,
        picked.offsetHours,
        picked.offsetHours === -1
          ? "Nominal sama, jam transaksi dikurangi 1 jam cocok dengan resi"
          : "Nominal sama, jam transaksi ditambah 1 jam cocok dengan resi",
      );
    }

    // Phase 3: explain anything still unmatched.
    for (const tx of txItems) {
      if (handledTx.has(tx.id)) continue;
      if (tx.nominal_round <= 0) {
        unmatched.push({
          transaction_id: tx.id,
          nominal: tx.nominal_round,
          tx_time: String(tx.transaction_time || "-"),
          reason: "Nominal transaksi tidak valid",
        });
        continue;
      }
      if (tx.minute < 0) {
        unmatched.push({
          transaction_id: tx.id,
          nominal: tx.nominal_round,
          tx_time: String(tx.transaction_time || "-"),
          reason: "Jam transaksi tidak valid",
        });
        continue;
      }

      const sameNominal = receiptItems
        .filter((r: any) => !usedReceipts.has(r.id))
        .filter((r: any) => r.nominal_round === tx.nominal_round);

      if (sameNominal.length === 0) {
        unmatched.push({
          transaction_id: tx.id,
          nominal: tx.nominal_round,
          tx_time: formatMinute(tx.minute),
          reason: "Tidak ada resi pending dengan nominal yang sama",
        });
        continue;
      }

      const validTimeReceipts = sameNominal.filter((r: any) => r.minute >= 0);
      if (validTimeReceipts.length === 0) {
        unmatched.push({
          transaction_id: tx.id,
          nominal: tx.nominal_round,
          tx_time: formatMinute(tx.minute),
          reason: "Nominal cocok, tapi jam resi kosong/tidak terbaca",
        });
        continue;
      }

      const closest = validTimeReceipts
        .map((r: any) => ({ r, diff: circularDiffMinutes(tx.minute, r.minute) }))
        .sort((a: any, b: any) => a.diff - b.diff)[0];

      unmatched.push({
        transaction_id: tx.id,
        nominal: tx.nominal_round,
        tx_time: formatMinute(tx.minute),
        reason: `Nominal cocok, tapi jam resi terdekat ${formatMinute(closest.r.minute)} beda ${closest.diff} menit. Sistem hanya approve kalau menit persis sama atau beda zona waktu tepat 1 jam.`,
      });
    }

    const debug = {
      transactions_checked: txItems.length,
      pending_receipts: receiptItems.length,
      valid_transaction_times: txItems.filter((tx: any) => tx.minute >= 0).length,
      valid_receipt_times: receiptItems.filter((r: any) => r.minute >= 0).length,
      invalid_transaction_times: txItems.filter((tx: any) => tx.minute < 0).length,
      invalid_receipt_times: receiptItems.filter((r: any) => r.minute < 0).length,
      rule: "Nominal sama + menit sama persis. Jam boleh sama, +1, atau -1 untuk beda WIB/WITA.",
    };

    if (mode === "preview") {
      return new Response(
        JSON.stringify({
          success: true,
          mode,
          summary: {
            total: (txs || []).length,
            pending_receipts: (receipts || []).length,
            auto_approve: auto_approve.length,
            review: review.length,
            unmatched: unmatched.length,
          },
          debug,
          auto_approve,
          review,
          unmatched,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // apply mode
    // Auto approve
    const approvedReceiptIds: string[] = [];
    for (const m of auto_approve) {
      const { error: e1 } = await supabase
        .from("receipts")
        .update({ status: "approved", approved_at: new Date().toISOString() })
        .eq("id", m.receipt_id)
        .eq("status", "pending");
      if (e1) {
        console.error("approve fail", e1);
        continue;
      }
      await supabase
        .from("transactions")
        .update({
          status_match: "matched",
          matched_receipt_id: m.receipt_id,
          confidence: 100,
        })
        .eq("id", m.transaction_id);
      approvedReceiptIds.push(m.receipt_id);
    }

    // Mark review
    for (const r of review) {
      await supabase
        .from("transactions")
        .update({ status_match: "review", confidence: r.confidence })
        .eq("id", r.transaction_id);
    }

    // Update video stats
    if (video_id) {
      await supabase
        .from("merchant_videos")
        .update({
          matched_count: auto_approve.length + review.length,
          auto_approved_count: approvedReceiptIds.length,
        })
        .eq("id", video_id);
    }

    // Enqueue WA notifications (existing send-wa-notification)
    if (approvedReceiptIds.length > 0) {
      try {
        await fetch(`${SUPABASE_URL}/functions/v1/send-wa-notification`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SERVICE_ROLE}`,
          },
          body: JSON.stringify({
            status: "Approved",
            receipt_ids: approvedReceiptIds,
          }),
        });
      } catch (e) {
        console.error("wa notify fail", e);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        mode,
        applied: {
          auto_approved: approvedReceiptIds.length,
          review: review.length,
          unmatched: unmatched.length,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("auto-match error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// redeploy: 1784395121
