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

/** Kirim reaction ke pesan WA asli */
async function sendOneReaction(m: any, emoji: string): Promise<boolean> {
  if (!m.wa_message_id || !m.key_json) return false;

  const savedKey = typeof m.key_json === "string" ? JSON.parse(m.key_json) : m.key_json;
  const instance = getInstanceName();

  const payload = {
    reactionMessage: emoji,
    reactionKey: {
      remoteJid: savedKey?.remoteJid || m.remote_jid || "",
      fromMe:    savedKey?.fromMe ?? false,
      id:        savedKey?.id || m.wa_message_id,
      participant: savedKey?.participant || "",
    },
  };

  const resp = await evolutionRequest(`/message/sendReaction/${instance}`, "POST", payload);
  return resp.ok;
}

/** Kirim teks / reply ke pesan WA asli */
async function sendOneMessage(m: any, r: any, status: string): Promise<boolean> {
  const target = m.is_group && m.group_id
    ? m.group_id
    : m.remote_jid || `${intlDigits(m.phone || "")}@s.whatsapp.net`;

  if (!target) return false;

  const nominal = formatRupiah(Number(r.nominal || 0));
  const text = status === "Approved"
    ? `Resi Sebesar ${nominal} Masuk ✅`
    : `Resi Sebesar ${nominal} Tidak Masuk ❌`;

  const instance = getInstanceName();

  if (m.wa_message_id && m.key_json) {
    const savedKey = typeof m.key_json === "string" ? JSON.parse(m.key_json) : m.key_json;
    const replyPayload = {
      number: target,
      text,
      quoted: {
        key: {
          remoteJid:   savedKey?.remoteJid || target,
          fromMe:      savedKey?.fromMe ?? false,
          id:          savedKey?.id || m.wa_message_id,
          participant: savedKey?.participant || "",
        },
      },
      options: { delay: 500, presence: "composing" },
    };
    const resp = await evolutionRequest(`/message/sendText/${instance}`, "POST", replyPayload);
    if (resp.ok) return true;
    // Fallback: plain text
    const fallback = await sendText(target, text);
    return fallback.ok;
  } else {
    const fallback = await sendText(target, text);
    return fallback.ok;
  }
}

/**
 * Kirim pesan secara serial dengan jeda 2.5 detik antar pesan.
 * Serial (concurrency=1) + delay panjang untuk hindari banned WA.
 */
async function runSerial<T>(tasks: Array<() => Promise<T>>): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < tasks.length; i++) {
    results.push(await tasks[i]());
    if (i < tasks.length - 1) await new Promise((resolve) => setTimeout(resolve, 2500));
  }
  return results;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL            = Deno.env.get("SUPABASE_URL")!;
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

    // Safety cap: max 20 per invocation (20 × 2.5s = 50s < 150s timeout)
    const safeIds = ids.slice(0, 20);

    // Baca notification settings
    const { data: settingsRow } = await supabase
      .from("notification_settings")
      .select("mode, reaction_approved, reaction_rejected")
      .eq("id", "default")
      .single();

    const mode             = settingsRow?.mode || "message";
    const reactionApproved = settingsRow?.reaction_approved || "❤️";
    const reactionRejected = settingsRow?.reaction_rejected || "❌";

    const { data: receipts } = await supabase
      .from("receipts")
      .select("id, nominal, nomor_hp")
      .in("id", safeIds);

    const { data: waMessages } = await supabase
      .from("receipt_wa_messages")
      .select("id, receipt_id, wa_message_id, phone, group_id, is_group, remote_jid, participant, from_me, key_json, message_json")
      .in("receipt_id", safeIds);

    if (!waMessages || waMessages.length === 0) {
      return new Response(JSON.stringify({ success: true, no_msgs: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const receiptMap = new Map<string, any>((receipts || []).map((r: any) => [r.id, r]));

    const tasks = (waMessages as any[])
      .filter((m) => receiptMap.has(m.receipt_id))
      .map((m) => async () => {
        const r = receiptMap.get(m.receipt_id)!;
        try {
          if (mode === "reaction") {
            const emoji = status === "Approved" ? reactionApproved : reactionRejected;
            return await sendOneReaction(m, emoji);
          } else {
            return await sendOneMessage(m, r, status);
          }
        } catch (e) {
          console.error("[SEND ERROR] receipt_id:", m.receipt_id, e);
          return false;
        }
      });

    const results = await runSerial(tasks);
    const sent   = results.filter(Boolean).length;
    const failed = results.filter((v) => !v).length;

    return new Response(JSON.stringify({ success: true, sent, failed, total: tasks.length, mode }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("Error sending WA notification:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
