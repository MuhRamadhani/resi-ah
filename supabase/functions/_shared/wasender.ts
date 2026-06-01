// Shared WasenderAPI helper
// Docs: https://wasenderapi.com/api-docs

const BASE_URL = (Deno.env.get("WASENDER_BASE_URL") || "https://www.wasenderapi.com/api").replace(/\/+$/, "");

export function getApiKey(): string {
  const key = Deno.env.get("WASENDER_API_KEY");
  if (!key) throw new Error("WASENDER_API_KEY not configured");
  return key;
}

export function getWebhookSecret(): string {
  return Deno.env.get("WASENDER_WEBHOOK_SECRET") || "";
}

export function getBaseUrl(): string {
  return BASE_URL;
}

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
      "Accept": "application/json",
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
    console.error(`Wasender ${method} ${path} -> ${res.status}`, JSON.stringify(data));
  }

  return {
    ok: res.ok,
    status: res.status,
    data,
  };
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

function toIntOrUndef(v: unknown): number | undefined {
  if (v === undefined || v === null) return undefined;

  if (typeof v === "number" && Number.isInteger(v)) return v;

  if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);

  return undefined;
}

export function sendText(
  to: string,
  text: string,
  replyToMsgId?: string | number
) {
  const body: Record<string, unknown> = {
    to,
    text,
  };

  const intId = toIntOrUndef(replyToMsgId);

  if (intId !== undefined) {
    body.replyTo = intId;
  }

  return wasenderRequest("/send-message", "POST", body);
}

//////////////////////////////////////////////////////
// EDIT MESSAGE
//////////////////////////////////////////////////////

export async function editMessage(
  messageId: string | number,
  text: string,
) {
  if (!messageId) return;
  return wasenderRequest(`/messages/${messageId}`, "PUT", { text });
}

//////////////////////////////////////////////////////
// SEND IMAGE
//////////////////////////////////////////////////////

export function sendImage(
  to: string,
  imageUrl: string,
  caption = ""
) {
  return wasenderRequest("/send-message", "POST", {
    to,
    imageUrl,
    text: caption,
  });
}

export function sendMentions(
  to: string,
  text: string,
  mentions: string[]
) {
  return wasenderRequest("/send-message", "POST", {
    to,
    text,
    mentions,
  });
}

//////////////////////////////////////////////////////
// DECRYPT MEDIA (IMAGE FROM WA)
//////////////////////////////////////////////////////

export async function decryptMedia(
  messageId: string,
  imageMessage: any
): Promise<string | null> {

  const r = await wasenderRequest(
    "/decrypt-media",
    "POST",
    {
      data: {
        messages: {
          key: {
            id: messageId
          },
          message: {
            imageMessage
          }
        }
      }
    }
  );

  if (!r.ok) return null;

  return (
    r.data?.publicUrl ||
    r.data?.data?.publicUrl ||
    null
  );
}

//////////////////////////////////////////////////////
// GROUP MANAGEMENT
//////////////////////////////////////////////////////

export function createGroup(
  name: string,
  participants: string[]
) {
  return wasenderRequest(
    "/groups",
    "POST",
    {
      name,
      participants: participants.map(asUserJid),
    }
  );
}

export function getGroupMetadata(
  groupJid: string
) {
  return wasenderRequest(
    `/groups/${encodeURIComponent(groupJid)}/metadata`,
    "GET"
  );
}

export function getGroupParticipants(
  groupJid: string
) {
  return wasenderRequest(
    `/groups/${encodeURIComponent(groupJid)}/participants`,
    "GET"
  );
}

export function addParticipants(
  groupJid: string,
  participants: string[]
) {
  return wasenderRequest(
    `/groups/${encodeURIComponent(groupJid)}/participants/add`,
    "POST",
    {
      participants: participants.map(asUserJid),
    }
  );
}

export function removeParticipants(
  groupJid: string,
  participants: string[]
) {
  return wasenderRequest(
    `/groups/${encodeURIComponent(groupJid)}/participants/remove`,
    "POST",
    {
      participants: participants.map(asUserJid),
    }
  );
}

export function promoteParticipants(
  groupJid: string,
  participants: string[]
) {
  return wasenderRequest(
    `/groups/${encodeURIComponent(groupJid)}/participants/update`,
    "PUT",
    {
      participants: participants.map(asUserJid),
      action: "promote",
    }
  );
}

//////////////////////////////////////////////////////
// OPEN / CLOSE GROUP
//////////////////////////////////////////////////////

export async function setGroupAnnounce(
  groupJid: string,
  announce: boolean
) {
  try {
    console.log(
      `[GROUP] ${announce ? "Closing" : "Opening"} group:`,
      groupJid
    );

    const endpoint = `/groups/${encodeURIComponent(groupJid)}/settings`;

    const response = await wasenderRequest(
      endpoint,
      "PUT",
      {
        announce,
      }
    );

    console.log("[GROUP RESPONSE]", response);

    return {
      ok: true,
      data: response,
    };
  } catch (error) {
    console.error("[GROUP ERROR]", error);

    return {
      ok: false,
      error,
    };
  }
}

//////////////////////////////////////////////////////
// HELPERS
//////////////////////////////////////////////////////

export function cleanJid(
  jid: string
): string {
  return (jid || "")
    .split("@")[0]
    .replace(/[^0-9]/g, "");
}

export function toLocalPhone(
  digits: string
): string {

  const d = digits.replace(/[^0-9]/g, "");

  if (d.startsWith("62")) {
    return "0" + d.slice(2);
  }

  return d;
}

//////////////////////////////////////////////////////
// VERIFY WEBHOOK SIGNATURE
//////////////////////////////////////////////////////

export async function verifySignature(
  rawBody: string,
  signatureHeader: string | null
): Promise<boolean> {

  const secret = getWebhookSecret();

  if (!secret) return true;

  if (!signatureHeader) return false;

  const provided = signatureHeader
    .replace(/^sha256=/i, "")
    .trim();

  if (provided === secret) return true;

  try {

    const enc = new TextEncoder();

    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      {
        name: "HMAC",
        hash: "SHA-256"
      },
      false,
      ["sign"]
    );

    const sig = await crypto.subtle.sign(
      "HMAC",
      key,
      enc.encode(rawBody)
    );

    const hex = Array.from(
      new Uint8Array(sig)
    )
      .map(b =>
        b.toString(16).padStart(2, "0")
      )
      .join("");

    return provided.toLowerCase() === hex;

  } catch {

    return false;

  }
}
