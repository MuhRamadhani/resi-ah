import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function parseNominal(text: string): number | null {
  // Format 1: "Rp 50.000" atau "Rp50.000" (titik = ribuan, tanpa desimal) — BCA, BRI, Mandiri, dll
  // Format 2: "IDR 50,000.00" atau "IDR50,000" (koma = ribuan, titik = desimal) — Financial Diary, CIMB, dll
  // Format 3: "Rp 50,000.00" (campuran)
  // Format 4: "sebesar 50000" (tanpa prefix, fallback)

  // Coba IDR prefix dulu (format internasional: koma ribuan, titik desimal)
  let m = /IDR\s*([\d,]+(?:\.\d{1,2})?)/i.exec(text);
  if (m) {
    // Buang koma (ribuan) dan bagian desimal
    const digits = m[1].replace(/,/g, "").replace(/\.\d+$/, "");
    const n = parseInt(digits, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }

  // Coba Rp prefix
  m = /Rp\s*([\d.,]+)/i.exec(text);
  if (m) {
    const raw = m[1];
    let n: number;
    // Deteksi format: kalau ada titik diikuti tepat 2 digit di akhir → titik = desimal (Rp 50,000.00)
    if (/,\d{3}\.\d{2}$/.test(raw)) {
      // Format: 50,000.00 → koma ribuan, titik desimal
      n = parseInt(raw.replace(/,/g, "").replace(/\.\d+$/, ""), 10);
    } else {
      // Format normal: 50.000 → titik ribuan
      n = parseInt(raw.replace(/[.,]/g, ""), 10);
    }
    if (Number.isFinite(n) && n > 0) return n;
  }

  // Fallback: cari pola "sebesar X" atau "senilai X"
  m = /(?:sebesar|senilai)\s+([\d.,]+)/i.exec(text);
  if (m) {
    const digits = m[1].replace(/[.,]/g, "");
    const n = parseInt(digits, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }

  return null;
}

function parseMerchant(text: string): string | null {
  // "dari <MERCHANT> atas nama"
  const m = /dari\s+(.+?)\s+atas\s+nama/i.exec(text);
  return m ? m[1].trim() : null;
}

function parseCustomer(text: string): string | null {
  // "atas nama <CUSTOMER>." (until dot or end)
  const m = /atas\s+nama\s+(.+?)\s*\.?\s*$/i.exec(text);
  return m ? m[1].trim().replace(/\.$/, "") : null;
}

function parseTimestamp(ts: string): { date: string; time: string } | null {
  ts = ts.trim();

  // Format:
  // 2026-07-23T18:35:12+07:00
  // 2026-07-23T18:35:12
  // 2026-07-23 18:35:12
  let m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2}):(\d{2})/.exec(ts);
  if (m) {
    return {
      date: m[1],
      time: `${m[2]}:${m[3]}:${m[4]}`,
    };
  }

  // Format:
  // 23-07-2026 18:35:12
  m = /^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/.exec(ts);
  if (m) {
    return {
      date: `${m[3]}-${m[2]}-${m[1]}`,
      time: `${m[4]}:${m[5]}:${m[6]}`,
    };
  }

  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed" }, 405);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return jsonResponse({ success: false, error: "Invalid JSON body" }, 400);
    }

    const text: string = String(body.text || "").trim();
    const title: string = String(body.title || "").trim();
    const timestamp: string = String(body.timestamp || "").trim();

    if (!text) {
      return jsonResponse({ success: false, error: "Missing 'text' field" }, 400);
    }
    if (!timestamp) {
      return jsonResponse({ success: false, error: "Missing 'timestamp' field" }, 400);
    }

    const nominal = parseNominal(text);
    if (!nominal) {
      console.error("[notification-ingest] failed to parse nominal", { text_length: text.length });
      return jsonResponse({ success: false, error: "Nominal tidak dapat di-parse" }, 400);
    }

    const ts = parseTimestamp(timestamp);
    if (!ts) {
      console.error("[notification-ingest] failed to parse timestamp", { timestamp });
      return jsonResponse({ success: false, error: "Timestamp tidak valid" }, 400);
    }

    const merchant = parseMerchant(text);
    const customer = parseCustomer(text);

    // Duplicate check
    const { data: existing, error: dupErr } = await supabase
      .from("transactions")
      .select("id")
      .eq("transaction_date", ts.date)
      .eq("transaction_time", ts.time)
      .eq("nominal", nominal)
      .limit(1);

    if (dupErr) {
      console.error("[notification-ingest] duplicate check error", dupErr);
      throw dupErr;
    }

    if (existing && existing.length > 0) {
      return jsonResponse({ success: true, duplicate: true });
    }

    // Insert
    const { error: insErr } = await supabase.from("transactions").insert({
      nominal,
      transaction_time: ts.time,
      transaction_date: ts.date,
      kode_transaksi: null,
      ocr_confidence: 100,
      raw_ocr: text,
      status_match: "unmatched",
    });

    if (insErr) {
      console.error("[notification-ingest] insert error", insErr);
      throw insErr;
    }

    // Trigger auto-match (fire-and-log)
    let matched = false;
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/auto-match`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SERVICE_ROLE}`,
        },
        body: JSON.stringify({ mode: "apply", transaction_date: ts.date }),
      });
      matched = resp.ok;
      if (!resp.ok) {
        console.error("[notification-ingest] auto-match failed", resp.status);
      }
    } catch (e) {
      console.error("[notification-ingest] auto-match invoke error", e);
    }

    return jsonResponse({ success: true, inserted: true, matched });
  } catch (e) {
    console.error("[notification-ingest] fatal", e instanceof Error ? e.message : "unknown");
    return jsonResponse(
      { success: false, error: e instanceof Error ? e.message : "Unknown error" },
      500,
    );
  }
});
