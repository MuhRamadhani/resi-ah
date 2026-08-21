// Gemini Vision OCR for receipt via LimitRouter (OpenAI-compatible).
// Returns { nominal, jam, tanggal, keterangan, confidence } as JSON.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const GEMINI_MODEL = "gemini-3.5-flash";
const LIMITROUTER_BASE_URL = "https://limitrouter.com/v1";


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

    // Get base64 + mime
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

    const prompt = `You are an expert OCR system for Indonesian bank transfer receipts (bukti transfer).
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

    const url = `${LIMITROUTER_BASE_URL}/chat/completions`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${LIMITROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model: GEMINI_MODEL,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } },
          ],
        }],
        response_format: { type: "json_object" },
        temperature: 0,
      }),
    });

    if (!resp.ok) {
      const txt = await resp.text();
      console.error("LimitRouter error", resp.status, txt);
      if (resp.status === 429) {
        return new Response(JSON.stringify({ error: "rate_limited" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "limitrouter_error", detail: txt }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    const content: string = data?.choices?.[0]?.message?.content ?? "";

    let parsed: any = null;
    try {
      parsed = JSON.parse(content);
    } catch {
      const m = content.match(/\{[\s\S]*\}/);
      if (m) { try { parsed = JSON.parse(m[0]); } catch {} }
    }

    if (!parsed) {
      return new Response(JSON.stringify({ error: "parse_failed", raw: content }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Normalize
    let nominal: number | null = null;
    if (typeof parsed.nominal === "number") nominal = Math.round(parsed.nominal);
    else if (typeof parsed.nominal === "string") {
      const n = parseInt(parsed.nominal.replace(/[^\d]/g, ""));
      nominal = Number.isFinite(n) && n > 0 ? n : null;
    }

    let jam: string | null = null;
    if (typeof parsed.jam === "string") {
      const m = parsed.jam.match(/(\d{1,2})[:.](\d{2})/);
      if (m) {
        const h = Math.min(23, parseInt(m[1]));
        const mi = Math.min(59, parseInt(m[2]));
        jam = `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
      }
    }

    const tanggal = typeof parsed.tanggal === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.tanggal)
      ? parsed.tanggal
      : null;

    const keterangan = typeof parsed.keterangan === "string" ? parsed.keterangan : "";
    const nama_penerima = typeof parsed.nama_penerima === "string" ? parsed.nama_penerima.trim() : "";
    const confidence = typeof parsed.confidence === "number"
      ? Math.max(0, Math.min(100, Math.round(parsed.confidence)))
      : null;

    return new Response(
      JSON.stringify({ nominal, jam, tanggal, keterangan, nama_penerima, confidence, source: "GEMINI" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
