// Edge Function: wa-instance
// body: { _action: "state" }   → GET  /instance/connectionState/{instance}
// body: { _action: "connect" } → GET  /instance/connect/{instance}
// body: { _action: "restart" } → POST /instance/restart/{instance}
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const EVOLUTION_BASE_URL = (Deno.env.get("EVOLUTION_BASE_URL") || "").replace(/\/+$/, "");
  const EVOLUTION_API_KEY  = Deno.env.get("EVOLUTION_API_KEY") || "";
  const INSTANCE           = Deno.env.get("EVOLUTION_INSTANCE_NAME") || "";

  if (!EVOLUTION_BASE_URL || !EVOLUTION_API_KEY || !INSTANCE) {
    return new Response(JSON.stringify({ error: "Evolution env vars not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const body   = await req.json().catch(() => ({}));
  const action = body._action || "state";

  // restart → POST, sisanya → GET
  const isPost = action === "restart";
  const endpoint = action === "restart"
    ? `/instance/restart/${INSTANCE}`
    : action === "connect"
    ? `/instance/connect/${INSTANCE}`
    : `/instance/connectionState/${INSTANCE}`;

  try {
    const res  = await fetch(`${EVOLUTION_BASE_URL}${endpoint}`, {
      method: isPost ? "POST" : "GET",
      headers: { apikey: EVOLUTION_API_KEY, "Content-Type": "application/json" },
    });
    const data = await res.json().catch(() => ({}));
    return new Response(JSON.stringify(data), {
      status: res.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
