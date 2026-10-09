/**
 * r2-image: Proxy endpoint untuk serve gambar dari R2
 * GET /functions/v1/r2-image?file=filename.jpg
 * Auth: anon key (dari frontend)
 */
import { r2Fetch } from "../_shared/r2.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  const file = url.searchParams.get("file");
  if (!file) {
    return new Response("Missing file param", { status: 400, headers: corsHeaders });
  }

  try {
    const resp = await r2Fetch(file);
    if (!resp.ok) {
      return new Response("Not found", { status: 404, headers: corsHeaders });
    }

    const contentType = resp.headers.get("content-type") || "image/jpeg";
    const body = await resp.arrayBuffer();

    return new Response(body, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (e) {
    console.error("[r2-image]", e);
    return new Response("Error", { status: 500, headers: corsHeaders });
  }
});
