// OCR resi via Gemini API (3 keys rotation) + fallback LimitRouter.
// Priority: Gemini Key 1 → Key 2 → Key 3 → LimitRouter (gemini-3.5-flash → claude-haiku-4.5)
// Returns { nominal, jam, tanggal, keterangan, nama_penerima, confidence, source }
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const LIMITROUTER_BASE_URL = "https://limitrouter.com/v1";

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

// ── Gemini API ──
async function tryGemini(
  apiKey: string,
  keyLabel: string,
  imageBase64: string,
  mime: string,
): Promise<any> {
  const url = `${GEMINI_BASE_URL}/gemini-1.5-flash:generateContent?key=${apiKey}`;
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
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Gemini ${keyLabel} status=${resp.status} body=${txt.slice(0, 300)}`);
  }

  const data = await resp.json();
  const content: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

  let parsed: any = null;
  try { parsed = JSON.parse(content); } catch {
    const m = content.match(/\{[\s\S]*\}/);
    if (m) { try { parsed = JSON.parse(m[0]); } catch {} }
  }

  if (!parsed) throw new Error(`Gemini ${keyLabel} parse_failed raw=${content.slice(0, 200)}`);
  return parsed;
}

// ── LimitRouter API ──
async function tryLimitRouter(
  model: string,
  apiKey: string,
  imageDataUrl: string,
): Promise<any> {
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
    throw new Error(`LimitRouter ${model} status=${resp.status} body=${txt.slice(0, 300)}`);
  }

  const data = await resp.json();
  const content: string = data?.choices?.[0]?.message?.content ?? "";

  let parsed: any = null;
  try { parsed = JSON.parse(content); } catch {
    const m = content.match(/\{[\s\S]*\}/);
    if (m) { try { parsed = JSON.parse(m[0]); } catch {} }
  }

  if (!parsed) throw new Error(`LimitRouter ${model} parse_failed raw=${content.slice(0, 200)}`);
  return parsed;
}

// ── Main ─────────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { image_url, image_base64 } = await req.json();
    if (!image_url && !image_base64) {
      return new Response(JSON.stringify({ error: "image_url or image_base64 required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Decode image ke base64 ──
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
    } else {
      const r = await fetch(image_url);
      if (!r.ok) throw new Error(`fetch image failed: ${r.status}`);
      mime = r.headers.get("content-type") || "image/jpeg";
      const buf = new Uint8Array(await r.arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
      b64 = btoa(bin);
    }

    const dataUrl = `data:${mime};base64,${b64}`;
    const errors: string[] = [];

    // ── 1. Try Gemini Key 1 ──
    const GEMINI_KEY_1 = Deno.env.get("GEMINI_API_KEY_1");
    if (GEMINI_KEY_1) {
      try {
        console.log("[ocr-receipt-ai] trying Gemini Key 1");
        const parsed = await tryGemini(GEMINI_KEY_1, "Key1", b64, mime);
        const result = normalizeResult(parsed, "GEMINI_1");
        console.log(`[ocr-receipt-ai] success Gemini Key 1 nominal=${result.nominal} jam=${result.jam}`);
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (e: any) {
        const msg = e?.message || String(e);
        console.error("[ocr-receipt-ai] Gemini Key 1 failed:", msg);
        errors.push(`Gemini Key 1: ${msg}`);
      }
    }

    // ── 2. Try Gemini Key 2 ──
    const GEMINI_KEY_2 = Deno.env.get("GEMINI_API_KEY_2");
    if (GEMINI_KEY_2) {
      try {
        console.log("[ocr-receipt-ai] trying Gemini Key 2");
        const parsed = await tryGemini(GEMINI_KEY_2, "Key2", b64, mime);
        const result = normalizeResult(parsed, "GEMINI_2");
        console.log(`[ocr-receipt-ai] success Gemini Key 2 nominal=${result.nominal} jam=${result.jam}`);
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (e: any) {
        const msg = e?.message || String(e);
        console.error("[ocr-receipt-ai] Gemini Key 2 failed:", msg);
        errors.push(`Gemini Key 2: ${msg}`);
      }
    }

    // ── 3. Try Gemini Key 3 ──
    const GEMINI_KEY_3 = Deno.env.get("GEMINI_API_KEY_3");
    if (GEMINI_KEY_3) {
      try {
        console.log("[ocr-receipt-ai] trying Gemini Key 3");
        const parsed = await tryGemini(GEMINI_KEY_3, "Key3", b64, mime);
        const result = normalizeResult(parsed, "GEMINI_3");
        console.log(`[ocr-receipt-ai] success Gemini Key 3 nominal=${result.nominal} jam=${result.jam}`);
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (e: any) {
        const msg = e?.message || String(e);
        console.error("[ocr-receipt-ai] Gemini Key 3 failed:", msg);
        errors.push(`Gemini Key 3: ${msg}`);
      }
    }

    // ── 4. Fallback: LimitRouter gemini-3.5-flash ──
    const LIMITROUTER_API_KEY = Deno.env.get("LIMITROUTER_API_KEY");
    if (LIMITROUTER_API_KEY) {
      try {
        console.log("[ocr-receipt-ai] trying LimitRouter gemini-3.5-flash");
        const parsed = await tryLimitRouter("gemini-3.5-flash", LIMITROUTER_API_KEY, dataUrl);
        const result = normalizeResult(parsed, "GEMINI_LR");
        console.log(`[ocr-receipt-ai] success LimitRouter gemini nominal=${result.nominal} jam=${result.jam}`);
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (e: any) {
        const msg = e?.message || String(e);
        console.error("[ocr-receipt-ai] LimitRouter gemini failed:", msg);
        errors.push(`LimitRouter gemini: ${msg}`);
      }

      // ── 5. Fallback terakhir: LimitRouter claude-haiku-4.5 ──
      try {
        console.log("[ocr-receipt-ai] trying LimitRouter claude-haiku-4.5");
        const parsed = await tryLimitRouter("claude-haiku-4.5", LIMITROUTER_API_KEY, dataUrl);
        const result = normalizeResult(parsed, "CLAUDE");
        console.log(`[ocr-receipt-ai] success LimitRouter claude nominal=${result.nominal} jam=${result.jam}`);
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (e: any) {
        const msg = e?.message || String(e);
        console.error("[ocr-receipt-ai] LimitRouter claude failed:", msg);
        errors.push(`LimitRouter claude: ${msg}`);
      }
    }

    // Semua provider gagal
    return new Response(
      JSON.stringify({ error: "all_providers_failed", details: errors }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );

  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
