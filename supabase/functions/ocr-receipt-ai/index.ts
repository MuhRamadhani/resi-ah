// OCR resi via Gemini API (3 keys rotation) + fallback LimitRouter.
// Priority: Gemini Key 1 → Key 2 → Key 3 → LimitRouter (gemini-3.5-flash → claude-haiku-4.5)
// WITH IMAGE-BASED CACHING + METRICS
// Returns { nominal, jam, tanggal, keterangan, nama_penerima, confidence, source }
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const LIMITROUTER_BASE_URL = "https://limitrouter.com/v1";

// IMPORTANT: Increment CACHE_VERSION when prompt/model/parsing changes
const CACHE_VERSION = "v1";
const MODEL_NAME = "gemini-3.8-flash";

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
- For "jam": Look for the transfer time ANYWHERE in the image:
  1. First check the receipt body for explicit time fields (Waktu, Jam, Tanggal & Waktu, etc.)
  2. If no time in the receipt body, read the phone status bar time at the TOP of the image (e.g. "15:40" in the top-left corner of the screen)
  3. The status bar time is valid and should be used as "jam" if no other time is available.
  4. Return in HH:MM 24-hour format.`;

const GENERATION_CONFIG = {
  temperature: 0,
  responseMimeType: "application/json",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizeResult(parsed: any, source: string) {
  let nominal: number | null = null;
  if (typeof parsed.nominal === "number") nominal = Math.round(parsed.nominal);
  else if (typeof parsed.nominal === "string") {
    const n = parseInt(parsed.nominal.replace(/[^\d]/g, ""));
    nominal = Number.isFinite(n) && n > 0 ? n : null;
  }

  let jam: string | null = null;
  if (typeof parsed.jam === "string") {
    const m12 = parsed.jam.match(/(\d{1,2})[:.](\d{2})(?::\d{2})?\s*(AM|PM|am|pm)/i);
    if (m12) {
      let h = parseInt(m12[1]);
      const mi = parseInt(m12[2]);
      const period = m12[3].toUpperCase();
      if (period === "AM") h = h === 12 ? 0 : h;
      else h = h === 12 ? 12 : h + 12;
      jam = `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
    } else {
      const m24 = parsed.jam.match(/(\d{1,2})[:.](\d{2})/);
      if (m24) {
        const h = Math.min(23, parseInt(m24[1]));
        const mi = Math.min(59, parseInt(m24[2]));
        jam = `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
      }
    }
  }

  const tanggal =
    typeof parsed.tanggal === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.tanggal)
      ? parsed.tanggal
      : null;

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
  // Cache key = SHA256(image_hash + prompt_hash + model + config_hash)
  const promptHash = await sha256(PROMPT);
  const configHash = await sha256(JSON.stringify(GENERATION_CONFIG));
  const composite = `${imageHash}:${promptHash}:${MODEL_NAME}:${configHash}`;
  return await sha256(composite);
}

// ── Metrics Logging (DISABLED - ocr_metrics table disabled to save DB space) ──

async function logMetric(
  supabase: any,
  event: string,
  details?: any,
  receiptId?: string,
  imageHash?: string,
) {
  // Disabled: was inserting to ocr_metrics table (25K+ rows, 7MB)
  // Uncomment below to re-enable:
  // try {
  //   await supabase.from("ocr_metrics").insert({
  //     event,
  //     details: details || null,
  //     receipt_id: receiptId || null,
  //     image_hash: imageHash || null,
  //   });
  // } catch (e) {
  //   console.error("[METRICS] Failed to log:", e);
  // }
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

  // Update hit stats
  await supabase.rpc("increment_cache_hit", { p_cache_key: cacheKey });

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
  } catch (e) {
    console.error("[CACHE] Failed to save:", e);
  }
}

// ── Sleep helper ─────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Gemini API with Retry ────────────────────────────────────────────────────

async function tryGeminiWithRetry(
  supabase: any,
  apiKey: string,
  keyLabel: string,
  imageBase64: string,
  mime: string,
  receiptId?: string,
  imageHash?: string,
): Promise<any> {
  const maxRetries = 1;
  let lastError: any = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const url = `${GEMINI_BASE_URL}/${MODEL_NAME}:generateContent?key=${apiKey}`;
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: PROMPT },
              {
                inline_data: {
                  mime_type: mime,
                  data: imageBase64,
                },
              },
            ],
          }],
          generationConfig: GENERATION_CONFIG,
        }),
      });

      if (!resp.ok) {
        const txt = await resp.text();
        const status = resp.status;

        // Non-retryable errors
        if (status === 400 || status === 401 || status === 403 || status === 404) {
          await logMetric(supabase, `gemini_${keyLabel.toLowerCase()}_fail`, {
            error: "non_retryable",
            status,
            body: txt.slice(0, 200),
          }, receiptId, imageHash);
          throw new Error(`Gemini ${keyLabel} status=${status} (non-retryable)`);
        }

        // Quota exceeded (different from rate limit)
        if (status === 429 && txt.toLowerCase().includes("quota")) {
          await logMetric(supabase, `gemini_${keyLabel.toLowerCase()}_fail`, {
            error: "quota_exceeded",
            status,
          }, receiptId, imageHash);
          throw new Error(`Gemini ${keyLabel} quota exceeded`);
        }

        // Retryable: Rate limit with Retry-After header
        const retryAfter = resp.headers.get("Retry-After");
        if (status === 429 && retryAfter && attempt < maxRetries) {
          const waitMs = Math.min(parseInt(retryAfter) * 1000, 60000); // Max 60s
          await logMetric(supabase, `gemini_${keyLabel.toLowerCase()}_retry`, {
            reason: "rate_limit",
            wait_ms: waitMs,
            attempt: attempt + 1,
          }, receiptId, imageHash);
          await sleep(waitMs);
          continue;
        }

        // Retryable: Rate limit without header
        if (status === 429 && attempt < maxRetries) {
          await logMetric(supabase, `gemini_${keyLabel.toLowerCase()}_retry`, {
            reason: "rate_limit_no_header",
            wait_ms: 5000,
            attempt: attempt + 1,
          }, receiptId, imageHash);
          await sleep(5000);
          continue;
        }

        // Retryable: Server errors
        if (status >= 500 && status <= 504 && attempt < maxRetries) {
          await logMetric(supabase, `gemini_${keyLabel.toLowerCase()}_retry`, {
            reason: "server_error",
            status,
            attempt: attempt + 1,
          }, receiptId, imageHash);
          await sleep(3000);
          continue;
        }

        // Max retries or non-retryable
        lastError = new Error(`Gemini ${keyLabel} status=${status} body=${txt.slice(0, 300)}`);
        throw lastError;
      }

      const data = await resp.json();
      const content: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

      let parsed: any = null;
      try { parsed = JSON.parse(content); } catch {
        const m = content.match(/\{[\s\S]*\}/);
        if (m) { try { parsed = JSON.parse(m[0]); } catch {} }
      }

      if (!parsed) {
        throw new Error(`Gemini ${keyLabel} parse_failed raw=${content.slice(0, 200)}`);
      }

      // Success
      await logMetric(supabase, `gemini_${keyLabel.toLowerCase()}_success`, {
        confidence: parsed.confidence,
      }, receiptId, imageHash);
      
      return parsed;

    } catch (e: any) {
      lastError = e;

      // Network timeout (no status code)
      if (!e.message.includes("status=") && e.message.includes("timeout") && attempt < maxRetries) {
        await logMetric(supabase, `gemini_${keyLabel.toLowerCase()}_retry`, {
          reason: "timeout",
          attempt: attempt + 1,
        }, receiptId, imageHash);
        await sleep(5000);
        continue;
      }

      // Already logged or non-retryable
      if (attempt >= maxRetries) {
        await logMetric(supabase, `gemini_${keyLabel.toLowerCase()}_fail`, {
          error: "max_retries_exceeded",
          message: e.message,
        }, receiptId, imageHash);
      }
      throw e;
    }
  }

  throw lastError;
}

// ── LimitRouter API ──────────────────────────────────────────────────────────

async function tryLimitRouter(
  supabase: any,
  model: string,
  apiKey: string,
  imageDataUrl: string,
  receiptId?: string,
  imageHash?: string,
): Promise<any> {
  const modelLabel = model.includes("gemini") ? "gemini" : "claude";
  await logMetric(supabase, `limitrouter_${modelLabel}_call`, null, receiptId, imageHash);

  try {
    const resp = await fetch(`${LIMITROUTER_BASE_URL}/chat/completions`, {
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
      }),
    });

    if (!resp.ok) {
      const txt = await resp.text();
      await logMetric(supabase, `limitrouter_${modelLabel}_fail`, {
        status: resp.status,
        body: txt.slice(0, 200),
      }, receiptId, imageHash);
      throw new Error(`LimitRouter ${model} status=${resp.status} body=${txt.slice(0, 300)}`);
    }

    const data = await resp.json();
    const content: string = data?.choices?.[0]?.message?.content ?? "";

    let parsed: any = null;
    try { parsed = JSON.parse(content); } catch {
      const m = content.match(/\{[\s\S]*\}/);
      if (m) { try { parsed = JSON.parse(m[0]); } catch {} }
    }

    if (!parsed) {
      await logMetric(supabase, `limitrouter_${modelLabel}_fail`, {
        error: "parse_failed",
        raw: content.slice(0, 200),
      }, receiptId, imageHash);
      throw new Error(`LimitRouter ${model} parse_failed raw=${content.slice(0, 200)}`);
    }

    await logMetric(supabase, `limitrouter_${modelLabel}_success`, {
      confidence: parsed.confidence,
    }, receiptId, imageHash);

    return parsed;
  } catch (e: any) {
    // Ensure fail metric is logged
    if (!e.message.includes("status=")) {
      await logMetric(supabase, `limitrouter_${modelLabel}_fail`, {
        error: "network_error",
        message: e.message,
      }, receiptId, imageHash);
    }
    throw e;
  }
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
      // Decode base64 to bytes
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
      // Convert to base64
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
      await logMetric(supabase, "cache_hit", {
        age_hours: Math.round((Date.now() - new Date(cached.created_at).getTime()) / 3600000),
      }, receipt_id, imageHash);

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

    await logMetric(supabase, "cache_miss", null, receipt_id, imageHash);

    const errors: string[] = [];

    // ── STEP 3: Gemini fallback chain ────────────────────────────────────────

    // Try Gemini Key 1
    const GEMINI_KEY_1 = Deno.env.get("GEMINI_API_KEY_1");
    if (GEMINI_KEY_1) {
      try {
        const parsed = await tryGeminiWithRetry(supabase, GEMINI_KEY_1, "Key1", b64, mime, receipt_id, imageHash);
        const result = normalizeResult(parsed, "GEMINI_1");
        
        if (isValidResult(result)) {
          await saveCache(supabase, cacheKey, imageHash, result);
          await logMetric(supabase, "ocr_success", { source: "GEMINI_1" }, receipt_id, imageHash);
          return new Response(JSON.stringify(result), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } else {
          await logMetric(supabase, "ocr_invalid_response", { source: "GEMINI_1", result }, receipt_id, imageHash);
          errors.push(`Gemini Key 1: invalid result`);
        }
      } catch (e: any) {
        errors.push(`Gemini Key 1: ${e.message}`);
      }
    }

    // Try Gemini Key 2
    const GEMINI_KEY_2 = Deno.env.get("GEMINI_API_KEY_2");
    if (GEMINI_KEY_2) {
      try {
        const parsed = await tryGeminiWithRetry(supabase, GEMINI_KEY_2, "Key2", b64, mime, receipt_id, imageHash);
        const result = normalizeResult(parsed, "GEMINI_2");
        
        if (isValidResult(result)) {
          await saveCache(supabase, cacheKey, imageHash, result);
          await logMetric(supabase, "ocr_success", { source: "GEMINI_2" }, receipt_id, imageHash);
          return new Response(JSON.stringify(result), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } else {
          await logMetric(supabase, "ocr_invalid_response", { source: "GEMINI_2", result }, receipt_id, imageHash);
          errors.push(`Gemini Key 2: invalid result`);
        }
      } catch (e: any) {
        errors.push(`Gemini Key 2: ${e.message}`);
      }
    }

    // Try Gemini Key 3
    const GEMINI_KEY_3 = Deno.env.get("GEMINI_API_KEY_3");
    if (GEMINI_KEY_3) {
      try {
        const parsed = await tryGeminiWithRetry(supabase, GEMINI_KEY_3, "Key3", b64, mime, receipt_id, imageHash);
        const result = normalizeResult(parsed, "GEMINI_3");
        
        if (isValidResult(result)) {
          await saveCache(supabase, cacheKey, imageHash, result);
          await logMetric(supabase, "ocr_success", { source: "GEMINI_3" }, receipt_id, imageHash);
          return new Response(JSON.stringify(result), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } else {
          await logMetric(supabase, "ocr_invalid_response", { source: "GEMINI_3", result }, receipt_id, imageHash);
          errors.push(`Gemini Key 3: invalid result`);
        }
      } catch (e: any) {
        errors.push(`Gemini Key 3: ${e.message}`);
      }
    }

    // ── STEP 4: LimitRouter fallback ─────────────────────────────────────────
    const LIMITROUTER_API_KEY = Deno.env.get("LIMITROUTER_API_KEY");
    if (LIMITROUTER_API_KEY) {
      // Try LimitRouter gemini-3.5-flash
      try {
        const parsed = await tryLimitRouter(supabase, "gemini-3.5-flash", LIMITROUTER_API_KEY, dataUrl, receipt_id, imageHash);
        const result = normalizeResult(parsed, "GEMINI_LR");
        
        if (isValidResult(result)) {
          await saveCache(supabase, cacheKey, imageHash, result);
          await logMetric(supabase, "ocr_success", { source: "GEMINI_LR" }, receipt_id, imageHash);
          return new Response(JSON.stringify(result), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } else {
          await logMetric(supabase, "ocr_invalid_response", { source: "GEMINI_LR", result }, receipt_id, imageHash);
          errors.push(`LimitRouter gemini: invalid result`);
        }
      } catch (e: any) {
        errors.push(`LimitRouter gemini: ${e.message}`);
      }

      // Try LimitRouter claude-haiku-4.5
      try {
        const parsed = await tryLimitRouter(supabase, "claude-haiku-4.5", LIMITROUTER_API_KEY, dataUrl, receipt_id, imageHash);
        const result = normalizeResult(parsed, "CLAUDE");
        
        if (isValidResult(result)) {
          await saveCache(supabase, cacheKey, imageHash, result);
          await logMetric(supabase, "ocr_success", { source: "CLAUDE" }, receipt_id, imageHash);
          return new Response(JSON.stringify(result), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } else {
          await logMetric(supabase, "ocr_invalid_response", { source: "CLAUDE", result }, receipt_id, imageHash);
          errors.push(`LimitRouter claude: invalid result`);
        }
      } catch (e: any) {
        errors.push(`LimitRouter claude: ${e.message}`);
      }
    }

    // ── All providers failed ─────────────────────────────────────────────────
    await logMetric(supabase, "ocr_total_fail", { errors }, receipt_id, imageHash);
    
    return new Response(
      JSON.stringify({ error: "all_providers_failed", details: errors }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );

  } catch (e) {
    console.error("[ocr-receipt-ai] fatal error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
