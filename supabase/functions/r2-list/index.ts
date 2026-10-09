/**
 * r2-list: List semua file di R2 bucket
 * GET  /functions/v1/r2-list        → { files: [{ name, size, lastModified }] }
 * DELETE /functions/v1/r2-list      → { deleted: N } (body: { names: string[] })
 */
import { r2Delete } from "../_shared/r2.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, DELETE, OPTIONS",
};

const encoder = new TextEncoder();

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, encoder.encode(data));
}
async function sha256hex(data: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(data));
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}
function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function getR2Config() {
  const accountId = Deno.env.get("R2_ACCOUNT_ID")!;
  const accessKey = Deno.env.get("R2_ACCESS_KEY")!;
  const secretKey = Deno.env.get("R2_SECRET_KEY")!;
  const bucket    = Deno.env.get("R2_BUCKET") || "receipts";
  const endpoint  = `https://${accountId}.r2.cloudflarestorage.com`;
  return { accountId, accessKey, secretKey, bucket, endpoint };
}

async function r2ListObjects(continuationToken?: string): Promise<{ files: any[]; nextToken?: string }> {
  const { accessKey, secretKey, bucket, endpoint } = getR2Config();

  const now = new Date();
  const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, "");
  const amzDate   = now.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const region    = "auto";
  const service   = "s3";
  const host      = new URL(endpoint).host;

  let query = "list-type=2&max-keys=1000";
  if (continuationToken) query += `&continuation-token=${encodeURIComponent(continuationToken)}`;

  const payloadHash = await sha256hex("");
  const headers: Record<string, string> = {
    "host":                  host,
    "x-amz-date":           amzDate,
    "x-amz-content-sha256": payloadHash,
  };

  const signedHeaders    = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers).sort().map(k => `${k}:${headers[k]}\n`).join("");
  const canonicalRequest = ["GET", `/${bucket}`, query, canonicalHeaders, signedHeaders, payloadHash].join("\n");

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, await sha256hex(canonicalRequest)].join("\n");

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

  const resp = await fetch(`${endpoint}/${bucket}?${query}`, {
    headers: { ...headers, Authorization: authorization },
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`R2 list failed: ${resp.status} ${text}`);
  }

  const xml = await resp.text();

  // Parse XML sederhana
  const files: any[] = [];
  const contentRe = /<Contents>([\s\S]*?)<\/Contents>/g;
  let match;
  while ((match = contentRe.exec(xml)) !== null) {
    const block = match[1];
    const key  = block.match(/<Key>(.*?)<\/Key>/)?.[1] || "";
    const size = parseInt(block.match(/<Size>(.*?)<\/Size>/)?.[1] || "0");
    const last = block.match(/<LastModified>(.*?)<\/LastModified>/)?.[1] || "";
    files.push({ name: key, size, lastModified: last });
  }

  const nextToken = xml.match(/<NextContinuationToken>(.*?)<\/NextContinuationToken>/)?.[1];
  return { files, nextToken };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (req.method === "GET") {
      // List semua file di R2
      const allFiles: any[] = [];
      let token: string | undefined;
      do {
        const { files, nextToken } = await r2ListObjects(token);
        allFiles.push(...files);
        token = nextToken;
      } while (token);

      return new Response(JSON.stringify({ files: allFiles, total: allFiles.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (req.method === "DELETE") {
      // Hapus list file by name
      const { names } = await req.json() as { names: string[] };
      if (!Array.isArray(names) || names.length === 0) {
        return new Response(JSON.stringify({ deleted: 0 }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      let deleted = 0;
      for (const name of names) {
        try {
          await r2Delete(name);
          deleted++;
        } catch (e) {
          console.error(`[r2-list] delete ${name}:`, e);
        }
      }
      return new Response(JSON.stringify({ deleted }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  } catch (e) {
    console.error("[r2-list]", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
