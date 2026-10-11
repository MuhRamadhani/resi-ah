import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";
import {
  sendText,
  sendImage,
  sendMentions,
  cleanJid,
  toLocalPhone,
  verifySignature,
  getGroupMetadata,
  getGroups,
  wasenderRequest,
} from "../_shared/wasender.ts";
import { r2Upload } from "../_shared/r2.ts";
import { parseBulkPayment, collectMentionedJids, jidToPhone } from "../_shared/parseBulkPembayaran.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-signature",
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

function isBlockedSender(_name: string, _phoneDigits: string): boolean {
  // DISABLED - tidak dipakai
  return false;
}

async function compressImage(imageBuffer: Uint8Array): Promise<Uint8Array> {
  // Deteksi format: imagescript hanya support PNG dan JPEG
  // WebP: header 52 49 46 46 ... 57 45 42 50
  // HEIC/HEIF: skip juga
  const isJpeg = imageBuffer[0] === 0xFF && imageBuffer[1] === 0xD8;
  const isPng  = imageBuffer[0] === 0x89 && imageBuffer[1] === 0x50;
  if (!isJpeg && !isPng) {
    // Format tidak didukung (WebP, HEIC, dll) — gunakan original langsung
    return imageBuffer;
  }

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
    return compressed;
  } catch (e) {
    console.error("[COMPRESS] Gagal kompresi, gunakan original:", e);
    return imageBuffer;
  }
}

async function createThumbnail(imageBuffer: Uint8Array): Promise<Uint8Array> {
  // Hanya proses PNG dan JPEG — imagescript tidak support WebP/HEIC
  const isJpeg = imageBuffer[0] === 0xFF && imageBuffer[1] === 0xD8;
  const isPng  = imageBuffer[0] === 0x89 && imageBuffer[1] === 0x50;
  if (!isJpeg && !isPng) return imageBuffer;

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

// ── Cache list group dari GET /api/groups (hindari 429 rate limit) ──
let groupsCache: Map<string, string> = new Map(); // groupJid → name
let groupsCacheAt = 0;
const GROUPS_CACHE_TTL = 10 * 60 * 1000; // 10 menit

/** Ambil nama group dari GET /api/groups (list semua group sekaligus, cached). */
async function getGroupNameFromList(groupJid: string): Promise<string> {
  const now = Date.now();
  if (now - groupsCacheAt > GROUPS_CACHE_TTL || groupsCache.size === 0) {
    try {
      const r = await getGroups();
      const list: any[] = Array.isArray(r.data?.data) ? r.data.data
        : Array.isArray(r.data) ? r.data
        : r.data?.data?.items || [];
      const next = new Map<string, string>();
      for (const g of list) {
        const jid = g.jid || g.id || "";
        const name = g.name || g.subject || "";
        if (jid && name) next.set(jid, name);
      }
      if (next.size > 0) {
        groupsCache = next;
        groupsCacheAt = now;
      }
    } catch (e) {
      console.error("[GROUP LIST] gagal fetch:", e instanceof Error ? e.message : "unknown");
    }
  }
  return groupsCache.get(groupJid) || "";
}

// Bot phone: set WASENDER_BOT_PHONE di env vars
const BOT_PHONE = (Deno.env.get("WASENDER_BOT_PHONE") || Deno.env.get("EVOLUTION_BOT_PHONE") || "").replace(/[^0-9]/g, "");

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

  // Wasender: ambil URL langsung dari payload (base64 media ada di webhook jika setting aktif)
  function resolveMediaUrl(mediaObj: any): string {
    // Gunakan URL publik jika tersedia dan tidak encrypted
    if (mediaObj?.url && !mediaObj.url.includes(".enc")) return mediaObj.url;
    return "";
  }

  if (imageMsg) {
    const caption = imageMsg.caption || quotedText || "";
    const url = resolveMediaUrl(imageMsg);
    if (url) {
      await sendImage(groupJid, url, caption);
      // Kirim mentions terpisah karena sendImage tidak support mentions
      if (mentions.length > 0) await sendMentions(groupJid, caption || "⬆️", mentions);
      return;
    } else if (mentions.length > 0) {
      // Tidak ada URL — fallback: kirim caption/teks dengan mentions
      await sendMentions(groupJid, caption || quotedText || "⬆️", mentions);
      return;
    }
  } else if (videoMsg) {
    const caption = videoMsg.caption || quotedText || "";
    const url = resolveMediaUrl(videoMsg);
    if (url) {
      // WasenderAPI: kirim video via send-message type video
      await wasenderRequest("/api/send-message", "POST", {
        to: groupJid,
        type: "video",
        url,
        caption,
        mentions,
      });
      return;
    }
  } else if (docMsg) {
    const fileName = docMsg.fileName || docMsg.title || "document";
    const url = resolveMediaUrl(docMsg);
    if (url) {
      // WasenderAPI: kirim document via send-message type document
      await wasenderRequest("/api/send-message", "POST", {
        to: groupJid,
        type: "document",
        url,
        fileName,
        caption: quotedText || "",
        mentions,
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
      // Wasender: ambil nama group dari list groups (1 request, hindari 429)
      const subject = await getGroupNameFromList(groupJid);
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

// Ambil list admin phone dari env var PAYMENT_ADMIN_PHONES (comma-separated)
// Format: "628123456789,628987654321" (tanpa spasi)
function getPaymentAdminPhones(): Set<string> {
  const raw = Deno.env.get("PAYMENT_ADMIN_PHONES") || "";
  const phones = raw.split(",").map((p) => p.trim()).filter(Boolean);
  return new Set(phones);
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

    // WasenderAPI mengirim webhook dengan header "X-Webhook-Signature"
    const sigHeader = req.headers.get("x-webhook-signature");

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
              // Wasender mentions: array nomor HP (bukan JID)
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

    // ── CONNECTION_UPDATE: kirim notif ke admin jika session disconnect ──
    if (event === "connection.update" || event === "CONNECTION_UPDATE" || event === "session.status") {
      const state: string = (body?.data?.state || body?.data?.status || body?.state || "").toLowerCase();
      const sessionLabel: string = body?.data?.sessionId || body?.instance || body?.data?.instance || "bot";

      // Hanya kirim notif kalau state = close / disconnected / connecting (bukan open/connected)
      if (state && state !== "open" && state !== "connected") {
        const supabaseConn = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const { data: settings } = await supabaseConn
          .from("notification_settings")
          .select("admin_alert_phone")
          .eq("id", "default")
          .single();

        const adminPhone = (settings as any)?.admin_alert_phone || "";
        if (adminPhone) {
          const intlPhone = adminPhone.replace(/[^0-9]/g, "").replace(/^0/, "62");
          const stateLabel = state === "close" || state === "closed" || state === "disconnected" ? "Terputus ❌" : "Menghubungkan ulang... 🔄";
          const msg = `⚠️ *WA Alert*\n\nSession *${sessionLabel}* mengalami gangguan koneksi.\nStatus: *${stateLabel}*\n\nSilakan cek halaman WA Connection di dashboard.`;
          try {
            await sendText(intlPhone, msg);
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
    // Wasender mengirim SEMUA pesan via messages-personal.received dan messages-group.received
    // Tidak ada duplikat — proses semua event yang masuk

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    
    // Refresh blacklist cache every 5 minutes
    await refreshBlockedPhonesCache(supabase);

    // Wasender: body.data.messages adalah single object
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

      // Wasender mengirim 2 event untuk pesan grup:
      // - messages-group.received  (remoteJid = group JID @g.us)  ← yang kita mau
      // - messages-personal.received (remoteJid = sender JID @s.whatsapp.net) ← skip
      // Kalau event personal tapi isGroup false = memang pesan personal → proses
      // Kalau event personal tapi isGroup true = duplikat dari group event → skip
      if (event === "messages-personal.received" && isGroup) continue;

      // Wasender: nomor pengirim ada di key.cleanedParticipantPn (grup) atau key.cleanedSenderPn (personal)
      // Tidak ada @lid issue — Wasender resolve otomatis
      const senderPhone = cleanJid(
        key.cleanedParticipantPn ||   // Wasender: sender di grup (sudah resolved dari LID)
        key.cleanedSenderPn ||        // Wasender: sender personal
        key.participant ||            // fallback: raw JID participant
        msg.participant || msg.sender ||
        (isGroup ? "" : remoteJid)
      );
      const participantJid: string = key.participant || key.participantPn || msg.participant || senderPhone;
      const senderJid = isGroup ? participantJid : (senderPhone || remoteJid);

      // cleanedParticipantPn sudah berupa digits bersih (tanpa @lid)
      let senderPhoneDigits = senderPhone || cleanJid(senderJid);
      
      const formattedPhone = toLocalPhone(senderPhoneDigits);
      const groupJid = isGroup ? remoteJid : "";
      const waMessageId: string = key.id || msg.id || msg.messageId || "";
      const pushName: string = msg.pushName || msg.notify || formattedPhone;

      // ── Dedup by wa_message_id — PALING AWAL sebelum apapun ──
      // Wasender mengirim 3 webhook paralel untuk 1 pesan.
      // Cek ini tidak bisa sepenuhnya menghilangkan race, tapi mengurangi window.
      // Race condition yang lolos akan tertangkap oleh unique constraint di DB.
      if (waMessageId) {
        const { data: existingWaMsg } = await supabase
          .from("receipt_wa_messages")
          .select("id")
          .eq("wa_message_id", waMessageId)
          .maybeSingle();
        if (existingWaMsg) {
          console.log(`[DEDUP] wa_message_id ${waMessageId} sudah ada, skip`);
          continue;
        }
      }

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

      // ── Payment List Parser ────────────────────────────────────────────────
      // Trigger hanya jika ada K.AHxxxx sebagai HEADER blok (di awal baris, bisa dengan *)
      // Bukan K.AH di tengah kalimat atau di bagian "Contoh :"
      const hasKloterHeader = /(?:^|\n)\s*\*?K\.AH\d+/i.test(text);
      if (!imageMsg && text && isGroup && hasKloterHeader) {
        // Hanya proses dari admin yang terdaftar di PAYMENT_ADMIN_PHONES
        const adminPhones = getPaymentAdminPhones();
        const senderIntl = (senderPhoneDigits || "").replace(/[^0-9]/g, "");
        const isAdmin = adminPhones.size === 0 || adminPhones.has(senderIntl);
        if (!isAdmin) {
          console.log(`[PAYMENT] Skip non-admin sender: ${senderIntl}`);
          continue;
        }

        const mentionedJids = collectMentionedJids(msg.message || msg);
        const parsed = parseBulkPayment(text, mentionedJids);
        const valid = parsed.filter((p) => p.kloter);
        if (valid.length > 0) {
          for (const p of valid) {
            await supabase.from("payment_entries").insert({
              kode: p.kloter,
              tag_raw: p.tagRaw || null,
              tag_phone: p.tagPhone || null,
              tag_jid: p.tagJid || null,
              nama: p.namaRek || null,
              norek: p.noRek || null,
              bank: p.bank || null,
              total_get: p.nominal ? String(p.nominal) : null,
              potget: p.adminBank ? String(p.adminBank) : null,
              note: p.note || null,
              raw_text: text,
              group_id: groupJid,
              sender_jid: senderJid,
              created_at: new Date().toISOString(),
            });
          }
          console.log(`[PAYMENT] Parsed ${valid.length}/${parsed.length} entries from ${senderIntl}`);
        } else {
          console.log(`[PAYMENT] No valid entries from ${senderIntl}, warnings: ${parsed.flatMap(p => p.warnings).join(", ")}`);
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

      // Opsi 2: Download dari URL (fallback jika base64 tidak ada di payload)
      // Aktifkan "include base64 media" di WasenderAPI session settings agar base64 selalu ada
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
        // Coba dari payload Wasender dulu
        groupSubject = msg.groupName || msg.group_name || msg.subject ||
          body?.data?.groupName || body?.data?.group_name || "";

        // Fallback: baca dari DB group_settings (hasil sync sebelumnya)
        if (!groupSubject) {
          const { data: gs } = await supabase
            .from("group_settings")
            .select("group_name")
            .eq("group_id", groupJid)
            .maybeSingle();
          groupSubject = (gs as any)?.group_name || "";
        }
        // Fallback: GET /api/groups (cached 10 menit, hindari 429)
        if (!groupSubject) {
          groupSubject = await getGroupNameFromList(groupJid);
        }
        // Last resort: pakai JID yang dipersingkat
        if (!groupSubject) groupSubject = groupJid.replace("@g.us", "");
      }
      const source = isGroup ? (groupSubject || groupJid) : "WA Personal";
      // keterangan: hanya nama group/source, bukan caption gambar
      // caption gambar disimpan terpisah di OCR keterangan setelah OCR
      const keterangan = source;

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
        const { error: waMsgErr } = await supabase.from("receipt_wa_messages").insert({
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
        if (waMsgErr) {
          // Unique constraint violation = duplikat webhook, skip
          console.log(`[DEDUP] wa_message insert conflict: ${waMsgErr.message}`);
        }
        // Tidak perlu OCR ulang — receipt induk sudah/sedang di-OCR
        continue;
      }

      // Gunakan wa_message_id sebagai nama file R2 agar 3 upload paralel
      // tulis ke key yang sama (R2 PUT idempotent — tidak ada 3 file berbeda)
      const safeId = waMessageId.replace(/[^a-zA-Z0-9_-]/g, "_");
      const fileName = waMessageId
        ? `wa_${safeId}.jpg`
        : `wa_${senderPhoneDigits}_${Date.now()}.jpg`;
      
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

      const { error: waMsgErr2 } = await supabase.from("receipt_wa_messages").insert({
        receipt_id: ins.id,
        wa_message_id: waMessageId,
        phone: senderPhoneDigits,
        group_id: groupJid || null,
        group_name: groupSubject || null,
        is_group: isGroup,
        // Simpan full key dan message untuk reply/reaction
        remote_jid: remoteJid,
        participant: isGroup ? (key.participant || msg.participant || senderPhoneDigits) : null,
        from_me: fromMe,
        key_json: key,
        message_json: msg.message || msg,
      });
      if (waMsgErr2) {
        // Unique constraint violation = webhook duplikat tiba bersamaan
        // Rollback: hapus receipt yang baru saja dibuat agar tidak jadi orphan
        console.log(`[DEDUP] wa_message conflict, rollback receipt ${ins.id}: ${waMsgErr2.message}`);
        await supabase.from("receipts").delete().eq("id", ins.id);
        continue;
      }

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