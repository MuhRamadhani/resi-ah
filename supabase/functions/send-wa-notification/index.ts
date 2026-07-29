import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendText, evolutionRequest, getInstanceName } from "../_shared/evolution.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function formatRupiah(n: number): string {
  if (!n || isNaN(n)) return "Rp 0";
  return "Rp " + Math.round(n).toLocaleString("id-ID");
}

function intlDigits(s: string): string {
  let d = (s || "").replace(/[^0-9]/g, "");
  if (d.startsWith("0")) d = "62" + d.slice(1);
  return d;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const payload = await req.json();
    const { status } = payload;
    if (!status) throw new Error("Missing required field: status");
    if (status !== "Approved" && status !== "Rejected") {
      return new Response(JSON.stringify({ success: true, skipped: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ids: string[] = Array.isArray(payload.receipt_ids) && payload.receipt_ids.length > 0
      ? payload.receipt_ids
      : payload.receipt_id ? [payload.receipt_id] : [];
    if (ids.length === 0) throw new Error("Missing receipt_id(s)");

    const { data: receipts } = await supabase
      .from("receipts")
      .select("id, nominal, nomor_hp")
      .in("id", ids);

    // Ambil semua field yang diperlukan untuk reply
    const { data: waMessages } = await supabase
      .from("receipt_wa_messages")
      .select("id, receipt_id, wa_message_id, phone, group_id, is_group, remote_jid, participant, from_me, key_json, message_json")
      .in("receipt_id", ids);

    if (!waMessages || waMessages.length === 0) {
      return new Response(JSON.stringify({ success: true, no_msgs: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const receiptMap = new Map<string, any>((receipts || []).map((r: any) => [r.id, r]));

    let sent = 0;
    let failed = 0;

    for (const m of waMessages as any[]) {
      const r = receiptMap.get(m.receipt_id);
      if (!r) continue;

      // Target untuk mengirim reply
      const target = m.is_group && m.group_id
        ? m.group_id
        : m.remote_jid || `${intlDigits(m.phone || "")}@s.whatsapp.net`;

      if (!target) continue;

      const nominal = formatRupiah(Number(r.nominal || 0));
      const text = status === "Approved"
        ? `Resi Sebesar ${nominal} Masuk ✅`
        : `Resi Sebesar ${nominal} Tidak Masuk ❌`;

      try {
        const instance = getInstanceName();

        if (m.wa_message_id && m.key_json) {
          // Gunakan key_json dari database
          const savedKey = typeof m.key_json === "string" ? JSON.parse(m.key_json) : m.key_json;

          // Log untuk debug
          console.log("[REPLY DEBUG] savedKey:", JSON.stringify(savedKey));
          console.log("[REPLY DEBUG] target:", target);

          // Format BENAR berdasarkan project Evolution yang sudah bekerja:
          // - text di ROOT level (bukan di textMessage)
          // - quoted di ROOT level (bukan di dalam options)
          // - quoted hanya berisi key (tanpa message)
          const replyPayload = {
            number: target,
            text,
            quoted: {
              key: {
                remoteJid: savedKey?.remoteJid || target,
                fromMe: savedKey?.fromMe ?? false,
                id: savedKey?.id || m.wa_message_id,
                participant: savedKey?.participant || "",
              },
            },
            options: {
              delay: 1200,
              presence: "composing",
            },
          };

          console.log("[REPLY PAYLOAD]", JSON.stringify(replyPayload, null, 2));

          const resp = await evolutionRequest(`/message/sendText/${instance}`, "POST", replyPayload);

          console.log("[REPLY RESPONSE]", JSON.stringify(resp));

          if (resp.ok) {
            console.log("[REPLY SUCCESS] Message sent with quoted reply");
            sent++;
          } else {
            console.log("[REPLY FAILED] Response not OK, sending plain text as fallback");
            const fallback = await sendText(target, text);
            if (fallback.ok) sent++;
            else failed++;
          }
        } else {
          // Tidak ada key_json - kirim tanpa reply
          console.log("[FALLBACK] No key_json, message_json not found. Sending plain text.");
          console.log("[FALLBACK] wa_message_id:", m.wa_message_id, "key_json:", m.key_json);
          const fallback = await sendText(target, text);
          if (fallback.ok) sent++;
          else failed++;
        }

        // Delay antar kirim
        await new Promise(resolve => setTimeout(resolve, 1500));
      } catch (e) {
        console.error("[SEND ERROR]", e);
        failed++;
      }
    }

    return new Response(JSON.stringify({ success: true, sent, failed }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("Error sending WA message:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});