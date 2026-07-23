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
  // Match "Rp" (optional space) then digits with dots/commas as thousands sep
  const m = /Rp\s*([\d.,]+)/i.exec(text);
  if (!m) return null;
  const digits = m[1].replace(/[.,]/g, "");
  const n = parseInt(digits, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
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
  // Accept ISO 8601 with offset; keep the local wall-clock time from the offset provided.
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2}):(\d{2})/.exec(ts);
  if (!m) return null;
  return { date: m[1], time: `${m[2]}:${m[3]}:${m[4]}` };
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
      console.error("[notification-ingest] failed to parse nominal", { text });
      return jsonResponse({ success: false, error: "Nominal tidak dapat di-parse" }, 400);
    }

    const ts = parseTimestamp(timestamp);
    if (!ts) {
      console.error("[notification-ingest] failed to parse timestamp", { timestamp });
      return jsonResponse({ success: false, error: "Timestamp tidak valid" }, 400);
    }

    const merchant = parseMerchant(text);
    const customer = parseCustomer(text);

    console.log("[notification-ingest] parsed", {
      nominal,
      transaction_date: ts.date,
      transaction_time: ts.time,
      merchant,
      customer,
      title,
    });

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
      console.log("[notification-ingest] duplicate, skip insert", existing[0].id);
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
        console.error("[notification-ingest] auto-match failed", resp.status, await resp.text());
      }
    } catch (e) {
      console.error("[notification-ingest] auto-match invoke error", e);
    }

    return jsonResponse({ success: true, inserted: true, matched });
  } catch (e) {
    console.error("[notification-ingest] fatal", e);
    return jsonResponse(
      { success: false, error: e instanceof Error ? e.message : "Unknown error" },
      500,
    );
  }
});
