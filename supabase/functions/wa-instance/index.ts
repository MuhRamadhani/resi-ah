/**
 * wa-instance — Proxy ke Evolution API untuk manage instance.
 *
 * Actions (body._action):
 *   "state"           → GET  /instance/connectionState/{instance}
 *   "connect"         → GET  /instance/connect/{instance}
 *   "restart"         → POST /instance/restart/{instance}
 *   "logout"          → DELETE /instance/logout/{instance}
 *   "delete"          → DELETE /instance/delete/{instance}
 *   "fetchInstances"  → GET  /instance/fetchInstances
 *   "create"          → POST /instance/create  (body.payload = create payload)
 */
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

  if (!EVOLUTION_BASE_URL || !EVOLUTION_API_KEY) {
    return new Response(JSON.stringify({ error: "Evolution env vars not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const body   = await req.json().catch(() => ({}));
  const action = body._action || "state";

  // Target instance — default ke INSTANCE env, tapi bisa di-override via body.instanceName
  const targetInstance = body.instanceName || INSTANCE;

  type RouteConfig = { method: string; endpoint: string; bodyPayload?: unknown };

  const routes: Record<string, RouteConfig> = {
    state:          { method: "GET",    endpoint: `/instance/connectionState/${targetInstance}` },
    connect:        { method: "GET",    endpoint: `/instance/connect/${targetInstance}` },
    restart:        { method: "POST",   endpoint: `/instance/restart/${targetInstance}` },
    logout:         { method: "DELETE", endpoint: `/instance/logout/${targetInstance}` },
    delete:         { method: "DELETE", endpoint: `/instance/delete/${targetInstance}` },
    fetchInstances: { method: "GET",    endpoint: "/instance/fetchInstances" },
    create:         { method: "POST",   endpoint: "/instance/create", bodyPayload: body.payload },
  };

  const route = routes[action];
  if (!route) {
    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const fetchOpts: RequestInit = {
      method: route.method,
      headers: { apikey: EVOLUTION_API_KEY, "Content-Type": "application/json" },
    };
    if (route.bodyPayload) {
      fetchOpts.body = JSON.stringify(route.bodyPayload);
    }

    const res  = await fetch(`${EVOLUTION_BASE_URL}${route.endpoint}`, fetchOpts);
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
