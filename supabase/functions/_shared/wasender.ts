// WasenderAPI Helper
// Docs: https://wasenderapi.com/api-docs
// Cloud SaaS — tidak perlu self-host, tidak ada instance name di URL

const BASE_URL = "https://www.wasenderapi.com";

export function getApiKey(): string {
  const key = Deno.env.get("WASENDER_API_KEY");
  if (!key) throw new Error("WASENDER_API_KEY not configured");
  return key;
}

export function getWebhookSecret(): string {
  return Deno.env.get("WASENDER_WEBHOOK_SECRET") || "";
}

//////////////////////////////////////////////////////
// CORE HTTP CLIENT
//////////////////////////////////////////////////////

export async function wasenderRequest(
  path: string,
  method: string,
  body?: unknown,
  retries = 1,
): Promise<{ ok: boolean; status: number; data: any }> {
  const doRequest = async () => {
    const controller = new AbortController();
    // 30s timeout — Wasender kadang lambat terutama untuk /react
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(`${BASE_URL}${path}`, {
        method,
        signal: controller.signal,
        headers: {
          "Authorization": `Bearer ${getApiKey()}`,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      clearTimeout(timer);
      return res;
    } catch (e) {
      clearTimeout(timer);
      throw e;
    }
  };

  let lastStatus = 0;
  let lastData: any = null;
  // 429 ditangani terpisah dari retry 5xx supaya rate limit tidak langsung
  // dihitung sebagai gagal permanen.
  let rateWaits = 0;
  const MAX_RATE_WAITS = 3;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (attempt > 0) {
        // Backoff 3s sebelum retry
        await new Promise((r) => setTimeout(r, 3_000));
        console.log(`[wasender] retry ${attempt} ${method} ${path}`);
      }
      const res = await doRequest();
      let data: any = null;
      try {
        data = await res.json();
      } catch {
        data = await res.text().catch(() => null);
      }

      if (!res.ok) {
        // Body response dipotong 200 char. Sebelumnya JSON.stringify penuh —
        // body error Wasender bisa panjang dan ini jalan di tiap request gagal.
        const brief = typeof data === "string"
          ? data.slice(0, 200)
          : String(data?.message || data?.error || "").slice(0, 200);
        console.error(`[wasender] ${method} ${path} -> ${res.status} ${brief}`);
        lastStatus = res.status;
        lastData = data;
        // 429 → rate limit. Wasender kirim retry_after (detik) di body.
        // Tunggu lalu ulangi; jangan pakai kuota retry 5xx.
        if (res.status === 429 && rateWaits < MAX_RATE_WAITS) {
          rateWaits++;
          const secs = Math.min(Math.max(Number(data?.retry_after) || 5, 1), 15);
          console.log(`[wasender] 429 rate limit ${method} ${path} — tunggu ${secs}s (${rateWaits}/${MAX_RATE_WAITS})`);
          await new Promise((r) => setTimeout(r, secs * 1_000));
          attempt--;
          continue;
        }
        // 408 / 502 / 503 / 504 → retry
        if ((res.status === 408 || res.status >= 500) && attempt < retries) continue;
        return { ok: false, status: res.status, data };
      }

      return { ok: true, status: res.status, data };
    } catch (e) {
      // Network error / abort → retry
      console.error(`[wasender] ${method} ${path} -> network error:`, e instanceof Error ? e.message : e);
      lastStatus = 0;
      lastData = null;
      if (attempt < retries) continue;
    }
  }

  return { ok: false, status: lastStatus, data: lastData };
}

//////////////////////////////////////////////////////
// JID / PHONE HELPERS
//////////////////////////////////////////////////////

/** Strip @s.whatsapp.net / @g.us / @lid → digits only */
export function cleanJid(jid: string): string {
  return (jid || "").split("@")[0].replace(/[^0-9]/g, "");
}

/** Konversi nomor internasional 62xxx ke format lokal 0xxx */
export function toLocalPhone(digits: string): string {
  const d = digits.replace(/[^0-9]/g, "");
  if (d.startsWith("62")) return "0" + d.slice(2);
  return d;
}

/** Normalise phone → E.164 digits (62xxx) tanpa + dan tanpa @... */
function toIntlDigits(p: string): string {
  if (!p) return p;
  const digits = p.replace(/[^0-9]/g, "");
  if (digits.startsWith("0")) return "62" + digits.slice(1);
  return digits;
}

/** Normalise list phones untuk participant API */
function normalizeParticipants(participants: string[]): string[] {
  return participants.map(toIntlDigits);
}

//////////////////////////////////////////////////////
// MESSAGE SENDERS
//////////////////////////////////////////////////////

/** Kirim pesan teks biasa */
export function sendText(to: string, text: string) {
  return wasenderRequest("/api/send-message", "POST", {
    to,
    type: "text",
    text,            // Wasender pakai "text", bukan "message"
  });
}

/** Kirim gambar dengan caption opsional */
export function sendImage(to: string, imageUrl: string, caption = "") {
  return wasenderRequest("/api/send-message", "POST", {
    to,
    type: "image",
    url: imageUrl,
    caption,
  });
}

/**
 * Kirim teks dengan mention.
 * mentions: array nomor HP (62xxx atau 0xxx) — Wasender resolve sendiri ke tag WA.
 */
export function sendMentions(to: string, msgText: string, mentions: string[]) {
  const body: any = { to, type: "text", text: msgText };  // "text" bukan "message"
  if (mentions.length > 0) body.mentions = normalizeParticipants(mentions);
  return wasenderRequest("/api/send-message", "POST", body);
}

/**
 * Kirim pesan teks sebagai reply/quoted ke pesan dengan msgId tertentu.
 */
export function sendQuotedText(to: string, text: string, quotedMsgId: string) {
  return wasenderRequest("/api/send-message", "POST", {
    to,
    type: "text",
    text,            // "text" bukan "message"
    quotedMsgId,
  });
}

/**
 * Kirim reaction emoji ke sebuah pesan.
 * keyObj = key object dari webhook (remoteJid, id, fromMe, participant)
 * emoji  = emoji string, e.g. "❤️" atau "" untuk hapus reaction
 *
 * Format Wasender: POST /api/messages/react
 * Body: { key: { id, remoteJid, fromMe, participant? }, text: emoji }
 */
export function sendReaction(keyObj: { id: string; remoteJid: string; fromMe: boolean; participant?: string }, emoji: string) {
  const key: any = {
    id: keyObj.id,
    remoteJid: keyObj.remoteJid,
    fromMe: keyObj.fromMe,
  };
  if (keyObj.participant) key.participant = keyObj.participant;
  return wasenderRequest("/api/messages/react", "POST", { key, text: emoji });
}

/** Get semua group — response: { data: [{ jid, name, imgUrl }] } */
export function getGroups() {
  return wasenderRequest("/api/groups", "GET");
}

/**
 * Resolve LID → nomor HP (format 08xxx).
 * WA Privacy: LID (Link ID) adalah alias acak untuk nomor HP user.
 * Endpoint: GET /api/pn-from-lid/{lid}
 * Response: { success: true, data: { pn: "62xxx@s.whatsapp.net" } }
 * Return: "08xxx" atau "" jika gagal.
 */
export async function resolvePhoneFromLid(lidJid: string): Promise<string> {
  if (!lidJid || !lidJid.includes("@lid")) return "";
  const encoded = encodeURIComponent(lidJid);
  const r = await wasenderRequest(`/api/pn-from-lid/${encoded}`, "GET");
  if (!r.ok || !r.data?.success) {
    console.log(`[resolvePhoneFromLid] failed for ${lidJid}:`, r.status, r.data?.message || "");
    return "";
  }
  const pn: string = r.data?.data?.pn || r.data?.pn || "";
  if (!pn) return "";
  // pn format: "62xxx@s.whatsapp.net" → convert ke "08xxx"
  const digits = pn.replace(/@.+$/, "").replace(/[^0-9]/g, "");
  if (digits.startsWith("62")) return "0" + digits.slice(2);
  return digits;
}

//////////////////////////////////////////////////////
// MEDIA
//////////////////////////////////////////////////////

/**
 * Dekripsi media terenkripsi dari WhatsApp.
 * Webhook Wasender mengirim URL terenkripsi (mmg.whatsapp.net/...enc),
 * bukan base64. Endpoint ini mendekripsi dan return publicUrl (aktif 1 jam).
 *
 * messageObj = objek pesan WhatsApp, e.g. { imageMessage: { url, mediaKey, mimetype, fileSha256, fileLength } }
 * msgId      = id pesan
 * Return publicUrl (string) atau null jika gagal.
 */
export async function decryptMedia(
  messageObj: any,
  msgId: string,
): Promise<string | null> {
  const r = await wasenderRequest("/api/decrypt-media", "POST", {
    data: {
      messages: {
        key: { id: msgId },
        message: messageObj,
      },
    },
  });
  if (!r.ok || !r.data?.success) return null;
  return r.data.publicUrl || null;
}

//////////////////////////////////////////////////////
// GROUP MANAGEMENT
//////////////////////////////////////////////////////

export function createGroup(name: string, participants: string[]) {
  return wasenderRequest("/api/groups", "POST", {
    name,
    participants: normalizeParticipants(participants),
  });
}

export function getGroupMetadata(groupJid: string) {
  return wasenderRequest(`/api/groups/${encodeURIComponent(groupJid)}/metadata`, "GET");
}

export function getGroupParticipants(groupJid: string) {
  return wasenderRequest(`/api/groups/${encodeURIComponent(groupJid)}/participants`, "GET");
}

export function addParticipants(groupJid: string, participants: string[]) {
  return wasenderRequest(
    `/api/groups/${encodeURIComponent(groupJid)}/participants/add`,
    "POST",
    { participants: normalizeParticipants(participants) },
  );
}

export function removeParticipants(groupJid: string, participants: string[]) {
  return wasenderRequest(
    `/api/groups/${encodeURIComponent(groupJid)}/participants/remove`,
    "POST",
    { participants: normalizeParticipants(participants) },
  );
}

export function promoteParticipants(groupJid: string, participants: string[]) {
  // API expects action:"promote" and participants as JIDs (62xxx@s.whatsapp.net)
  const jids = normalizeParticipants(participants).map((p) =>
    p.includes("@") ? p : `${p}@s.whatsapp.net`
  );
  return wasenderRequest(
    `/api/groups/${encodeURIComponent(groupJid)}/participants/update`,
    "PUT",
    { action: "promote", participants: jids },
  );
}

export function setGroupAnnounce(groupJid: string, announce: boolean) {
  return wasenderRequest(
    `/api/groups/${encodeURIComponent(groupJid)}/settings`,
    "PUT",
    { announce },
  );
}

//////////////////////////////////////////////////////
// WEBHOOK VERIFICATION
// WasenderAPI mengirim header X-Webhook-Signature berisi secret plain-text
//////////////////////////////////////////////////////

export async function verifySignature(
  _rawBody: string,
  signatureHeader: string | null,
): Promise<boolean> {
  const secret = getWebhookSecret();

  // Jika WASENDER_WEBHOOK_SECRET tidak diset → terima semua (untuk testing)
  if (!secret) return true;

  if (!signatureHeader) return false;

  // Simple string comparison — Wasender pakai plain secret, bukan HMAC
  return signatureHeader.trim() === secret;
}
