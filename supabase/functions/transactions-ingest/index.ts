import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface TxIn {
  nominal: number;
  transaction_time: string; // 'HH:mm' or 'HH:mm:ss'
  kode_transaksi?: string | null;
  ocr_confidence?: number | null;
  raw_ocr?: string | null;
}

function normalizeTime(t: string): string {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec((t || "").trim());
  if (!m) return "";
  const hh = String(Math.min(23, parseInt(m[1], 10))).padStart(2, "0");
  const mm = m[2];
  const ss = m[3] || "00";
  return `${hh}:${mm}:${ss}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  try {
    const body = await req.json();
    const {
      video_meta = {},
      transaction_date,
      transactions = [],
    } = body as {
      video_meta: Record<string, any>;
      transaction_date?: string;
      transactions: TxIn[];
    };

    if (!Array.isArray(transactions)) {
      return new Response(JSON.stringify({ error: "transactions must be array" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Insert video log
    const { data: video, error: vErr } = await supabase
      .from("merchant_videos")
      .insert({
        file_name: video_meta.file_name || "unknown.mp4",
        file_size_bytes: video_meta.file_size_bytes ?? null,
        duration_seconds: video_meta.duration_seconds ?? null,
        total_frames: video_meta.total_frames ?? 0,
        used_frames: video_meta.used_frames ?? 0,
        processing_time_ms: video_meta.processing_time_ms ?? null,
        status: "processing",
      })
      .select()
      .single();

    if (vErr) throw vErr;

    // Prepare rows
    const today = transaction_date || new Date().toISOString().slice(0, 10);
    const rows = transactions
      .map((t) => ({
        nominal: Math.round(Number(t.nominal) || 0),
        transaction_time: normalizeTime(t.transaction_time),
        transaction_date: today,
        kode_transaksi: t.kode_transaksi || null,
        ocr_confidence: t.ocr_confidence ?? null,
        raw_ocr: t.raw_ocr || null,
        video_id: video.id,
      }))
      .filter((r) => r.nominal > 0 && r.transaction_time);

    let inserted = 0;
    let duplicates = 0;

    // Insert one-by-one so we can count duplicates via unique index violation
    // For efficiency, batch by chunks and rely on returning count.
    const CHUNK = 200;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const { data, error } = await supabase
        .from("transactions")
        .upsert(chunk, {
          onConflict: "transaction_date,nominal,transaction_time,kode_transaksi",
          ignoreDuplicates: true,
        })
        .select("id");
      if (error) {
        console.error("upsert error", error.message);
        // Fallback: try inserting one by one
        for (const row of chunk) {
          const { error: e2 } = await supabase.from("transactions").insert(row);
          if (!e2) inserted++;
          else duplicates++;
        }
      } else {
        inserted += (data || []).length;
        duplicates += chunk.length - (data || []).length;
      }
    }

    await supabase
      .from("merchant_videos")
      .update({
        transactions_parsed: rows.length,
        duplicates_skipped: duplicates,
        status: "completed",
      })
      .eq("id", video.id);

    return new Response(
      JSON.stringify({
        success: true,
        video_id: video.id,
        inserted,
        duplicates_skipped: duplicates,
        total: rows.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("ingest error", e instanceof Error ? e.message : "unknown");
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// redeploy: 1784182009
