import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { wasenderRequest } from "../_shared/wasender.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  try {
    // Auth: must be logged in
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { entry_id } = await req.json();
    if (!entry_id) {
      return new Response(JSON.stringify({ error: "entry_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Ambil entry dari DB
    const { data: entry, error: fetchErr } = await supabase
      .from("payment_entries")
      .select("*")
      .eq("id", entry_id)
      .maybeSingle();

    if (fetchErr || !entry) {
      return new Response(JSON.stringify({ error: "Entry not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!entry.group_id) {
      return new Response(JSON.stringify({ error: "Entry tidak punya group_id, tidak bisa kirim pesan" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Bangun CC text sama persis seperti di wa-webhook
    const ccRaw = Deno.env.get("APPROVED_CC_PHONE") || "";
    const ccDigits = ccRaw.replace(/\D/g, "");
    const ccIntl = ccDigits.startsWith("0") ? "62" + ccDigits.slice(1) : ccDigits;
    const mentions: string[] = ccIntl ? [`${ccIntl}@s.whatsapp.net`] : [];
    const ccText = ccIntl ? `\n\nCC : @${ccIntl}` : "";

    // Kirim pesan Approved ke group (tanpa replyToObject — tidak ada original message key)
    const result = await wasenderRequest("/api/send-message", "POST", {
      to: entry.group_id,
      text: `Approved ✅${ccText}`,
      ...(mentions.length > 0 ? { mentions } : {}),
    });

    if (!result.ok) {
      return new Response(JSON.stringify({ error: "Gagal kirim pesan", detail: result.data }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("approve-payment error:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
