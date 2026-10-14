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

    // Ambil entry termasuk key_json dan message_json
    const { data: entry, error: fetchErr } = await supabase
      .from("payment_entries")
      .select("id, group_id, key_json, message_json")
      .eq("id", entry_id)
      .maybeSingle();

    if (fetchErr || !entry) {
      return new Response(JSON.stringify({ error: "Entry not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!entry.group_id) {
      return new Response(JSON.stringify({ error: "Entry tidak punya group_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // CC sama persis seperti wa-webhook
    const ccRaw = Deno.env.get("APPROVED_CC_PHONE") || "";
    const ccDigits = ccRaw.replace(/\D/g, "");
    const ccIntl = ccDigits.startsWith("0") ? "62" + ccDigits.slice(1) : ccDigits;
    const mentions: string[] = ccIntl ? [`${ccIntl}@s.whatsapp.net`] : [];
    const ccText = ccIntl ? `\n\nCC : @${ccIntl}` : "";

    // Bangun payload — pakai replyToObject jika key_json tersedia
    const payload: Record<string, unknown> = {
      to: entry.group_id,
      text: `Approved ✅${ccText}`,
      ...(mentions.length > 0 ? { mentions } : {}),
    };

    if (entry.key_json) {
      payload.replyToObject = {
        key: entry.key_json,
        message: entry.message_json || entry.key_json,
      };
    }

    const result = await wasenderRequest("/api/send-message", "POST", payload);

    if (!result.ok) {
      return new Response(JSON.stringify({ error: "Gagal kirim pesan", detail: result.data }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Tandai Approved hanya setelah pesan benar-benar terkirim ke group.
    // msgId numerik disimpan supaya pesan ini bisa DIHAPUS lagi nanti kalau
    // tag/note diedit jadi tidak lolos whitelist, atau pesan payment aslinya
    // dihapus admin. Wasender DELETE /api/messages/{msgId} butuh ID numerik ini.
    const approvedAt = new Date().toISOString();
    const msgId = result.data?.data?.msgId ?? result.data?.msgId ?? null;
    await supabase
      .from("payment_entries")
      .update({ approved_at: approvedAt, approved_msg_id: msgId })
      .eq("id", entry_id);

    return new Response(JSON.stringify({ success: true, approved_at: approvedAt }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("approve-payment error:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
