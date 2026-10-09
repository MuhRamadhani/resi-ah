import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";
import {
  sendText,
  getMediaBase64,
  cleanJid,
  toLocalPhone,
  verifySignature,
  getGroupMetadata,
} from "../_shared/evolution.ts";
import { r2Upload } from "../_shared/r2.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-signature, x-evolution-token",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Cache for blocked identifiers from database (refreshed every 5 minutes)
let cachedBlockedPhones: Set<string> = new Set();
let cachedBlockedNamePatterns: RegExp[] = [];    // type='name'   - block by OCR result name
let cachedBlockedSenderPatterns: RegExp[] = [];  // type='sender' - block by WA pushName (before upload)
let lastCacheRefresh = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function refreshBlockedPhonesCache(supabase: any) {
  const now = Date.now();
  if (now - lastCacheRefresh < CACHE_TTL) return;
  
  try {
    const { data: blacklist, error } = await supabase
      .from("blocked_identifiers")
      .select("type, value")
      .limit(1000);
    
    if (!error && blacklist) {
      // type='phone' - block by phone number
      const phones = blacklist
        .filter((r: any) => r.type === 'phone')
        .map((r: any) => r.value)
        .filter((v: string) => v);
      cachedBlockedPhones = new Set(phones);
      
      // type='name' - block by OCR result name (checked after OCR)
      cachedBlockedNamePatterns = blacklist
        .filter((r: any) => r.type === 'name')
        .map((r: any) => r.value?.trim())
        .filter((v: string) => v)
        .map((v: string) => new RegExp(v, "i"));
      
      // type='sender' - block by WA pushName (checked before upload)
      cachedBlockedSenderPatterns = blacklist
        .filter((r: any) => r.type === 'sender')
        .map((r: any) => r.value?.trim())
        .filter((v: string) => v)
        .map((v: string) => new RegExp(v, "i"));
    }
    
    lastCacheRefresh = now;
  } catch (e) {
    // silent
  }
}

function isBlockedSender(name: string, phoneDigits: string): boolean {
  // DISABLED per user request to prevent incorrect blocking
  return false;
}

async function compressImage(imageBuffer: Uint8Array): Promise<Uint8Array> {
  try {
    const image = await Image.decode(imageBuffer);
    
    // Resize jika lebar lebih dari 1024px
    const maxWidth = 1024;
    if (image.width > maxWidth) {
      const ratio = maxWidth / image.width;
      const newHeight = Math.floor(image.height * ratio);
      image.resize(maxWidth, newHeight);
    }
    
    const compressed = await image.encodeJPEG(80);
    const originalSize = (imageBuffer.length / 1024).toFixed(2);
    const compressedSize = (compressed.length / 1024).toFixed(2);
    const reduction = (((imageBuffer.length - compressed.length) / imageBuffer.length) * 100).toFixed(1);
    
    return compressed;
  } catch (e) {
    console.error("[COMPRESS] Gagal kompresi, gunakan original:", e);
    return imageBuffer;
  }
}

async function createThumbnail(imageBuffer: Uint8Array): Promise<Uint8Array> {
  try {
    const image = await Image.decode(imageBuffer);
    
    // Create 100x100 thumbnail
    const thumbSize = 100;
    const ratio = Math.min(thumbSize / image.width, thumbSize / image.height);
    const newWidth = Math.floor(image.width * ratio);
    const newHeight = Math.floor(image.height * ratio);
    
    image.resize(newWidth, newHeight);
    
    // Encode dengan quality 70% untuk thumbnail
    const thumbnail = await image.encodeJPEG(70);
    return thumbnail;
  } catch (e) {
    console.error("[THUMBNAIL] Gagal create thumbnail:", e);
    return imageBuffer;
  }
}

async function getGroupAdmins(groupJid: string): Promise<string[]> {
  let participants: any[] = [];
  const parts = await getGroupParticipants(groupJid);
  if (parts.ok) {
    // Evolution: participants ada di data.participants (atau data.data.participants)
    participants = parts.data?.participants || parts.data?.data?.participants || parts.data?.data || [];
  } else {
    const meta = await getGroupMetadata(groupJid);
    participants = meta.data?.participants || meta.data?.data?.participants || [];
  }
  return participants
    // Evolution: admin field berisi "admin" atau "superadmin", null jika bukan admin
    .filter((p: any) => p.admin || p.isAdmin || p.is_admin || p.role === "admin" || p.role === "superadmin")
    .map((p: any) => cleanJid(p.id || p.jid || p.cleanedParticipantPn || p.cleanedSenderPn || p.phone || p.number || ""))
    .filter(Boolean);
}

async function fetchParticipantsRaw(groupJid: string): Promise<any[]> {
  const parts = await getGroupParticipants(groupJid);
  // Evolution: participants ada di data.participants
  return parts.data?.participants || parts.data?.data?.participants || parts.data?.data || [];
}

// Evolution: EVOLUTION_BOT_PHONE
const BOT_PHONE = (Deno.env.get("EVOLUTION_BOT_PHONE") || Deno.env.get("WASENDER_BOT_PHONE") || "").replace(/[^0-9]/g, "");

async function fetchFreshMentions(groupJid: string): Promise<{ mentions: string[]; total: number; invalid: number }> {
  const participants = await fetchParticipantsRaw(groupJid);
  const valid: string[] = [];
  let invalid = 0;
  const seen = new Set<string>();
  for (const p of participants) {
    // Evolution: JID ada di p.id, fallback ke field lama untuk kompatibilitas
    const raw = p.id || p.pn || p.cleanedParticipantPn || p.cleanedSenderPn || p.phone || p.number || p.jid || "";
    const phone = cleanJid(raw);
    if (!phone || phone.length < 8) { invalid++; continue; }
    if (BOT_PHONE && phone === BOT_PHONE) { invalid++; continue; }
    if (seen.has(phone)) continue;
    seen.add(phone);
    valid.push(`${phone}@s.whatsapp.net`);
  }
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
  const { supabase, groupJid, quotedMsg, quotedText } = opts;
  const { mentions } = await fetchFreshMentions(groupJid);

  const imageMsg = quotedMsg?.imageMessage;
  const videoMsg = quotedMsg?.videoMessage;
  const docMsg = quotedMsg?.documentMessage || quotedMsg?.documentWithCaptionMessage?.message?.documentMessage;

  // Evolution: gunakan getMediaBase64 untuk mendapatkan media
  async function resolveMediaUrl(
    _field: string,
    mediaObj: any,
    fullMessage: any,
  ): Promise<{ url?: string; base64?: string; mimetype?: string }> {

    // Jika ada URL langsung yang bisa diakses (bukan encrypted)
    if (mediaObj?.url && !mediaObj.url.includes(".enc")) {
      return { url: mediaObj.url };
    }

    // Evolution: ambil base64 dari media message
    if (mediaObj?.mediaKey || mediaObj?.directPath) {
      const result = await getMediaBase64(fullMessage);
      if (result?.base64) {
        return { base64: result.base64, mimetype: result.mimetype };
      }
    }

    return {};
  }

  if (imageMsg) {
    const caption = imageMsg.caption || quotedText || "";
    const resolved = await resolveMediaUrl("imageMessage", imageMsg, { imageMessage: imageMsg });
    if (resolved.url) {
      await sendImage(groupJid, resolved.url, caption);
      // Kirim mentions terpisah karena sendImage tidak support mentions
      if (mentions.length > 0) await sendMentions(groupJid, caption || "⬆️", mentions);
      return;
    } else if (resolved.base64) {
      // Untuk base64, kirim sebagai mentions dengan caption saja (media sulit dikirim ulang via base64)
      if (mentions.length > 0) await sendMentions(groupJid, caption || quotedText || "⬆️", mentions);
      return;
    }
  } else if (videoMsg) {
    const caption = videoMsg.caption || quotedText || "";
    const resolved = await resolveMediaUrl("videoMessage", videoMsg, { videoMessage: videoMsg });
    if (resolved.url) {
      // Evolution: gunakan sendMedia untuk video
      const { evolutionRequest, getInstanceName } = await import("../_shared/evolution.ts");
      await evolutionRequest(`/message/sendMedia/${getInstanceName()}`, "POST", {
        number: groupJid,
        mediatype: "video",
        media: resolved.url,
        caption,
        mentioned: mentions,
      });
      return;
    }
  } else if (docMsg) {
    const fileName = docMsg.fileName || docMsg.title || "document";
    const resolved = await resolveMediaUrl("documentMessage", docMsg, { documentMessage: docMsg });
    if (resolved.url) {
      const { evolutionRequest, getInstanceName } = await import("../_shared/evolution.ts");
      await evolutionRequest(`/message/sendMedia/${getInstanceName()}`, "POST", {
        number: groupJid,
        mediatype: "document",
        media: resolved.url,
        fileName,
        caption: quotedText || "",
        mentioned: mentions,
      });
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
  quotedParticipant?: string;
}) {
  const { supabase, text, groupJid, senderJid, messageId, quotedText, quotedStanzaId, quotedMsg, quotedParticipant } = opts;
  const trimmed = text.trim();
  if (!trimmed.startsWith(".")) return false;

  const cmd = trimmed.slice(1).split(/\s+/, 1)[0].toLowerCase();
  const arg = trimmed.slice(cmd.length + 1).trim();

  const ADMIN_CMDS = new Set([
    "setopen", "setclose", "setwelcome", "setleft",
    "open", "close", "totag", "h", "sync", "refreshgroup",
    "blacklist", "delblacklist", "kick"
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
      await setGroupAnnounce(groupJid, false);
      await supabase.from("group_settings").upsert(
        { group_id: groupJid, is_open: true, updated_at: new Date().toISOString() },
        { onConflict: "group_id" } as any,
      );
      const { mentions } = await fetchFreshMentions(groupJid);
      if (mentions.length > 0) {
        const r = await sendMentions(groupJid, openMessage, mentions);
        if (!r.ok) {
          console.error("sendMentions failed, fallback to sendText", r.status);
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
      await setGroupAnnounce(groupJid, true);
      await supabase.from("group_settings").upsert(
        { group_id: groupJid, is_open: false, updated_at: new Date().toISOString() },
        { onConflict: "group_id" } as any,
      );
      const { mentions } = await fetchFreshMentions(groupJid);
      if (mentions.length > 0) {
        const r = await sendMentions(groupJid, closeMessage, mentions);
        if (!r.ok) {
          console.error("sendMentions failed, fallback to sendText", r.status);
          await sendText(groupJid, closeMessage);
        }
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
      const { mentions } = await fetchFreshMentions(groupJid);
      if (mentions.length === 0) {
        await sendText(groupJid, "⚠️ Member grup belum tersimpan.\nJalankan .RefreshGroup terlebih dahulu.", messageId);
        return true;
      }
      await totagQuoted({ supabase, groupJid, quotedMsg, quotedText, quotedStanzaId });
      return true;
    }

    case "h": {
      if (!arg) { await sendText(groupJid, "Format:\n.h pesan", messageId); return true; }
      const { mentions } = await fetchFreshMentions(groupJid);
      if (mentions.length === 0) {
        await sendText(groupJid, "⚠️ Member grup belum tersimpan.\nJalankan .RefreshGroup terlebih dahulu.", messageId);
        return true;
      }
      await sendMentions(groupJid, arg, mentions);
      return true;
    }

    case "sync":
    case "refreshgroup": {
      const participants = await fetchParticipantsRaw(groupJid);
      const meta = await getGroupMetadata(groupJid);
      // Evolution: subject ada di data.subject (bukan data.data.subject)
      const subject = meta.data?.subject || meta.data?.data?.subject || "";
      const now = new Date().toISOString();

      const seen = new Set<string>();
      const rows: any[] = [];
      for (const p of participants) {
        // Evolution: JID di p.id
        const jid = p.id || p.jid || "";
        const phone = cleanJid(p.cleanedParticipantPn || p.cleanedSenderPn || p.phone || p.number || jid || "");
        if (!phone || seen.has(phone)) continue;
        seen.add(phone);
        rows.push({
          group_id: groupJid,
          phone,
          member_jid: `${phone}@s.whatsapp.net`,
          member_name: p.name || p.notify || p.pushName || null,
          name: p.name || p.notify || p.pushName || null,
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

    case "kick": {
      const targetJid = quotedParticipant || "";

      if (!targetJid) {
        await sendText(
          groupJid,
          "Reply pesan member yang ingin di-kick.\n\nContoh:\n.kick",
          messageId
        );
        return true;
      }
    
      const admins = await getGroupAdmins(groupJid);
    
      const targetPhone = cleanJid(targetJid);
    
      if (!targetPhone) {
        await sendText(
          groupJid,
          "Gagal membaca target member.",
          messageId
        );
        return true;
      }
    
      if (admins.includes(targetPhone)) {
        await sendText(
          groupJid,
          "❌ Tidak bisa kick admin grup.",
          messageId
        );
        return true;
      }
    
      await removeParticipants(
        groupJid,
        [targetJid]
      );
    
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
        ".kick — reply pesan untuk kick membernya\n" +
        ".blacklist <nomor> / .delblacklist <nomor>",
        messageId,
      );
      return true;
    }

    default:
      return false;
  }
}

// ── Payment List Parser ────────────────────────────────────────────────────
interface PaymentEntry {
  kode: string;       // K.AH1221
  tagRaw: string;     // raw text setelah @ (nomor HP atau nama)
  tagJid: string;     // JID dari mentionedJid jika ada
  nama: string;
  norek: string;
  bank: string;
  totalGet: string;
  potget: string;
}

function parsePaymentList(text: string, msg: any): PaymentEntry[] {
  const results: PaymentEntry[] = [];

  // Ambil mentionedJid dari pesan (Evolution API menyertakan ini untuk @tag)
  const mentionedJids: string[] = 
    msg?.message?.extendedTextMessage?.contextInfo?.mentionedJid ||
    msg?.message?.conversation && [] ||
    msg?.contextInfo?.mentionedJid ||
    msg?.mentionedJid ||
    [];

  // Split per blok K.AHxxxx — setiap blok dipisah oleh baris kosong atau K.AH baru
  const blocks = text.split(/(?=\*?K\.AH\d+)/i).map(b => b.trim()).filter(Boolean);

  let jidIndex = 0; // mentionedJids diurutkan sesuai urutan @ di teks

  for (const block of blocks) {
    const kodeMatch = block.match(/K\.AH(\d+)/i);
    if (!kodeMatch) continue;
    const kode = `K.AH${kodeMatch[1]}`;

    // Cari baris yang mengandung @ (tag member)
    // Format bisa: "@+62 857-xxx" atau "@Nama" atau "@Nama Lengkap"
    const tagLine = block.split("\n").find(l => l.trim().startsWith("@"));
    let tagRaw = "";
    if (tagLine) {
      tagRaw = tagLine.trim().replace(/^@/, "").trim();
    }

    // Ambil JID dari mentionedJids (urutan sama dengan @ di teks)
    const tagJid = mentionedJids[jidIndex] || "";
    if (tagLine) jidIndex++;

    // Parse field-field lain
    const get = (label: string) => {
      const re = new RegExp(`${label}\\s*:\\s*(.+)`, "i");
      const m = block.match(re);
      return m ? m[1].trim() : "";
    };

    results.push({
      kode,
      tagRaw,
      tagJid,
      nama: get("Nama"),
      norek: get("No\\.?\\s*[Rr]ek(?:ening)?") || get("Norek"),
      bank: get("(?:Jenis\\s+)?[Bb]ank"),
      totalGet: get("Total\\s+get"),
      potget: get("Potget"),
    });
  }

  return results;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (req.method === "GET") {
    return new Response(JSON.stringify({ status: "active", service: "wa-webhook-evolution" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  try {
    const rawBody = await req.text();

    // Evolution mengirim webhook dengan header "apikey"
    const sigHeader =
      req.headers.get("apikey") ||
      req.headers.get("x-evolution-token") ||
      req.headers.get("x-webhook-signature") ||
      req.headers.get("authorization");

    const valid = await verifySignature(rawBody, sigHeader);
    if (!valid) {
      return new Response(JSON.stringify({ error: "invalid signature" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = JSON.parse(rawBody);
    const event: string = body?.event || "";

    // Group participant events
    const participantEvents = new Set([
      "group-participants.update", "groups.participants.update", "group.participants.update",
    ]);
    if (participantEvents.has(event)) {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const d = body?.data || {};
      const groupJid: string = d.id || d.groupId || d.jid || d.remoteJid || "";
      const action: string = (d.action || d.type || "").toLowerCase();
      // Evolution: participants berupa array string JID
      const participants: any[] = d.participants || d.members || [];


      if (groupJid && participants.length > 0) {
        const { data: gs } = await supabase
          .from("group_settings").select("welcome_message,left_message,group_name").eq("group_id", groupJid).maybeSingle();
        const meta = await getGroupMetadata(groupJid);
        // Evolution: subject di data.subject
        const subject = (gs as any)?.group_name || meta.data?.subject || meta.data?.data?.subject || "";
        for (const p of participants) {
          const phone = cleanJid(
            typeof p === "string"
              ? p
              : (
                  p.id ||
                  p.phoneNumber ||
                  p.cleanedParticipantPn ||
                  p.cleanedSenderPn ||
                  p.phone ||
                  p.number ||
                  p.jid ||
                  ""
                )
          );
          if (!phone) continue;
          if (action === "add") {
            // TEMPORARY DISABLED: blacklist check causing DB errors + egress spike
            // const { data: bl } = await supabase
            //   .from("group_blacklist").select("phone").or(`group_id.eq.${groupJid},group_id.is.null`).eq("phone", phone).maybeSingle();
            // if (bl) {
            //   await removeParticipants(
            //     groupJid,
            //     [`${phone}@s.whatsapp.net`]
            //   );
            //   await sendText(groupJid, `🚫 Nomor ${toLocalPhone(phone)} ada di blacklist, otomatis dikeluarkan.`);
            //   continue;
            // }
            const welcome = (gs as any)?.welcome_message;
            if (welcome) {
              const text = welcome.replace(/\{name\}/gi, `@${phone}`).replace(/@user/gi, `@${phone}`).replace(/\{group\}/gi, subject);
              await sendMentions(
                groupJid,
                text,
                [`${phone}@s.whatsapp.net`]
              );
            }
          } else if (action === "remove" || action === "leave") {
            const leftMsg = (gs as any)?.left_message;
            if (leftMsg) {
              const text = leftMsg.replace(/\{name\}/gi, `@${phone}`).replace(/@user/gi, `@${phone}`).replace(/\{group\}/gi, subject);
              await sendMentions(
                groupJid,
                text,
                [`${phone}@s.whatsapp.net`]
              );
            }
          }
        }
      }
      return new Response(JSON.stringify({ status: "ok-participants" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── CONNECTION_UPDATE: kirim notif ke admin jika instance disconnect ──
    if (event === "connection.update" || event === "CONNECTION_UPDATE") {
      const state: string = (body?.data?.state || body?.state || "").toLowerCase();
      const instanceName: string = body?.instance || body?.data?.instance || getInstanceName();

      // Hanya kirim notif kalau state = close / disconnected / connecting (bukan open)
      if (state && state !== "open") {
        const supabaseConn = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const { data: settings } = await supabaseConn
          .from("notification_settings")
          .select("admin_alert_phone")
          .eq("id", "default")
          .single();

        const adminPhone = (settings as any)?.admin_alert_phone || "";
        if (adminPhone) {
          const intlPhone = adminPhone.replace(/[^0-9]/g, "").replace(/^0/, "62");
          const target = `${intlPhone}@s.whatsapp.net`;
          const stateLabel = state === "close" || state === "closed" ? "Terputus ❌" : "Menghubungkan ulang... 🔄";
          const msg = `⚠️ *WA Instance Alert*\n\nInstance *${instanceName}* mengalami gangguan koneksi.\nStatus: *${stateLabel}*\n\nSilakan cek halaman WA Connection di dashboard.`;
          try {
            await evolutionRequest(`/message/sendText/${getInstanceName()}`, "POST", {
              number: target,
              text: msg,
              options: { delay: 500 },
            });
          } catch (e) {
            console.error("[wa-webhook] Gagal kirim alert disconnect:", e);
          }
        }
      }

      return new Response(JSON.stringify({ status: "ok-connection", state }), {
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
    
    // Refresh blacklist cache every 5 minutes
    await refreshBlockedPhonesCache(supabase);

    // Evolution: body.data adalah single message object (bukan array)
    // Wasender: body.data.messages adalah array
    // Kode berikut handles keduanya
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
        // Evolution: sender ada di key.participant untuk pesan grup
        key.participant ||
        key.cleanedParticipantPn || key.cleanedSenderPn ||
        msg.participant || msg.sender ||
        msg.cleanedParticipantPn || msg.cleanedSenderPn ||
        (isGroup ? "" : remoteJid)
      );
      const participantJid: string = key.participant || msg.participant || senderPhone;
      const senderJid = isGroup ? participantJid : (senderPhone || remoteJid);
      
      // Extract clean phone number from JID (handle @s.whatsapp.net and @lid format)
      let senderPhoneDigits = senderPhone || cleanJid(senderJid);
      // If JID ends with @lid, extract phone from keyParticipant
      if (participantJid && participantJid.includes("@lid")) {
        const lidMatch = participantJid.match(/(\d+)@lid/);
        if (lidMatch) senderPhoneDigits = lidMatch[1];
      }
      
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

      // DISABLED: Auto-kick link (removed per user request)
      // const isGroupInvite =
      //   /chat\.whatsapp\.com\//i.test(text) ||
      //   /https?:\/\/chat\.whatsapp\.com\//i.test(text);
      //
      // if (isGroup && isGroupInvite) {
      //   const admins = await getGroupAdmins(groupJid);
      //   if (!admins.includes(senderPhone)) {
      //     console.log("[ANTI LINK]", senderPhone, text);
      //     await sendText(groupJid, "JANGAN SHARE LINK!!\nMember otomatis dikeluarkan dari grup.");
      //     await removeParticipants(groupJid, [participantJid]);
      //     continue;
      //   }
      // }

      // Check if sender is blocked (name pattern or phone number)
      if (isBlockedSender(pushName, senderPhoneDigits)) {
        continue;
      }

      // ── Payment List Parser (debug mode) ────────────────────────────────
      // Deteksi pesan teks yang mengandung format K.AHxxxx (payment list dari admin)
      // Bot balas dengan hasil parsean supaya kita tahu tag terbaca sebagai apa
      if (!imageMsg && text && isGroup && /K\.AH\d+/i.test(text)) {
        const parsed = parsePaymentList(text, msg);
        if (parsed.length > 0) {
          const lines = parsed.map((p, i) =>
            `[${i + 1}] Kode: ${p.kode}\n` +
            `    Tag raw: ${p.tagRaw}\n` +
            `    Tag JID: ${p.tagJid || "-"}\n` +
            `    Nama: ${p.nama || "-"}\n` +
            `    Norek: ${p.norek || "-"}\n` +
            `    Bank: ${p.bank || "-"}\n` +
            `    Total get: ${p.totalGet || "-"}\n` +
            `    Potget: ${p.potget || "-"}`
          ).join("\n\n");
          await sendText(groupJid, `🔍 *DEBUG Payment List Parser*\n\n${lines}`);
        }
        continue;
      }

      // DISABLED: Command handler (removed per user request)
      // if (!imageMsg && text && isGroup && text.startsWith(".")) {
      //   await handleCommand({
      //     supabase, text, groupJid, senderJid, messageId: waMessageId,
      //     quotedText, quotedStanzaId, quotedMsg, quotedParticipant: ctxInfo?.participant,
      //   });
      //   continue;
      // }

      if (isGroup) {
        const { data: groupCfg } = await supabase
          .from("group_settings")
          .select("group_mode")
          .eq("group_id", groupJid)
          .maybeSingle();
            
        const mode = groupCfg?.group_mode || "RECEIPT";
      
        if (mode === "DISABLED") {
          continue;
        }
      
        if (mode === "CHAT" && imageMsg) {
          continue;
        }
      }

      if (!imageMsg) continue;

      // Evolution: ambil media sebagai base64, lalu upload ke Supabase storage
      let imageBuffer: Uint8Array | null = null;

      // Opsi 1: base64 sudah ada langsung di payload webhook
      const directBase64 = imageMsg.base64 || msg.base64 || m.base64;
      if (directBase64) {
        try {
          const binaryStr = atob(directBase64);
          imageBuffer = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) {
            imageBuffer[i] = binaryStr.charCodeAt(i);
          }
        } catch (e) {
          console.error("[MEDIA] Gagal parse base64 dari payload:", e);
        }
      }

      // Opsi 2: Coba getBase64FromMediaMessage (hanya jika ada mediaKey/directPath)
      if (!imageBuffer && (imageMsg.mediaKey || imageMsg.directPath)) {
        try {
          const mediaData = await getMediaBase64(msg);
          if (mediaData?.base64) {
            const binaryStr = atob(mediaData.base64);
            imageBuffer = new Uint8Array(binaryStr.length);
            for (let i = 0; i < binaryStr.length; i++) {
              imageBuffer[i] = binaryStr.charCodeAt(i);
            }
          }
        } catch (e) {
          console.error("[MEDIA] Gagal getBase64:", e);
        }
      }

      // Opsi 3: Coba download dari URL apapun (termasuk mmg.whatsapp.net)
      // mmg.whatsapp.net URL mungkin encrypted, tapi kita tetap coba download
      // agar resi masuk dashboard. Admin bisa Re-OCR setelah Evolution dikonfigurasi.
      if (!imageBuffer) {
        const fileUrl = imageMsg.url || imageMsg.directPath || msg.mediaUrl || "";
        if (fileUrl) {
          try {
            const fetchResp = await fetch(fileUrl, {
              headers: { "User-Agent": "WhatsApp/2.23.24.82 A" },
            });
            if (fetchResp.ok) {
              const rawBytes = new Uint8Array(await fetchResp.arrayBuffer());
              if (rawBytes.length > 100) {
                imageBuffer = rawBytes;
              } else {
                console.error("[MEDIA] Download berhasil tapi file terlalu kecil");
              }
            } else {
              console.error("[MEDIA] URL fetch gagal:", fetchResp.status);
            }
          } catch (e) {
            console.error("[MEDIA] Gagal fetch URL:", e instanceof Error ? e.message : "unknown");
          }
        } else {
          console.error("[MEDIA] Tidak ada URL yang tersedia di imageMsg");
        }
      }

      if (!imageBuffer) {
        console.error("[MEDIA] Semua opsi gagal - resi dilewati");
        continue;
      }

      let groupSubject = "";
      if (isGroup) {
        const meta = await getGroupMetadata(groupJid);
        // Evolution: subject bisa di data.subject, data[0].subject (array), atau data.data.subject
        const gd = Array.isArray(meta.data) ? meta.data[0] : (meta.data?.data || meta.data);
        groupSubject = gd?.subject || "";
      }
      const source = isGroup ? groupSubject : "WA Personal";
      const keterangan = caption ? `${caption} - ${source}` : source;

      // ── Duplicate check: cek apakah ada receipt Pending dari pengirim yang sama
      // dalam 60 detik terakhir (member kirim ke banyak group sekaligus).
      // Kalau ada → jangan buat receipt baru, langsung link wa_message ke receipt lama.
      const sixtySecAgo = new Date(Date.now() - 60 * 1000).toISOString();
      const { data: existing } = await supabase
        .from("receipts")
        .select("id")
        .eq("nomor_hp", formattedPhone)
        .eq("status", "Pending")
        .gte("created_at", sixtySecAgo)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (existing?.id) {
        // Receipt dari group lain sudah ada — cukup tambahkan WA message baru
        await supabase.from("receipt_wa_messages").insert({
          receipt_id: existing.id,
          wa_message_id: waMessageId,
          phone: senderPhoneDigits,
          group_id: groupJid || null,
          group_name: groupSubject || null,
          is_group: isGroup,
          remote_jid: remoteJid,
          participant: isGroup ? (key.participant || msg.participant || senderPhoneDigits) : null,
          from_me: fromMe,
          key_json: key,
          message_json: msg.message || msg,
        });
        // Tidak perlu OCR ulang — receipt induk sudah/sedang di-OCR
        continue;
      }

      const fileName = `wa_${senderPhoneDigits}_${Date.now()}.jpg`;
      
      // Kompresi gambar sebelum upload
      const compressedBuffer = await compressImage(imageBuffer);

      // Upload ke Cloudflare R2 (egress gratis)
      let imagePublicUrl: string;
      try {
        imagePublicUrl = await r2Upload(fileName, compressedBuffer, "image/jpeg");
      } catch (e) {
        console.error("[R2] Upload gagal:", e instanceof Error ? e.message : "unknown");
        continue;
      }

      const { data: ins, error: insErr } = await supabase.from("receipts").insert({
        nama: pushName, nomor_hp: formattedPhone, nominal: 0,
        jam_transfer: "00:00", image_url: imagePublicUrl,
        keterangan, status: "Pending",
      }).select("id").single();
      if (insErr) continue;

      await supabase.from("receipt_wa_messages").insert({
        receipt_id: ins.id,
        wa_message_id: waMessageId,
        phone: senderPhoneDigits,
        group_id: groupJid || null,
        group_name: groupSubject || null,
        is_group: isGroup,
        // Evolution v1.7.x: simpan full key dan message untuk reply
        remote_jid: remoteJid,
        participant: isGroup ? (key.participant || msg.participant || senderPhoneDigits) : null,
        from_me: fromMe,
        key_json: key,
        message_json: msg.message || msg,
      });

      // Fire-and-forget: OCR + auto-match di background
      // Tidak di-await agar webhook langsung response ke Evolution
      fetch(`${SUPABASE_URL}/functions/v1/auto-ocr`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({ receipt_id: ins.id }),
      }).catch((e) => console.error("[auto-ocr trigger] failed", e instanceof Error ? e.message : "unknown"));
    }

    return new Response(JSON.stringify({ status: "ok" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Webhook error:", err instanceof Error ? err.message : "unknown");
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});