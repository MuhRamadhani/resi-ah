// Lovable AI Vision fallback for receipt OCR.
// Called by the dashboard when Tesseract fails / returns invalid data.
// Returns { nominal, jam, tanggal, keterangan, confidence } as JSON.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY missing");

    const { image_url, image_base64 } = await req.json();
    if (!image_url && !image_base64) {
      return new Response(JSON.stringify({ error: "image_url or image_base64 required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Prefer sending URL; fall back to base64 data URL.
    let imagePayloadUrl: string;
    if (image_base64) {
      imagePayloadUrl = image_base64.startsWith("data:")
        ? image_base64
        : `data:image/jpeg;base64,${image_base64}`;
    } else {
      imagePayloadUrl = image_url;
    }

    const systemPrompt = `You are an expert OCR system for Indonesian bank transfer receipts (bukti transfer).
Extract the following fields from the image and return ONLY JSON (no prose, no markdown fences):

{
  "nominal": <integer, transfer amount in IDR, no dots/commas>,
  "jam": "<HH:MM:SS or HH:MM 24-hour>",
  "tanggal": "<YYYY-MM-DD>",
  "keterangan": "<catatan / berita / notes text if any, else empty string>",
  "confidence": <integer 0-100, your confidence>
}

Rules:
- "nominal" is the main transfer amount. Ignore reference numbers / account numbers.
- If a value cannot be read, use null (except keterangan which uses "").
- Do NOT invent data.`;

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: "Extract the receipt data as JSON." },
              { type: "image_url", image_url: { url: imagePayloadUrl } },
            ],
          },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!resp.ok) {
      const txt = await resp.text();
      console.error("Lovable AI error", resp.status, txt);
      if (resp.status === 429) {
        return new Response(JSON.stringify({ error: "rate_limited" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (resp.status === 402) {
        return new Response(JSON.stringify({ error: "credits_exhausted" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "ai_gateway_error", detail: txt }), {
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
      if (m) {
        try { parsed = JSON.parse(m[0]); } catch {}
      }
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
      const m = parsed.jam.match(/(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?/);
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
    const confidence = typeof parsed.confidence === "number"
      ? Math.max(0, Math.min(100, Math.round(parsed.confidence)))
      : null;

    return new Response(
      JSON.stringify({ nominal, jam, tanggal, keterangan, confidence, source: "LOVABLE_AI" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
