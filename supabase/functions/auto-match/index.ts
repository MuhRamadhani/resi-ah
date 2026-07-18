import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Parse HH:mm or HH:mm:ss to minutes since midnight
function toMinutes(t: string): number {
  const m = /^(\d{1,2}):(\d{2})/.exec((t || "").trim());
  if (!m) return -1;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
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
      .select("id, nominal, transaction_time, kode_transaksi, video_id, status_match")
      .eq("status_match", "unmatched")
      .eq("transaction_date", targetDate);
    if (video_id) txQuery = txQuery.eq("video_id", video_id);
    const { data: txs, error: txErr } = await txQuery;
    if (txErr) throw txErr;

    // Load ALL pending receipts (not scoped to date, karena user upload resi bisa lintas hari)
    const { data: receipts, error: rErr } = await supabase
      .from("receipts")
      .select("id, nominal, jam_transfer, nomor_hp, nama, created_at")
      .eq("status", "pending")
      .limit(5000);
    if (rErr) throw rErr;
    console.log(`[auto-match] tx=${(txs||[]).length} pending_receipts=${(receipts||[]).length} date=${targetDate}`);

    const usedReceipts = new Set<string>();
    const auto_approve: Array<{ transaction_id: string; receipt_id: string; confidence: number }> = [];
    const review: Array<{ transaction_id: string; candidates: string[]; confidence: number }> = [];
    const unmatched: string[] = [];

    for (const tx of txs || []) {
      const txMin = toMinutes(tx.transaction_time as unknown as string);
      const candidates = (receipts || [])
        .filter((r) => !usedReceipts.has(r.id))
        .filter((r) => Math.round(Number(r.nominal)) === Math.round(Number(tx.nominal)))
        .map((r) => {
          const rMin = toMinutes(r.jam_transfer as unknown as string);
          const diff = rMin < 0 ? 999 : Math.abs(rMin - txMin);
          let conf = 0;
          if (diff === 0) conf = 100;
          else if (diff <= 2) conf = 95;
          else if (diff <= 5) conf = 90;
          return { r, diff, conf };
        })
        .filter((c) => c.conf > 0)
        .sort((a, b) => b.conf - a.conf || a.diff - b.diff);

      if (candidates.length === 0) {
        unmatched.push(tx.id);
        continue;
      }

      const top = candidates[0];
      if (top.conf === 100 && candidates.filter((c) => c.conf === 100).length === 1) {
        auto_approve.push({ transaction_id: tx.id, receipt_id: top.r.id, confidence: 100 });
        usedReceipts.add(top.r.id);
      } else {
        review.push({
          transaction_id: tx.id,
          candidates: candidates.map((c) => c.r.id),
          confidence: top.conf,
        });
      }
    }

    if (mode === "preview") {
      return new Response(
        JSON.stringify({
          success: true,
          mode,
          summary: {
            total: (txs || []).length,
            auto_approve: auto_approve.length,
            review: review.length,
            unmatched: unmatched.length,
          },
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

// redeploy: 1784182009
