import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  sendText,
  sendImage,
  sendMentions,
  wasenderRequest,
  cleanJid,
  toLocalPhone,
  verifySignature,
  getGroupMetadata,
  getGroupParticipants,
  setGroupAnnounce,
  decryptMedia,
  removeParticipants,
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

async function getGroupAdmins(groupJid: string): Promise<string[]> {
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

async function fetchParticipantsRaw(groupJid: string): Promise<any[]> {
  const parts = await getGroupParticipants(groupJid);
  return parts.data?.data || parts.data?.participants || parts.data || [];
}

const BOT_PHONE = (Deno.env.get("WASENDER_BOT_PHONE") || "").replace(/[^0-9]/g, "");

async function fetchFreshMentions(groupJid: string): Promise<{ mentions: string[]; total: number; invalid: number }> {
  const participants = await fetchParticipantsRaw(groupJid);
  const valid: string[] = [];
  let invalid = 0;
  const seen = new Set<string>();
  for (const p of participants) {
    const raw = p.cleanedParticipantPn || p.cleanedSenderPn || p.phone || p.number || p.id || p.jid || "";
    const phone = cleanJid(raw);
    if (!phone || phone.length < 8) { invalid++; continue; }
    if (BOT_PHONE && phone === BOT_PHONE) { invalid++; continue; }
    if (seen.has(phone)) continue;
    seen.add(phone);
    valid.push(`${phone}@s.whatsapp.net`);
  }
  console.log({ totalParticipants: participants.length, validMentions: valid.length, invalidMentions: invalid });
  return { mentions: valid, total: participants.length, invalid };
}

async function loadGroupMentions(supabase: any, groupJid: string): Promise<string[]> {
  const { data: members } = await supabase
    .from("group_members")
    .select("member_jid, phone")
    .eq("group_id", groupJid);
  const jids = (members || [])
    .map((m: any) => {
      const phone = cleanJid(m.member_jid || m.phone || "");
      if (!phone || phone.length < 8) return "";
      if (BOT_PHONE && phone === BOT_PHONE) return "";
      return `${phone}@s.whatsapp.net`;
    })
    .filter(Boolean);
  console.log("MENTIONS:", jids.length);
  return jids;
}

/** Re-send a quoted message preserving its media kind, with hidden mentions to all members */
async function totagQuoted(opts: {
  supabase: any;
  groupJid: string;
  quotedMsg: any;
  quotedText: string;
  quotedStanzaId: string;
}) {
  const { supabase, groupJid, quotedMsg, quotedText, quotedStanzaId } = opts;
  const mentions = await loadGroupMentions(supabase, groupJid);

  const imageMsg = quotedMsg?.imageMessage;
  const videoMsg = quotedMsg?.videoMessage;
  const docMsg = quotedMsg?.documentMessage || quotedMsg?.documentWithCaptionMessage?.message?.documentMessage;

  // Try to resolve a media URL via decrypt-media when needed
  async function resolveMediaUrl(field: string, mediaObj: any): Promise<string> {
    if (mediaObj?.url) return mediaObj.url;
    if (quotedStanzaId && mediaObj?.mediaKey) {
      const r = await wasenderRequest("/decrypt-media", "POST", {
        data: { messages: { key: { id: quotedStanzaId }, message: { [field]: mediaObj } } },
      });
      return r.data?.publicUrl || r.data?.data?.publicUrl || "";
    }
    return "";
  }

  if (imageMsg) {
    const url = await resolveMediaUrl("imageMessage", imageMsg);
    const caption = imageMsg.caption || quotedText || "";
    if (url) {
      await wasenderRequest("/send-message", "POST", { to: groupJid, imageUrl: url, text: caption, mentions });
      return;
    }
  } else if (videoMsg) {
    const url = await resolveMediaUrl("videoMessage", videoMsg);
    const caption = videoMsg.caption || quotedText || "";
    if (url) {
      await wasenderRequest("/send-message", "POST", { to: groupJid, videoUrl: url, text: caption, mentions });
      return;
    }
  } else if (docMsg) {
    const url = await resolveMediaUrl("documentMessage", docMsg);
    const fileName = docMsg.fileName || docMsg.title || "document";
    if (url) {
      await wasenderRequest("/send-message", "POST", { to: groupJid, documentUrl: url, fileName, text: quotedText || "", mentions });
      return;
    }
  }

  // Fallback: text
  if (quotedText) {
    await sendMentions(groupJid, quotedText, mentions);
  }
}

async function handleCommand(opts: {
  supabase: any;
  text: string;
  groupJid: string;
  senderJid: string;
  messageId: string;
  quotedText: string;
  quotedStanzaId: string;
  quotedMsg: any;
}) {
  const { supabase, text, groupJid, senderJid, messageId, quotedText, quotedStanzaId, quotedMsg } = opts;
  const trimmed = text.trim();
  if (!trimmed.startsWith(".")) return false;

  const cmd = trimmed.slice(1).split(/\s+/, 1)[0].toLowerCase();
  const arg = trimmed.slice(cmd.length + 1).trim();

  const ADMIN_CMDS = new Set([
    "setopen", "setclose", "setwelcome", "setleft",
    "open", "close", "totag", "h", "sync", "refreshgroup",
    "blacklist", "delblacklist",
  ]);

  if (ADMIN_CMDS.has(cmd)) {
    const admins = await getGroupAdmins(groupJid);
    const senderPhone = cleanJid(senderJid);
    if (!admins.includes(senderPhone)) {
      await sendText(groupJid, "❌ Command hanya untuk admin grup.");
      return true;
    }
  }

  switch (cmd) {
    case "setopen":
    case "setclose":
    case "setwelcome":
    case "setleft": {
      if (!arg) { await sendText(groupJid, `Format:\n.${cmd} pesan`, messageId); return true; }
      const field = cmd === "setopen" ? "open_message"
        : cmd === "setclose" ? "close_message"
        : cmd === "setwelcome" ? "welcome_message" : "left_message";
      await supabase.from("group_settings").upsert(
        { group_id: groupJid, [field]: arg, updated_at: new Date().toISOString() },
        { onConflict: "group_id" } as any,
      );
      await sendText(groupJid, `✅ Pesan ${cmd.replace("set", "")} disimpan.`, messageId);
      return true;
    }

    case "open": {
      const { data } = await supabase.from("group_settings").select("open_message").eq("group_id", groupJid).maybeSingle();
      const openMessage = (data as any)?.open_message || "🔓 Grup dibuka.";
      console.log("OPEN MESSAGE:", openMessage);
      await setGroupAnnounce(groupJid, false);
      await supabase.from("group_settings").upsert(
        { group_id: groupJid, is_open: true, updated_at: new Date().toISOString() },
        { onConflict: "group_id" } as any,
      );
      const { mentions } = await fetchFreshMentions(groupJid);
      if (mentions.length > 0) {
        const r = await sendMentions(groupJid, openMessage, mentions);
        if (!r.ok) {
          console.error("sendMentions failed, fallback to sendText", r.data);
          await sendText(groupJid, openMessage);
        }
      } else {
        await sendText(groupJid, openMessage);
      }
      return true;
    }

    case "close": {
      const { data } = await supabase.from("group_settings").select("close_message").eq("group_id", groupJid).maybeSingle();
      const closeMessage = (data as any)?.close_message || "🔒 Grup ditutup.";
      console.log("CLOSE MESSAGE:", closeMessage);
      await setGroupAnnounce(groupJid, true);
      await supabase.from("group_settings").upsert(
        { group_id: groupJid, is_open: false, updated_at: new Date().toISOString() },
        { onConflict: "group_id" } as any,
      );
      const mentions = await loadGroupMentions(supabase, groupJid);
      if (mentions.length > 0) {
        await sendMentions(groupJid, closeMessage, mentions);
      } else {
        await sendText(groupJid, closeMessage);
      }
      return true;
    }

    case "totag": {
      if (!quotedMsg || Object.keys(quotedMsg).length === 0) {
        await sendText(groupJid, "Reply pesan dulu, lalu ketik .totag", messageId);
        return true;
      }
      const mentions = await loadGroupMentions(supabase, groupJid);
      if (mentions.length === 0) {
        await sendText(groupJid, "⚠️ Member grup belum tersimpan.\nJalankan .RefreshGroup terlebih dahulu.", messageId);
        return true;
      }
      await totagQuoted({ supabase, groupJid, quotedMsg, quotedText, quotedStanzaId });
      return true;
    }

    case "h": {
      if (!arg) { await sendText(groupJid, "Format:\n.h pesan", messageId); return true; }
      const mentions = await loadGroupMentions(supabase, groupJid);
      if (mentions.length === 0) {
        await sendText(groupJid, "⚠️ Member grup belum tersimpan.\nJalankan .RefreshGroup terlebih dahulu.", messageId);
        return true;
      }
      await sendMentions(groupJid, arg, mentions);
      return true;
    }

    case "sync":
    case "refreshgroup": {
      console.log("GROUP ID:", groupJid);
      const participants = await fetchParticipantsRaw(groupJid);
      console.log("SYNC MEMBERS:", participants.length);
      const meta = await getGroupMetadata(groupJid);
      const subject = meta.data?.data?.subject || meta.data?.subject || "";
      const now = new Date().toISOString();

      const seen = new Set<string>();
      const rows: any[] = [];
      for (const p of participants) {
        const jid = p.id || p.jid || "";
        const phone = cleanJid(p.cleanedParticipantPn || p.cleanedSenderPn || p.phone || p.number || jid || "");
        if (!phone || seen.has(phone)) continue;
        seen.add(phone);
        rows.push({
          group_id: groupJid,
          phone,
          member_jid: `${phone}@s.whatsapp.net`,
          member_name: p.name || p.notify || null,
          name: p.name || p.notify || null,
          updated_at: now,
        });
      }

      const { error: delErr } = await supabase.from("group_members").delete().eq("group_id", groupJid);
      if (delErr) console.error("DELETE group_members error:", delErr);

      if (rows.length > 0) {
        const { error: insErr } = await supabase
          .from("group_members")
          .upsert(rows, { onConflict: "group_id,phone" } as any);
        if (insErr) {
          console.error("UPSERT group_members error:", insErr);
          const minimal = rows.map((r) => ({
            group_id: r.group_id, phone: r.phone, member_jid: r.member_jid, updated_at: r.updated_at,
          }));
          const { error: insErr2 } = await supabase
            .from("group_members")
            .upsert(minimal, { onConflict: "group_id,phone" } as any);
          if (insErr2) console.error("UPSERT group_members minimal error:", insErr2);
        }
      }

      const { error: gsErr } = await supabase.from("group_settings").upsert(
        { group_id: groupJid, group_name: subject || null, member_count: rows.length, last_sync_at: now, updated_at: now },
        { onConflict: "group_id" } as any,
      );
      if (gsErr) console.error("UPSERT group_settings error:", gsErr);

      await sendText(groupJid, `✅ Sync selesai.\nTotal Member: ${rows.length}`, messageId);
      return true;
    }

    case "blacklist": {
      const phone = arg.replace(/[^0-9]/g, "");
      if (!phone) { await sendText(groupJid, "Format: .blacklist <nomor>", messageId); return true; }
      await supabase.from("group_blacklist").upsert(
        { group_id: groupJid, phone },
        { onConflict: "group_id,phone" } as any,
      );
      await sendText(groupJid, `🚫 Nomor ${phone} masuk blacklist grup.`, messageId);
      return true;
    }

    case "delblacklist": {
      const phone = arg.replace(/[^0-9]/g, "");
      if (!phone) { await sendText(groupJid, "Format: .delblacklist <nomor>", messageId); return true; }
      await supabase.from("group_blacklist").delete().eq("group_id", groupJid).eq("phone", phone);
      await sendText(groupJid, `✅ Nomor ${phone} dihapus dari blacklist grup.`, messageId);
      return true;
    }

    case "help": {
      await sendText(
        groupJid,
        "*Bot Commands (admin only):*\n" +
        ".open / .close — buka/tutup grup\n" +
        ".setopen | .setclose | .setwelcome | .setleft <pesan>\n" +
        ".h <pesan> — hidden tag all\n" +
        ".totag — reply pesan, kirim ulang ke semua (hidden tag)\n" +
        ".refreshgroup — sync member grup\n" +
        ".blacklist <nomor> / .delblacklist <nomor>",
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
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
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
      return new Response(JSON.stringify({ error: "invalid signature" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = JSON.parse(rawBody);
    const event: string = body?.event || "";
    console.log("Wasender webhook event:", event);

    // Group participant events
    const participantEvents = new Set([
      "group-participants.update", "groups.participants.update", "group.participants.update",
    ]);
    if (participantEvents.has(event)) {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const d = body?.data || {};
      const groupJid: string = d.id || d.groupId || d.jid || d.remoteJid || "";
      const action: string = (d.action || d.type || "").toLowerCase();
      const participants: string[] = d.participants || d.members || [];
      if (groupJid && participants.length > 0) {
        const { data: gs } = await supabase
          .from("group_settings").select("welcome_message,left_message,group_name").eq("group_id", groupJid).maybeSingle();
        const meta = await getGroupMetadata(groupJid);
        const subject = (gs as any)?.group_name || meta.data?.data?.subject || meta.data?.subject || "";
        for (const p of participants) {
          const phone = cleanJid(p);
          if (!phone) continue;
          if (action === "add") {
            const { data: bl } = await supabase
              .from("group_blacklist").select("phone").or(`group_id.eq.${groupJid},group_id.is.null`).eq("phone", phone).maybeSingle();
            if (bl) {
              await removeParticipants(groupJid, [phone]);
              await sendText(groupJid, `🚫 Nomor ${toLocalPhone(phone)} ada di blacklist, otomatis dikeluarkan.`);
              continue;
            }
            const welcome = (gs as any)?.welcome_message;
            if (welcome) {
              const text = welcome.replace(/\{name\}/gi, `@${phone}`).replace(/@user/gi, `@${phone}`).replace(/\{group\}/gi, subject);
              await sendMentions(groupJid, text, [phone]);
            }
          } else if (action === "remove" || action === "leave") {
            const leftMsg = (gs as any)?.left_message;
            if (leftMsg) {
              const text = leftMsg.replace(/\{name\}/gi, `@${phone}`).replace(/@user/gi, `@${phone}`).replace(/\{group\}/gi, subject);
              await sendMentions(groupJid, text, [phone]);
            }
          }
        }
      }
      return new Response(JSON.stringify({ status: "ok-participants" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const messageEvents = new Set([
      "messages.upsert", "messages.received",
      "messages-personal.received", "messages-group.received",
    ]);
    if (event && !messageEvents.has(event)) {
      return new Response(JSON.stringify({ status: "ignored", event }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (event === "messages.received" || event === "messages-personal.received" || event === "messages-group.received") {
      return new Response(JSON.stringify({ status: "ignored-dup", event }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
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
        key.cleanedParticipantPn || key.cleanedSenderPn || key.participant ||
        msg.cleanedParticipantPn || msg.cleanedSenderPn || msg.participant || msg.sender ||
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
        quotedMsg.videoMessage?.caption ||
        "";
      const quotedStanzaId: string = ctxInfo?.stanzaId || "";
      const messageBody = msg.messageBody || "";
      const conversation = messageBody || m.conversation || extText?.text || msg.text || msg.body || "";
      const caption = imageMsg?.caption || "";
      const text = (conversation || "").trim();

      const { data: blacklisted } = await supabase
        .from("blacklist_users").select("phone").eq("phone", formattedPhone).limit(1);
      if (blacklisted && blacklisted.length > 0) continue;
      if (isBlockedSender(pushName, senderPhoneDigits)) continue;

      if (!imageMsg && text && isGroup && text.startsWith(".")) {
        await handleCommand({
          supabase, text, groupJid, senderJid, messageId: waMessageId,
          quotedText, quotedStanzaId, quotedMsg,
        });
        continue;
      }

      if (!imageMsg) continue;

      let fileUrl = "";
      if (imageMsg.mediaKey && waMessageId) {
        const decUrl = await decryptMedia(waMessageId, imageMsg);
        if (decUrl) fileUrl = decUrl;
      }
      if (!fileUrl) fileUrl = imageMsg.url || imageMsg.directPath || msg.mediaUrl || msg.url || "";
      if (!fileUrl) continue;

      let groupSubject = "";
      if (isGroup) {
        const meta = await getGroupMetadata(groupJid);
        groupSubject = meta.data?.data?.subject || meta.data?.subject || "";
      }
      const source = isGroup ? `WA Group: ${groupSubject}` : "WA Personal";
      const keterangan = caption ? `${caption} (${source})` : `Upload via ${source}`;

      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { data: existing } = await supabase
        .from("receipts").select("id")
        .eq("nomor_hp", formattedPhone).eq("keterangan", keterangan)
        .gte("created_at", fiveMinAgo).limit(1);

      if (existing && existing.length > 0) {
        if (waMessageId) {
          await supabase.from("receipt_wa_messages").insert({
            receipt_id: existing[0].id, wa_message_id: waMessageId,
            phone: senderPhoneDigits, group_id: groupJid || null,
            group_name: groupSubject || null, is_group: isGroup,
          });
        }
        continue;
      }

      let imageBuffer: Uint8Array;
      try {
        const headers: Record<string, string> = {};
        if (fileUrl.startsWith("https://www.wasenderapi.com/api/")) {
          headers["Authorization"] = `Bearer ${Deno.env.get("WASENDER_API_KEY")}`;
        }
        const r = await fetch(fileUrl, { headers });
        if (!r.ok) continue;
        imageBuffer = new Uint8Array(await r.arrayBuffer());
      } catch { continue; }

      const fileName = `wa_${senderPhoneDigits}_${Date.now()}.jpg`;
      const { error: upErr } = await supabase.storage
        .from("receipts").upload(fileName, imageBuffer, { contentType: "image/jpeg", upsert: false });
      if (upErr) continue;
      const { data: pub } = supabase.storage.from("receipts").getPublicUrl(fileName);

      const { data: ins, error: insErr } = await supabase.from("receipts").insert({
        nama: pushName, nomor_hp: formattedPhone, nominal: 0,
        jam_transfer: "00:00", image_url: pub.publicUrl,
        keterangan, status: "Pending",
      }).select("id").single();
      if (insErr) continue;

      await supabase.from("receipt_wa_messages").insert({
        receipt_id: ins.id, wa_message_id: waMessageId,
        phone: senderPhoneDigits, group_id: groupJid || null,
        group_name: groupSubject || null, is_group: isGroup,
      });
    }

    return new Response(JSON.stringify({ status: "ok" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Webhook error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
