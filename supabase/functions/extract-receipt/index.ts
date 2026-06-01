import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SKIP_NAMES = ["tiqka mutiah"];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { image_base64 } = await req.json();
    if (!image_base64) {
      return new Response(JSON.stringify({ error: "image_base64 is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const BLACKBOX_API_KEY = Deno.env.get("BLACKBOX_API_KEY");
    if (!BLACKBOX_API_KEY) throw new Error("BLACKBOX_API_KEY not configured");

    const response = await fetch("https://api.blackbox.ai/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${BLACKBOX_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are an expert OCR assistant specialized in reading Indonesian bank transfer receipts (bukti transfer). Your job is to extract data from the receipt image accurately.

IMPORTANT INSTRUCTIONS:
1. Look carefully at the ENTIRE image for the transfer amount (nominal). It could be labeled as "Nominal", "Jumlah", "Amount", "Total", "Rp", or similar. The amount is usually the largest number on the receipt.
2. Look for the transfer time (jam). It could be labeled as "Tanggal", "Date", "Waktu", "Time", or embedded in a datetime string. Extract ONLY the time portion in HH:MM format (24-hour).
3. Also extract the sender name (nama_pengirim) and recipient name (nama_penerima) if visible. These may be labeled as "Dari", "From", "Pengirim", "Ke", "To", "Penerima", "Nama Penerima", etc.
4. If the amount has dots as thousand separators (e.g. 208.200), remove the dots and return as integer (208200).
5. If the amount has "Rp" prefix, ignore it.
6. Be very careful with numbers - do NOT confuse transaction reference numbers or account numbers with the transfer amount.
7. The transfer amount is typically between Rp 1,000 and Rp 100,000,000.

Return ONLY a JSON object, nothing else.`
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Extract the nominal transfer, jam transfer, nama pengirim, and nama penerima from this Indonesian bank transfer receipt image. Be very precise with the numbers."
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/jpeg;base64,${image_base64}`
                }
              }
            ]
          }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "extract_receipt_data",
              description: "Extract data from an Indonesian bank transfer receipt image",
              parameters: {
                type: "object",
                properties: {
                  nominal: { type: "number", description: "Transfer amount in IDR (integer, no dots/commas). This is the main transfer amount, NOT a reference number." },
                  jam_transfer: { type: "string", description: "Transfer time in HH:MM format (24-hour clock)" },
                  nama_pengirim: { type: "string", description: "Sender name (nama pengirim / dari)" },
                  nama_penerima: { type: "string", description: "Recipient name (nama penerima / ke)" }
                },
                required: ["nominal", "jam_transfer"],
                additionalProperties: false
              }
            }
          }
        ],
        tool_choice: { type: "function", function: { name: "extract_receipt_data" } }
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, coba lagi nanti." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Credit habis." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI error:", response.status, t);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    console.log("AI response:", JSON.stringify(data));

    let extracted: any = null;

    // Extract from tool call
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.arguments) {
      extracted = JSON.parse(toolCall.function.arguments);
    }

    // Fallback: try parsing from content
    if (!extracted) {
      const content = data.choices?.[0]?.message?.content || "";
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          extracted = JSON.parse(jsonMatch[0]);
        }
      } catch {}
    }

    if (!extracted) {
      return new Response(JSON.stringify({ nominal: null, jam_transfer: null }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if sender or recipient name matches skip list
    const pengirim = (extracted.nama_pengirim || "").trim().toLowerCase();
    const penerima = (extracted.nama_penerima || "").trim().toLowerCase();

    const shouldSkip = SKIP_NAMES.some(name => 
      pengirim.includes(name) || penerima.includes(name)
    );

    if (shouldSkip) {
      console.log(`Skipping receipt: pengirim="${extracted.nama_pengirim}", penerima="${extracted.nama_penerima}"`);
      return new Response(JSON.stringify({ 
        skipped: true, 
        reason: "Nama pengirim/penerima di-skip",
        nominal: null, 
        jam_transfer: null 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Return only nominal and jam_transfer to client
    return new Response(JSON.stringify({ 
      nominal: extracted.nominal, 
      jam_transfer: extracted.jam_transfer 
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
