// OCR resi via 9Router (Combos setup: Resi-OCR)
// WITH IMAGE-BASED CACHING
// Returns { nominal, jam, tanggal, keterangan, nama_penerima, confidence, source }
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const NINEROUTER_BASE_URL = "https://9router-production-26c24.up.railway.app/v1";
const NINEROUTER_MODEL = "Resi-OCR";

// IMPORTANT: Increment CACHE_VERSION when prompt/model/parsing changes
const CACHE_VERSION = "v3";
const MODEL_NAME = "Resi-OCR";

const PROMPT = `You are an expert OCR system for Indonesian bank transfer receipts (bukti transfer).
Extract the following fields from the image and return ONLY JSON (no prose, no markdown fences):

{
  "nominal": <integer, transfer amount in IDR, no dots/commas>,
  "jam": "<HH:MM 24-hour>",
  "tanggal": "<YYYY-MM-DD>",
  "nama_penerima": "<full name of the recipient/penerima as written on the receipt, else empty string>",
  "keterangan": "<catatan / berita / notes text if any, else empty string>",
  "confidence": <integer 0-100, your confidence>
}

Rules:
- "nominal" is the main transfer amount. Ignore reference numbers / account numbers.
- Accept small nominals (e.g. Rp 100, Rp 700). Do NOT reject small amounts.
- "nama_penerima" is the recipient name (penerima / tujuan). Extract it exactly as shown.
- If a value cannot be read, use null (except keterangan and nama_penerima which use "").
- Do NOT invent data.
- For "jam": prioritize the transaction time printed beside the transaction date in the receipt body (for example "03 Okt 2026 • 12:30"). Do not use the phone status-bar clock when a receipt time is visible.
- If no transaction time is visible in the receipt body, read the phone status bar time at the TOP of the image as a last resort.
- Return in HH:MM 24-hour format. Never return "00:00" unless the image explicitly shows that exact transaction time.`;

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizeTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.match(/\b(\d{1,2})\s*[:.]\s*(\d{2})(?:\s*(AM|PM))?\b/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  if (match[3]) {
    const period = match[3].toUpperCase();
    hour = period === "AM" ? (hour === 12 ? 0 : hour) : (hour === 12 ? 12 : hour + 12);
  }
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  const iso = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;

  const months: Record<string, string> = {
    jan: "01", januari: "01", feb: "02", februari: "02", mar: "03", maret: "03",
    apr: "04", april: "04", mei: "05", may: "05", jun: "06", juni: "06",
    jul: "07", juli: "07", agu: "08", agt: "08", agustus: "08", aug: "08",
    sep: "09", sept: "09", september: "09", okt: "10", oktober: "10", oct: "10",
    nov: "11", november: "11", des: "12", desember: "12", dec: "12",
  };
  const named = text.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/i);
  if (!named) return null;
  const month = months[named[2].toLowerCase()];
  return month ? `${named[3]}-${month}-${named[1].padStart(2, "0")}` : null;
}

function normalizeResult(parsed: any, source: string) {
  let nominal: number | null = null;
  if (typeof parsed.nominal === "number") nominal = Math.round(parsed.nominal);
  else if (typeof parsed.nominal === "string") {
    const n = parseInt(parsed.nominal.replace(/[^\d]/g, ""));
    nominal = Number.isFinite(n) && n > 0 ? n : null;
  }

  const jam = normalizeTime(parsed.jam);
  const tanggal = normalizeDate(parsed.tanggal);

  const keterangan = typeof parsed.keterangan === "string" ? parsed.keterangan : "";
  const nama_penerima =
    typeof parsed.nama_penerima === "string" ? parsed.nama_penerima.trim() : "";
  const confidence =
    typeof parsed.confidence === "number"
      ? Math.max(0, Math.min(100, Math.round(parsed.confidence)))
      : null;

  return { nominal, jam, tanggal, keterangan, nama_penerima, confidence, source };
}

function isValidResult(result: any): boolean {
  // Valid = nominal valid + jam valid
  const validNominal = typeof result.nominal === "number" && result.nominal >= 1 && result.nominal <= 100_000_000;
  const validJam = typeof result.jam === "string" && /^\d{2}:\d{2}$/.test(result.jam) && result.jam !== "00:00";
  return validNominal && validJam;
}

// ── SHA-256 Hash ─────────────────────────────────────────────────────────────

async function sha256(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest("SHA-256", dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

async function computeImageHash(imageBytes: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", imageBytes);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

async function computeCacheKey(imageHash: string): Promise<string> {
  // Cache key = SHA256(image_hash + prompt_hash + model)
  const promptHash = await sha256(PROMPT);
  const composite = `${imageHash}:${promptHash}:${MODEL_NAME}:${CACHE_VERSION}`;
  return await sha256(composite);
}

// ── Cache Operations ─────────────────────────────────────────────────────────

async function lookupCache(supabase: any, cacheKey: string) {
  const { data, error } = await supabase
    .from("ocr_cache")
    .select("*")
    .eq("cache_key", cacheKey)
    .eq("cache_version", CACHE_VERSION)
    .gte("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()) // 30 days TTL
    .single();

  if (error || !data) return null;

  // Update hit stats if RPC exists
  try {
    await supabase.rpc("increment_cache_hit", { p_cache_key: cacheKey });
  } catch {}

  return data;
}

async function saveCache(supabase: any, cacheKey: string, imageHash: string, result: any) {
  try {
    await supabase.from("ocr_cache").insert({
      cache_key: cacheKey,
      image_hash: imageHash,
      nominal: result.nominal,
      jam: result.jam,
      tanggal: result.tanggal,
      keterangan: result.keterangan,
      nama_penerima: result.nama_penerima,
      confidence: result.confidence,
      source: result.source,
      cache_version: CACHE_VERSION,
    });
  } catch {}
}

// ── OpenAI-compatible OCR API ────────────────────────────────────────────────

async function tryRouter(
  baseUrl: string,
  model: string,
  apiKey: string,
  imageDataUrl: string,
  provider: string,
): Promise<any> {
  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: PROMPT },
          { type: "image_url", image_url: { url: imageDataUrl } },
        ],
      }],
      response_format: { type: "json_object" },
      temperature: 0,
      stream: false,
    }),
  });

  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`${provider} status=${resp.status} body=${text.slice(0, 200)}`);
  }

  let data: any = null;
  let content = "";
  try {
    data = JSON.parse(text);
  } catch {
    // Some gateways return SSE frames despite stream=false.
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const chunk = line.slice(5).trim();
      if (!chunk || chunk === "[DONE]") continue;
      try {
        const frame = JSON.parse(chunk);
        const message = frame?.choices?.[0]?.message;
        const delta = frame?.choices?.[0]?.delta;
        const part = message?.content ?? delta?.content;
        if (typeof part === "string") content += part;
        else if (Array.isArray(part)) {
          content += part.map((item: any) => item?.text || "").join("");
        }
        data ||= frame;
      } catch {
        // Ignore SSE metadata or malformed frames and continue with later frames.
      }
    }
  }

  if (!content) {
    const part = data?.choices?.[0]?.message?.content;
    if (typeof part === "string") content = part;
    else if (Array.isArray(part)) content = part.map((item: any) => item?.text || "").join("\n");
  }

  let parsed: any = null;
  try {
    parsed = JSON.parse(content);
  } catch {
    const m = content.match(/\{[\s\S]*\}/);
    if (m) {
      try { parsed = JSON.parse(m[0]); } catch {}
    }
  }

  if (!parsed) {
    console.error(`[ocr-receipt-ai] ${provider} parse_failed. raw=${text.slice(0, 500)}`);
    throw new Error(`${provider} parse_failed`);
  }
  return parsed;
}


// ── Main ─────────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  try {
    const { image_url, image_base64, receipt_id } = await req.json();
    if (!image_url && !image_base64) {
      return new Response(JSON.stringify({ error: "image_url or image_base64 required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── STEP 1: Download & hash image ────────────────────────────────────────
    let imageBytes: Uint8Array;
    let b64: string;
    let mime = "image/jpeg";

    if (image_base64) {
      if (image_base64.startsWith("data:")) {
        const m = image_base64.match(/^data:([^;]+);base64,(.+)$/);
        if (m) { mime = m[1]; b64 = m[2]; }
        else b64 = image_base64.replace(/^data:.*;base64,/, "");
      } else {
        b64 = image_base64;
      }
      const binaryStr = atob(b64);
      imageBytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        imageBytes[i] = binaryStr.charCodeAt(i);
      }
    } else {
      const r = await fetch(image_url);
      if (!r.ok) throw new Error(`fetch image failed: ${r.status}`);
      mime = r.headers.get("content-type") || "image/jpeg";
      imageBytes = new Uint8Array(await r.arrayBuffer());
      let bin = "";
      for (let i = 0; i < imageBytes.length; i++) bin += String.fromCharCode(imageBytes[i]);
      b64 = btoa(bin);
    }

    const imageHash = await computeImageHash(imageBytes);
    const cacheKey = await computeCacheKey(imageHash);
    const dataUrl = `data:${mime};base64,${b64}`;

    // ── STEP 2: Check cache ──────────────────────────────────────────────────
    const cached = await lookupCache(supabase, cacheKey);
    if (cached) {
      return new Response(JSON.stringify({
        nominal: cached.nominal,
        jam: cached.jam,
        tanggal: cached.tanggal,
        keterangan: cached.keterangan,
        nama_penerima: cached.nama_penerima,
        confidence: cached.confidence,
        source: cached.source,
        cached: true,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── STEP 3: 9Router primary, LimitRouter only on hard failure ─────────────
    const NINEROUTER_API_KEY = Deno.env.get("NINEROUTER_API_KEY");
    const LIMITROUTER_API_KEY = Deno.env.get("LIMITROUTER_API_KEY");
    let parsed: any = null;
    let source = "9ROUTER";
    let nineRouterHardFailed = false;

    if (NINEROUTER_API_KEY) {
      try {
        parsed = await tryRouter(
          NINEROUTER_BASE_URL,
          NINEROUTER_MODEL,
          NINEROUTER_API_KEY,
          dataUrl,
          "9Router",
        );
        // parsed berhasil diparse — gunakan hasilnya meskipun field tidak lengkap.
        // LimitRouter TIDAK dipanggil jika 9Router berhasil mengembalikan JSON.
      } catch (e) {
        console.error("[ocr-receipt-ai] 9Router failed:", e instanceof Error ? e.message : "unknown");
        nineRouterHardFailed = true;
      }
    } else {
      nineRouterHardFailed = true;
    }

    // LimitRouter hanya fallback jika 9Router throw error (bukan sekadar hasil tidak valid).
    if (nineRouterHardFailed && LIMITROUTER_API_KEY) {
      try {
        parsed = await tryRouter(
          "https://limitrouter.com/v1",
          "gemini-3.8-flash",
          LIMITROUTER_API_KEY,
          dataUrl,
          "LimitRouter",
        );
        source = "GEMINI_LR";
      } catch (e) {
        console.error("[ocr-receipt-ai] LimitRouter fallback failed:", e instanceof Error ? e.message : "unknown");
      }
    }

    if (!parsed) {
      return new Response(
        JSON.stringify({ error: "all_ocr_providers_failed" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const result = normalizeResult(parsed, source);
    if (isValidResult(result)) {
      await saveCache(supabase, cacheKey, imageHash, result);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Invalid format returned by fallback model
    return new Response(
      JSON.stringify({ error: "invalid_ocr_result", raw: parsed }),
      { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (e: any) {
    console.error("[ocr-receipt-ai] error:", e?.message || e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
