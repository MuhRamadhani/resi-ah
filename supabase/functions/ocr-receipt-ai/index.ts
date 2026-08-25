// OCR resi via LimitRouter (OpenAI-compatible).
// Primary: gemini-3.5-flash → fallback: claude-haiku-4.5
// Returns { nominal, jam, tanggal, keterangan, nama_penerima, confidence, source }
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const LIMITROUTER_BASE_URL = "https://limitrouter.com/v1";

// Model chain: coba satu per satu sampai berhasil
const MODEL_CHAIN = ["gemini-3.5-flash", "claude-haiku-4.5"];

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
- Do NOT invent data.`;

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizeResult(parsed: any, modelName: string) {
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

  const source = modelName.includes("claude") ? "CLAUDE" : "GEMINI";
  return { nominal, jam, tanggal, keterangan, nama_penerima, confidence, source };
}

// Satu percobaan ke satu model. Return parsed object atau throw.
async function tryModel(
  model: string,
  apiKey: string,
  imageContent: { type: "image_url"; image_url: { url: string } },
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
            imageContent,
          ],
        }],
      response_format: { type: "json_object" },
      temperature: 0,
    }),
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`model=${model} status=${resp.status} body=${txt.slice(0, 300)}`);
  }

  const data = await resp.json();
  const content: string = data?.choices?.[0]?.message?.content ?? "";

  let parsed: any = null;
  try { parsed = JSON.parse(content); } catch {
    const m = content.match(/\{[\s\S]*\}/);
    if (m) { try { parsed = JSON.parse(m[0]); } catch {} }
  }

  if (!parsed) throw new Error(`model=${model} parse_failed raw=${content.slice(0, 200)}`);
  return parsed;
}

// ── Main ─────────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LIMITROUTER_API_KEY = Deno.env.get("LIMITROUTER_API_KEY");
    if (!LIMITROUTER_API_KEY) throw new Error("LIMITROUTER_API_KEY missing");

    const { image_url, image_base64 } = await req.json();
    if (!image_url && !image_base64) {
      return new Response(JSON.stringify({ error: "image_url or image_base64 required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Resolve image: URL publik langsung (hemat egress), fallback base64 ──
    // Kalau ada image_url publik → kirim URL langsung ke LimitRouter (LimitRouter yang fetch)
    // Kalau hanya ada base64 → encode seperti biasa (tidak ada URL publik)
    let imageContent: { type: "image_url"; image_url: { url: string } };
    if (image_url) {
      // Kirim URL langsung — tidak ada fetch dari edge function, nol egress dari Supabase
      imageContent = { type: "image_url", image_url: { url: image_url } };
    } else {
      // Fallback: base64 (dari caller yang tidak punya URL publik)
      let b64: string;
      let mime = "image/jpeg";
      if (image_base64.startsWith("data:")) {
        const m = image_base64.match(/^data:([^;]+);base64,(.+)$/);
        if (m) { mime = m[1]; b64 = m[2]; }
        else b64 = image_base64.replace(/^data:.*;base64,/, "");
      } else {
        b64 = image_base64;
        mime = "image/jpeg";
      }
      imageContent = { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } };
    }

    // ── Try each model in chain ──
    const errors: string[] = [];
    for (const model of MODEL_CHAIN) {
      try {
        console.log(`[ocr-receipt-ai] trying model=${model}`);
        const parsed = await tryModel(model, LIMITROUTER_API_KEY, imageContent);
        const result = normalizeResult(parsed, model);
        console.log(`[ocr-receipt-ai] success model=${model} nominal=${result.nominal} jam=${result.jam}`);
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (e: any) {
        const msg = e?.message || String(e);
        console.error(`[ocr-receipt-ai] model=${model} failed:`, msg);
        errors.push(`${model}: ${msg}`);
        // Lanjut ke model berikutnya
      }
    }

    // Semua model gagal
    return new Response(
      JSON.stringify({ error: "all_models_failed", details: errors }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );

  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
