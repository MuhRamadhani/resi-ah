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
): Promise<{ ok: boolean; status: number; data: any }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = await res.text().catch(() => null);
  }

  if (!res.ok) {
    console.error(`[wasender] ${method} ${path} -> ${res.status}`);
  }

  return { ok: res.ok, status: res.status, data };
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
    message: text,
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
export function sendMentions(to: string, text: string, mentions: string[]) {
  const body: any = { to, type: "text", message: text };
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
    message: text,
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
  return wasenderRequest(
    `/api/groups/${encodeURIComponent(groupJid)}/participants/update`,
    "PUT",
    { participants: normalizeParticipants(participants), role: "admin" },
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
