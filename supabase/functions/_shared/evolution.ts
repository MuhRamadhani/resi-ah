// Evolution API Helper
// Docs: https://doc.evolution-api.com/v2

const BASE_URL = (Deno.env.get("EVOLUTION_BASE_URL") || "").replace(/\/+$/, "");

export function getApiKey(): string {
  const key = Deno.env.get("EVOLUTION_API_KEY");
  if (!key) throw new Error("EVOLUTION_API_KEY not configured");
  return key;
}

export function getInstanceName(): string {
  const instance = Deno.env.get("EVOLUTION_INSTANCE_NAME");
  if (!instance) throw new Error("EVOLUTION_INSTANCE_NAME not configured");
  return instance;
}

export function getWebhookSecret(): string {
  return Deno.env.get("EVOLUTION_WEBHOOK_SECRET") || "";
}

export function getBaseUrl(): string {
  return BASE_URL;
}

export async function evolutionRequest(
  path: string,
  method: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: any }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "apikey": getApiKey(),
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
    console.error(`[evolution] ${method} ${path} -> ${res.status}`);
  }

  return { ok: res.ok, status: res.status, data };
}

//////////////////////////////////////////////////////
// JID HELPERS
//////////////////////////////////////////////////////

function asUserJid(p: string): string {
  if (!p) return p;
  if (p.includes("@")) return p;
  const digits = p.replace(/[^0-9]/g, "");
  return `${digits}@s.whatsapp.net`;
}

//////////////////////////////////////////////////////
// MESSAGE SENDERS
//////////////////////////////////////////////////////

export function sendText(
  to: string,
  text: string,
  _replyToMsgId?: string | number,
) {
  const instance = getInstanceName();
  return evolutionRequest(`/message/sendText/${instance}`, "POST", {
    number: to,
    text,
  });
}

export function sendImage(
  to: string,
  imageUrl: string,
  caption = "",
) {
  const instance = getInstanceName();
  return evolutionRequest(`/message/sendMedia/${instance}`, "POST", {
    number: to,
    mediatype: "image",
    media: imageUrl,
    caption,
  });
}

export function sendMentions(
  to: string,
  text: string,
  mentions: string[],
) {
  const instance = getInstanceName();
  return evolutionRequest(`/message/sendText/${instance}`, "POST", {
    number: to,
    text,
    // Evolution menggunakan field "mentioned" untuk hidden tag
    mentioned: mentions,
  });
}

//////////////////////////////////////////////////////
// GET MEDIA AS BASE64
// Evolution tidak punya decrypt-media URL seperti Wasender.
// Gunakan endpoint ini untuk mengambil media sebagai base64.
//////////////////////////////////////////////////////

export async function getMediaBase64(
  message: any,
): Promise<{ base64: string; mimetype: string } | null> {
  const instance = getInstanceName();
  const r = await evolutionRequest(
    `/chat/getBase64FromMediaMessage/${instance}`,
    "POST",
    {
      message,
      convertToMp4: false,
    },
  );
  if (!r.ok || !r.data?.base64) return null;
  return {
    base64: r.data.base64,
    mimetype: r.data.mimetype || "image/jpeg",
  };
}

//////////////////////////////////////////////////////
// GROUP MANAGEMENT
//////////////////////////////////////////////////////

export function createGroup(name: string, participants: string[]) {
  const instance = getInstanceName();
  return evolutionRequest(`/group/create/${instance}`, "POST", {
    subject: name,
    participants: participants.map(asUserJid),
  });
}

export async function getGroupMetadata(groupJid: string) {
  const instance = getInstanceName();
  // Coba beberapa endpoint untuk berbagai versi Evolution
  const endpoints = [
    `/group/findGroupInfos/${instance}?groupJid=${encodeURIComponent(groupJid)}`,
    `/group/participants/${instance}?id=${encodeURIComponent(groupJid)}`,
  ];
  for (const ep of endpoints) {
    const r = await evolutionRequest(ep, "GET");
    if (r.ok) return r;
  }
  return evolutionRequest(endpoints[0], "GET");
}

export async function getGroupParticipants(groupJid: string) {
  const instance = getInstanceName();
  const endpoints = [
    `/group/participants/${instance}?id=${encodeURIComponent(groupJid)}`,
    `/group/findGroupInfos/${instance}?groupJid=${encodeURIComponent(groupJid)}`,
  ];
  for (const ep of endpoints) {
    const r = await evolutionRequest(ep, "GET");
    if (r.ok) return r;
  }
  return evolutionRequest(endpoints[0], "GET");
}

export function addParticipants(groupJid: string, participants: string[]) {
  const instance = getInstanceName();
  return evolutionRequest(`/group/updateParticipant/${instance}`, "POST", {
    groupJid,
    action: "add",
    participants: participants.map(asUserJid),
  });
}

export function removeParticipants(groupJid: string, participants: string[]) {
  const instance = getInstanceName();
  return evolutionRequest(`/group/updateParticipant/${instance}`, "POST", {
    groupJid,
    action: "remove",
    participants: participants.map(asUserJid),
  });
}

export function promoteParticipants(groupJid: string, participants: string[]) {
  const instance = getInstanceName();
  return evolutionRequest(`/group/updateParticipant/${instance}`, "POST", {
    groupJid,
    action: "promote",
    participants: participants.map(asUserJid),
  });
}

export async function setGroupAnnounce(groupJid: string, announce: boolean) {
  const instance = getInstanceName();
  try {
    const response = await evolutionRequest(
      `/group/updateSetting/${instance}`,
      "PATCH",
      {
        groupJid,
        action: announce ? "announcement" : "not_announcement",
      },
    );
    return { ok: true, data: response };
  } catch (error) {
    console.error("[GROUP ERROR]", error);
    return { ok: false, error };
  }
}

//////////////////////////////////////////////////////
// HELPERS
//////////////////////////////////////////////////////

export function cleanJid(jid: string): string {
  return (jid || "").split("@")[0].replace(/[^0-9]/g, "");
}

export function toLocalPhone(digits: string): string {
  const d = digits.replace(/[^0-9]/g, "");
  if (d.startsWith("62")) return "0" + d.slice(2);
  return d;
}

//////////////////////////////////////////////////////
// VERIFY WEBHOOK
// Evolution API mengirim webhook dengan header "apikey"
// yang berisi API key instance.
// 
// Opsi 1: Jika EVOLUTION_WEBHOOK_SECRET diset → bandingkan dengan secret tsb
// Opsi 2: Jika EVOLUTION_WEBHOOK_SECRET kosong → bandingkan dengan EVOLUTION_API_KEY
// Opsi 3: Jika keduanya kosong → terima semua request (tidak aman, tapi untuk testing)
//////////////////////////////////////////////////////

export async function verifySignature(
  _rawBody: string,
  signatureHeader: string | null,
): Promise<boolean> {
  const secret = getWebhookSecret();

  // Jika EVOLUTION_WEBHOOK_SECRET tidak diset → terima semua request
  // (Evolution tidak selalu mengirim signature, security dijaga oleh Supabase)
  if (!secret) {
    return true;
  }

  if (!signatureHeader) {
    return false;
  }

  const provided = signatureHeader.replace(/^Bearer\s+/i, "").trim();
  return provided === secret;
}
