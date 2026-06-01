import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  sendText,
  editMessage,
  sendMentions,
  cleanJid,
  toLocalPhone,
  verifySignature,
  getGroupMetadata,
  getGroupParticipants,
  setGroupAnnounce,
  decryptMedia,
} from "../_shared/wasender.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-signature, x-wasender-signature",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const BLOCKED_NAME_PATTERNS = [/tiqka/i, /mutiah/i, /wahyu/i];
const BLOCKED_PHONES = ["082352476245", "6282352476245"];

function isBlockedSender(name: string, phoneDigits: string): boolean {
  const n = (name || "").toLowerCase();
  if (BLOCKED_NAME_PATTERNS.some((r) => r.test(n))) return true;
  if (BLOCKED_PHONES.some((p) => phoneDigits.includes(p) || p.includes(phoneDigits))) return true;
  return false;
}

/** Get list of admin phone digits in a group via metadata API */
async function getGroupAdmins(groupJid: string): Promise<string[]> {
  // Try participants endpoint first (richer info)
  let participants: any[] = [];
  const parts = await getGroupParticipants(groupJid);
  if (parts.ok) {
    participants = parts.data?.data || parts.data?.participants || parts.data || [];
  } else {
    const meta = await getGroupMetadata(groupJid);
    participants = meta.data?.data?.participants || meta.data?.participants || [];
  }
  return participants
    .filter((p: any) => p.admin || p.isAdmin || p.is_admin || p.role === "admin" || p.role === "superadmin")
    .map((p: any) => cleanJid(p.cleanedParticipantPn || p.cleanedSenderPn || p.phone || p.number || p.id || p.jid || ""))
    .filter(Boolean);
}

async function handleCommand(opts: {
  supabase: ReturnType<typeof createClient>;
  text: string;
  groupJid: string;
  senderJid: string;
  messageId: string;
  quotedText: string;
  quotedStanzaId: string;
}) {
  const { supabase, text, groupJid, senderJid, messageId, quotedText } = opts;
  const trimmed = text.trim();
  if (!trimmed.startsWith(".")) return false;

  const cmd = trimmed.slice(1).split(/\s+/, 1)[0].toLowerCase();
  const arg = trimmed.slice(cmd.length + 1).trim();

  const ADMIN_CMDS = new Set(["setopen", "setclose", "open", "close", "totag", "h", "sync", "blacklist"]);

  if (ADMIN_CMDS.has(cmd)) {
    const admins = await getGroupAdmins(groupJid);
    const senderPhone = cleanJid(senderJid);
    if (!admins.includes(senderPhone)) {
      await sendText(groupJid, "Hanya admin yang bisa pakai command ini");
      return true;
    }
  }

  // Helper to load all member phones for a group
  async function loadGroupMentions(): Promise<string[]> {
    const { data: members } = await supabase
      .from("group_members")
      .select("phone")
      .eq("group_id", groupJid);
    let phones = (members || []).map((m: any) => m.phone).filter(Boolean);
    if (phones.length === 0) {
      // Fallback: fetch live from API
      const parts = await getGroupParticipants(groupJid);
      const participants = parts.data?.data || parts.data?.participants || parts.data || [];
      phones = participants
        .map((p: any) => cleanJid(p.cleanedParticipantPn || p.cleanedSenderPn || p.phone || p.number || p.id || p.jid || ""))
        .filter(Boolean);
    }
    return phones;
  }

  switch (cmd) {
    case "setopen": {
      if (!arg) {
        await sendText(groupJid, "Format:\n.setopen pesan", messageId);
        return true;
      }
      await supabase.from("bot_settings").upsert({ key: "open_message", value: arg });
      await sendText(groupJid, "✅ Pesan open disimpan", messageId);
      return true;
    }
    case "setclose": {
      if (!arg) {
        await sendText(groupJid, "Format:\n.setclose pesan", messageId);
        return true;
      }
      await supabase.from("bot_settings").upsert({ key: "close_message", value: arg });
      await sendText(groupJid, "✅ Pesan close disimpan", messageId);
      return true;
    }
    case "open": {
      const { data } = await supabase
        .from("bot_settings")
        .select("value")
        .eq("key", "open_message")
        .maybeSingle();
      const openMessage = data?.value || "🔓 Grup dibuka.";
      await setGroupAnnounce(groupJid, false);
      await sendText(groupJid, openMessage);
      return true;
    }
    case "close": {
      const { data } = await supabase
        .from("bot_settings")
        .select("value")
        .eq("key", "close_message")
        .maybeSingle();
      const closeMessage = data?.value || "🔒 Grup ditutup.";
      await setGroupAnnounce(groupJid, true);
      await sendText(groupJid, closeMessage);
      return true;
    }
    case "totag": {
      if (!quotedText) {
        await sendText(groupJid, "Reply pesan dulu", messageId);
        return true;
      }
      const mentions = await loadGroupMentions();
      await sendMentions(groupJid, quotedText, mentions);
      return true;
    }
    case "h": {
      if (!arg) {
        await sendText(groupJid, "Format:\n.h pesan", messageId);
        return true;
      }
      const mentions = await loadGroupMentions();
      await sendMentions(groupJid, arg, mentions);
      return true;
    }
    case "tagall": {
      const mentions = await loadGroupMentions();
      await sendMentions(groupJid, arg || "📢 Pengumuman", mentions);
      return true;
    }
    case "sync": {
      const parts = await getGroupParticipants(groupJid);
      const participants = parts.data?.data || parts.data?.participants || parts.data || [];
      const meta = await getGroupMetadata(groupJid);
      const subject = meta.data?.data?.subject || meta.data?.subject || "";
      await supabase.from("group_members").delete().eq("group_id", groupJid);
      const rows = participants.map((p: any) => ({
        group_id: groupJid,
        phone: toLocalPhone(cleanJid(p.id || p.jid || "")),
        name: p.name || p.notify || null,
      })).filter((r: any) => r.phone);
      if (rows.length > 0) await supabase.from("group_members").insert(rows);
      await sendText(groupJid, `✅ Sync selesai. ${rows.length} member tersimpan untuk grup *${subject}*.`, messageId);
      return true;
    }
    case "blacklist": {
      const phone = arg.replace(/[^0-9]/g, "");
      if (!phone) {
        await sendText(groupJid, "Format: .blacklist <nomor>", messageId);
        return true;
      }
      await supabase.from("blacklist_users").insert({ phone });
      await sendText(groupJid, `🚫 Nomor ${phone} masuk blacklist.`, messageId);
      return true;
    }
    case "help": {
      await sendText(
        groupJid,
        "*Bot Commands (admin only):*\n" +
        ".open — buka grup\n" +
        ".close — tutup grup\n" +
        ".setopen <pesan> — set pesan saat .open\n" +
        ".setclose <pesan> — set pesan saat .close\n" +
        ".totag — reply pesan, lalu tag semua (hidden)\n" +
        ".h <pesan> — kirim pesan & tag semua (hidden)\n" +
        ".sync — sync member grup ke database\n" +
        ".blacklist <nomor> — tambah nomor ke blacklist\n" +
        ".help — tampilkan bantuan",
        messageId,
      );
      return true;
    }
    default:
      return false;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (req.method === "GET") {
    return new Response(JSON.stringify({ status: "active", service: "wa-webhook-wasender" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  try {
    const rawBody = await req.text();
    const sigHeader =
      req.headers.get("x-webhook-signature") ||
      req.headers.get("x-wasender-signature") ||
      req.headers.get("signature");
    const valid = await verifySignature(rawBody, sigHeader);
    if (!valid) {
      console.warn("Invalid webhook signature");
      return new Response(JSON.stringify({ error: "invalid signature" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = JSON.parse(rawBody);
    const event: string = body?.event || "";
    console.log("Wasender webhook event:", event);

    // Only process incoming-message events
    const messageEvents = new Set([
      "messages.upsert",
      "messages.received",
      "messages-personal.received",
      "messages-group.received",
    ]);
    if (event && !messageEvents.has(event)) {
      return new Response(JSON.stringify({ status: "ignored", event }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Avoid duplicate processing across the multiple events Wasender fires for the same message
    if (event === "messages.received" || event === "messages-personal.received" || event === "messages-group.received") {
      // Process only on `messages.upsert` to dedupe
      return new Response(JSON.stringify({ status: "ignored-dup", event }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const rawMsgs = body?.data?.messages || body?.messages || (body?.data ? body.data : body);
    const messages = Array.isArray(rawMsgs) ? rawMsgs : [rawMsgs];

    for (const msg of messages) {
      if (!msg) continue;

      const key = msg.key || {};
      const remoteJid: string = key.remoteJid || msg.remoteJid || msg.chat || msg.from || "";
      const fromMe: boolean = key.fromMe ?? msg.fromMe ?? false;
      if (fromMe) continue;

      const isGroup = remoteJid.endsWith("@g.us") || msg.isGroup === true;
      const senderPhone = cleanJid(
        key.cleanedParticipantPn ||
        key.cleanedSenderPn ||
        key.participant ||
        msg.cleanedParticipantPn ||
        msg.cleanedSenderPn ||
        msg.participant ||
        msg.sender ||
        (isGroup ? "" : remoteJid)
      );
      const participantJid: string = key.participant || msg.participant || senderPhone;
      const senderJid = isGroup ? participantJid : (senderPhone || remoteJid);
      const senderPhoneDigits = senderPhone || cleanJid(senderJid);
      const formattedPhone = toLocalPhone(senderPhoneDigits);
      const groupJid = isGroup ? remoteJid : "";
      const waMessageId: string = key.id || msg.id || msg.messageId || "";
      const pushName: string = msg.pushName || msg.notify || formattedPhone;

      const m = msg.message || {};
      const imageMsg = m.imageMessage || msg.imageMessage;
      const extText = m.extendedTextMessage;
      const ctxInfo = extText?.contextInfo || m.imageMessage?.contextInfo || msg.contextInfo;
      const quotedMsg = ctxInfo?.quotedMessage || {};
      const quotedText: string =
        quotedMsg.conversation ||
        quotedMsg.extendedTextMessage?.text ||
        quotedMsg.imageMessage?.caption ||
        "";
      const quotedStanzaId: string = ctxInfo?.stanzaId || "";
      const messageBody = msg.messageBody || "";
      const conversation =
        messageBody || m.conversation || extText?.text || msg.text || msg.body || "";
      const caption = imageMsg?.caption || "";
      const text = (conversation || "").trim();

      // Blacklist DB
      const { data: blacklisted } = await supabase
        .from("blacklist_users")
        .select("phone")
        .eq("phone", formattedPhone)
        .limit(1);
      if (blacklisted && blacklisted.length > 0) {
        console.log(`Blocked by DB blacklist: ${formattedPhone}`);
        continue;
      }
      if (isBlockedSender(pushName, senderPhoneDigits)) {
        console.log(`Blocked sender: ${pushName} / ${senderPhoneDigits}`);
        continue;
      }

      // Group commands
      if (!imageMsg && text && isGroup && text.startsWith(".")) {
        await handleCommand({ supabase, text, groupJid, senderJid, messageId: waMessageId, quotedText, quotedStanzaId });
        continue;
      }

      if (!imageMsg) {
        console.log(`Skip non-image from ${formattedPhone}`);
        continue;
      }

      // Resolve image URL — prefer decrypt-media for end-to-end encrypted attachments
      let fileUrl = "";
      if (imageMsg.mediaKey && waMessageId) {
        const decUrl = await decryptMedia(waMessageId, imageMsg);
        if (decUrl) fileUrl = decUrl;
      }
      if (!fileUrl) fileUrl = imageMsg.url || imageMsg.directPath || msg.mediaUrl || msg.url || "";
      if (!fileUrl) {
        console.log(`Image from ${formattedPhone} but no URL`);
        continue;
      }

      // Group info
      let groupSubject = "";
      if (isGroup) {
        const meta = await getGroupMetadata(groupJid);
        groupSubject = meta.data?.data?.subject || meta.data?.subject || "";
      }
      const source = isGroup ? `WA Group: ${groupSubject}` : "WA Personal";
      const keterangan = caption ? `${caption} (${source})` : `Upload via ${source}`;

      // Dedup
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { data: existing } = await supabase
        .from("receipts")
        .select("id")
        .eq("nomor_hp", formattedPhone)
        .eq("keterangan", keterangan)
        .gte("created_at", fiveMinAgo)
        .limit(1);

      if (existing && existing.length > 0) {
        if (waMessageId) {
          await supabase.from("receipt_wa_messages").insert({
            receipt_id: existing[0].id,
            wa_message_id: waMessageId,
            phone: senderPhoneDigits,
            group_id: groupJid || null,
            group_name: groupSubject || null,
            is_group: isGroup,
          });
        }
        continue;
      }

      let imageBuffer: Uint8Array;
      try {
        const headers: Record<string, string> = {};
        // Decrypted Wasender URLs require auth
        if (fileUrl.startsWith("https://www.wasenderapi.com/api/")) {
          headers["Authorization"] = `Bearer ${Deno.env.get("WASENDER_API_KEY")}`;
        }
        const r = await fetch(fileUrl, { headers });
        if (!r.ok) { console.error("Image download failed:", r.status); continue; }
        imageBuffer = new Uint8Array(await r.arrayBuffer());
      } catch (e) {
        console.error("Download error:", e);
        continue;
      }

      const fileName = `wa_${senderPhoneDigits}_${Date.now()}.jpg`;
      const { error: upErr } = await supabase.storage
        .from("receipts")
        .upload(fileName, imageBuffer, { contentType: "image/jpeg", upsert: false });
      if (upErr) { console.error("Upload error:", upErr); continue; }
      const { data: pub } = supabase.storage.from("receipts").getPublicUrl(fileName);

      const { data: ins, error: insErr } = await supabase.from("receipts").insert({
        nama: pushName,
        nomor_hp: formattedPhone,
        nominal: 0,
        jam_transfer: "00:00",
        image_url: pub.publicUrl,
        keterangan,
        status: "Pending",
      }).select("id").single();

      if (insErr) { console.error("Insert error:", insErr); continue; }
      console.log(`Receipt saved for ${pushName} (${source}), id: ${ins.id}`);

      await supabase.from("receipt_wa_messages").insert({
        receipt_id: ins.id,
        wa_message_id: waMessageId,
        phone: senderPhoneDigits,
        group_id: groupJid || null,
        group_name: groupSubject || null,
        is_group: isGroup,
      });
    }


    return new Response(JSON.stringify({ status: "ok" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Webhook error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
