/**
 * Cloudflare R2 helper — S3-compatible API via fetch + AWS Signature V4
 * Digunakan untuk upload dan delete gambar resi.
 * Egress dari R2 ke internet = GRATIS (tidak ada bandwidth cost).
 */

const encoder = new TextEncoder();

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, encoder.encode(data));
}

async function sha256hex(data: Uint8Array | string): Promise<string> {
  const buf = typeof data === "string" ? encoder.encode(data) : data;
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function getR2Config() {
  const accountId  = Deno.env.get("R2_ACCOUNT_ID")!;
  const accessKey  = Deno.env.get("R2_ACCESS_KEY")!;
  const secretKey  = Deno.env.get("R2_SECRET_KEY")!;
  const bucket     = Deno.env.get("R2_BUCKET") || "receipts";
  const publicUrl  = (Deno.env.get("R2_PUBLIC_URL") || "").replace(/\/+$/, "");
  const endpoint   = `https://${accountId}.r2.cloudflarestorage.com`;
  return { accountId, accessKey, secretKey, bucket, publicUrl, endpoint };
}

/** Upload buffer ke R2, return public URL */
export async function r2Upload(
  fileName: string,
  body: Uint8Array,
  contentType = "image/jpeg",
): Promise<string> {
  const { accessKey, secretKey, bucket, publicUrl, endpoint } = getR2Config();

  const now = new Date();
  const dateStamp  = now.toISOString().slice(0, 10).replace(/-/g, ""); // YYYYMMDD
  const amzDate    = now.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z"; // YYYYMMDDTHHmmssZ
  const region     = "auto";
  const service    = "s3";
  const host       = new URL(endpoint).host;
  const path       = `/${bucket}/${fileName}`;

  const payloadHash = await sha256hex(body);

  const headers: Record<string, string> = {
    "host":                 host,
    "x-amz-date":          amzDate,
    "x-amz-content-sha256": payloadHash,
    "content-type":        contentType,
  };

  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers).sort().map(k => `${k}:${headers[k]}\n`).join("");

  const canonicalRequest = [
    "PUT",
    path,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256hex(encoder.encode(canonicalRequest)),
  ].join("\n");

  // Derive signing key
  const kDate    = await hmac(encoder.encode("AWS4" + secretKey), dateStamp);
  const kRegion  = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  const kSigning = await hmac(kService, "aws4_request");
  const signature = toHex(await hmac(kSigning, stringToSign));

  const authorization = [
    `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(", ");

  const resp = await fetch(`${endpoint}${path}`, {
    method: "PUT",
    headers: { ...headers, Authorization: authorization },
    body,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`R2 upload failed: ${resp.status} ${text}`);
  }

  return `${publicUrl}/${fileName}`;
}

/** Hapus file dari R2 */
export async function r2Delete(fileName: string): Promise<void> {
  const { accessKey, secretKey, bucket, endpoint } = getR2Config();

  const now = new Date();
  const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, "");
  const amzDate   = now.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const region    = "auto";
  const service   = "s3";
  const host      = new URL(endpoint).host;
  const path      = `/${bucket}/${fileName}`;

  const payloadHash = await sha256hex(encoder.encode(""));

  const headers: Record<string, string> = {
    "host":                  host,
    "x-amz-date":           amzDate,
    "x-amz-content-sha256": payloadHash,
  };

  const signedHeaders    = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers).sort().map(k => `${k}:${headers[k]}\n`).join("");

  const canonicalRequest = ["DELETE", path, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256hex(encoder.encode(canonicalRequest)),
  ].join("\n");

  const kDate    = await hmac(encoder.encode("AWS4" + secretKey), dateStamp);
  const kRegion  = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  const kSigning = await hmac(kService, "aws4_request");
  const signature = toHex(await hmac(kSigning, stringToSign));

  const authorization = [
    `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(", ");

  const resp = await fetch(`${endpoint}${path}`, {
    method: "DELETE",
    headers: { ...headers, Authorization: authorization },
  });

  if (!resp.ok && resp.status !== 404) {
    const text = await resp.text().catch(() => "");
    console.error(`R2 delete failed: ${resp.status} ${text}`);
  }
}

/** Extract filename dari R2 public URL */
export function r2FileNameFromUrl(url: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    return parts[parts.length - 1] || null;
  } catch {
    return null;
  }
}

/** GET file dari R2 via S3 API (untuk proxy) */
export async function r2Fetch(fileName: string): Promise<Response> {
  const { accessKey, secretKey, bucket, endpoint } = getR2Config();

  const now = new Date();
  const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, "");
  const amzDate   = now.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const region    = "auto";
  const service   = "s3";
  const host      = new URL(endpoint).host;
  const path      = `/${bucket}/${fileName}`;

  const payloadHash = await sha256hex(encoder.encode(""));

  const headers: Record<string, string> = {
    "host":                  host,
    "x-amz-date":           amzDate,
    "x-amz-content-sha256": payloadHash,
  };

  const signedHeaders    = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers).sort().map(k => `${k}:${headers[k]}\n`).join("");
  const canonicalRequest = ["GET", path, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256hex(encoder.encode(canonicalRequest)),
  ].join("\n");

  const kDate    = await hmac(encoder.encode("AWS4" + secretKey), dateStamp);
  const kRegion  = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  const kSigning = await hmac(kService, "aws4_request");
  const signature = toHex(await hmac(kSigning, stringToSign));

  const authorization = [
    `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(", ");

  return fetch(`${endpoint}${path}`, {
    method: "GET",
    headers: { ...headers, Authorization: authorization },
  });
}
