import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendText, sendQuotedText, sendReaction } from "../_shared/wasender.ts";

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
  if (!m.wa_message_id || !m.key_json) {
    console.error("[REACT] Missing wa_message_id or key_json for receipt_id:", m.receipt_id);
    return false;
  }

  const savedKey = typeof m.key_json === "string" ? JSON.parse(m.key_json) : m.key_json;

  const keyObj = {
    id:          savedKey?.id || m.wa_message_id,
    remoteJid:   savedKey?.remoteJid || m.remote_jid || "",
    fromMe:      savedKey?.fromMe ?? false,
    participant: savedKey?.participant || undefined,
  };
  const resp = await sendReaction(keyObj, emoji);
  console.log(`[REACT] to=${keyObj.remoteJid} id=${keyObj.id} emoji=${emoji} -> ${resp.status}`, JSON.stringify(resp.data));
  return resp.ok;
}

/** Kirim teks / reply ke pesan WA asli */
async function sendOneMessage(
  m: any,
  r: any,
  templateApproved: string,
  templateRejected: string,
  status: string,
): Promise<boolean> {
  const target = m.is_group && m.group_id
    ? m.group_id
    : m.remote_jid || `${intlDigits(m.phone || "")}@s.whatsapp.net`;

  if (!target) {
    console.error("[MSG] No target for receipt_id:", m.receipt_id);
    return false;
  }

  const nominal = formatRupiah(Number(r.nominal || 0));
  const template = status === "Approved" ? templateApproved : templateRejected;
  const text = template.replace(/\{nominal\}/g, nominal);

  if (m.wa_message_id && m.key_json) {
    const savedKey = typeof m.key_json === "string" ? JSON.parse(m.key_json) : m.key_json;
    const quotedMsgId = savedKey?.id || m.wa_message_id;
    const resp = await sendQuotedText(target, text, quotedMsgId);
    console.log(`[MSG] quotedText to=${target} quotedMsgId=${quotedMsgId} -> ${resp.status}`, JSON.stringify(resp.data));
    if (resp.ok) return true;
    // Fallback: plain text
    const fallback = await sendText(target, text);
    console.log(`[MSG] plainText fallback to=${target} -> ${fallback.status}`, JSON.stringify(fallback.data));
    return fallback.ok;
  } else {
    const fallback = await sendText(target, text);
    console.log(`[MSG] plainText to=${target} -> ${fallback.status}`, JSON.stringify(fallback.data));
    return fallback.ok;
  }
}

/**
 * Kirim pesan secara serial dengan jeda 2.5 detik antar pesan.
 * Serial + delay untuk hindari banned WA. Hanya untuk pesan teks.
 */
async function runSerial<T>(tasks: Array<() => Promise<T>>): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < tasks.length; i++) {
    results.push(await tasks[i]());
    if (i < tasks.length - 1) await new Promise((resolve) => setTimeout(resolve, 2500));
  }
  return results;
}

/**
 * Kirim reaction secara paralel sekaligus — tidak perlu delay,
 * reaction tidak bisa dianggap spam oleh WhatsApp.
 */
async function runParallel<T>(tasks: Array<() => Promise<T>>): Promise<T[]> {
  return Promise.all(tasks.map((t) => t()));
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

    // Safety cap: max 20 per invocation
    // Untuk reaction: paralel → bisa banyak, tidak ada risk banned
    // Untuk pesan teks: serial 2.5s → max 20 (20 × 2.5s = 50s < 150s timeout)
    const safeIds = ids.slice(0, 20);

    // Baca notification settings
    const { data: settingsRow } = await supabase
      .from("notification_settings")
      .select("mode, reaction_approved, reaction_rejected, message_approved, message_rejected")
      .eq("id", "default")
      .single();

    const mode             = settingsRow?.mode || "message";
    const reactionApproved = settingsRow?.reaction_approved || "❤️";
    const reactionRejected = settingsRow?.reaction_rejected || "❌";
    const msgApproved      = (settingsRow as any)?.message_approved || "Resi Sebesar {nominal} Masuk ✅";
    const msgRejected      = (settingsRow as any)?.message_rejected || "Resi Sebesar {nominal} Tidak Masuk ❌";

    const { data: receipts } = await supabase
      .from("receipts")
      .select("id, nominal, nomor_hp")
      .in("id", safeIds);

    const { data: waMessages } = await supabase
      .from("receipt_wa_messages")
      .select("id, receipt_id, wa_message_id, phone, group_id, is_group, remote_jid, participant, from_me, key_json, message_json")
      .in("receipt_id", safeIds)
      .is("reacted_at", null);  // skip yang sudah terkirim — hindari double reaction

    if (!waMessages || waMessages.length === 0) {
      return new Response(JSON.stringify({ success: true, no_msgs: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const receiptMap = new Map<string, any>((receipts || []).map((r: any) => [r.id, r]));

    // De-duplikasi berdasarkan wa_message_id + group_id (remote_jid) untuk hindari double-react
    // ke pesan yang SAMA di GROUP yang SAMA. Pesan yang sama di group berbeda TETAP dikirim semua.
    // PENTING: baris duplikat yang dibuang tetap di-mark reacted_at sekarang juga,
    // agar tidak terus muncul di panel Nyangkut selamanya.
    const seenMsgIds = new Map<string, string>(); // "wa_message_id|remote_jid" → row id pertama
    const dedupedMessages: any[] = [];
    const duplicateIds: string[] = []; // id baris yang dibuang karena duplikat

    for (const m of waMessages as any[]) {
      if (!receiptMap.has(m.receipt_id)) continue;
      // Gabungkan wa_message_id + remote_jid supaya 1 pesan di 2 grup berbeda = 2 key berbeda
      const msgKey = m.wa_message_id || m.id;
      const groupKey = m.group_id || m.remote_jid || "";
      const key = `${msgKey}|${groupKey}`;
      if (seenMsgIds.has(key)) {
        duplicateIds.push(m.id); // benar-benar duplikat (msg + group sama)
      } else {
        seenMsgIds.set(key, m.id);
        dedupedMessages.push(m);
      }
    }

    // Mark baris duplikat langsung tanpa kirim ulang
    if (duplicateIds.length > 0) {
      const { error: dupErr } = await supabase
        .from("receipt_wa_messages")
        .update({ reacted_at: new Date().toISOString() })
        .in("id", duplicateIds);
      if (dupErr) console.error("[DEDUP] Gagal mark duplikat:", dupErr.message);
    }

    // Tentukan apakah mode ini akan kirim reaction (untuk status ini)
    const willReact =
      mode === "reaction" ||
      (mode === "hybrid_react_approve" && status === "Approved") ||
      (mode === "hybrid_react_reject" && status === "Rejected");

    const makeTask = (m: any) => async () => {
      const r = receiptMap.get(m.receipt_id)!;
      let ok = false;
      try {
        if (mode === "reaction") {
          const emoji = status === "Approved" ? reactionApproved : reactionRejected;
          ok = await sendOneReaction(m, emoji);
        } else if (mode === "hybrid_react_approve") {
          if (status === "Approved") {
            ok = await sendOneReaction(m, reactionApproved);
          } else {
            ok = await sendOneMessage(m, r, msgApproved, msgRejected, status);
          }
        } else if (mode === "hybrid_react_reject") {
          if (status === "Approved") {
            ok = await sendOneMessage(m, r, msgApproved, msgRejected, status);
          } else {
            ok = await sendOneReaction(m, reactionRejected);
          }
        } else {
          ok = await sendOneMessage(m, r, msgApproved, msgRejected, status);
        }
      } catch (e) {
        console.error("[SEND ERROR] receipt_id:", m.receipt_id, e instanceof Error ? e.message : "unknown");
      }

      // Tandai sudah terkirim agar tidak muncul lagi di panel "Nyangkut"
      // Hanya mark jika ok — supaya yang 408/timeout bisa di-retry via panel Nyangkut.
      const shouldMark = ok;
      if (shouldMark) {
        const { error: updErr } = await supabase
          .from("receipt_wa_messages")
          .update({ reacted_at: new Date().toISOString() })
          .eq("id", m.id);
        if (updErr) console.error("[MARK ERROR] id:", m.id, updErr.message);
      }
      return ok;
    };

    const tasks = dedupedMessages.map(makeTask);

    // Reaction → paralel (langsung semua sekaligus, tanpa delay)
    // Pesan teks → serial dengan jeda 2.5 detik antar pesan
    const results = willReact
      ? await runParallel(tasks)
      : await runSerial(tasks);
    const sent   = results.filter(Boolean).length;
    const failed = results.filter((v) => !v).length;

    return new Response(JSON.stringify({ success: true, sent, failed, total: tasks.length, mode }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("Error sending WA notification:", error instanceof Error ? error.message : "unknown");
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
