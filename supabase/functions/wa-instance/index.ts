/**
 * wa-instance — Proxy ke Evolution API untuk manage instance.
 *
 * Actions (body._action):
 *   "state"           → GET    /instance/connectionState/{instance}
 *   "connect"         → GET    /instance/connect/{instance}
 *   "restart"         → POST   /instance/restart/{instance}
 *   "logout"          → DELETE /instance/logout/{instance}
 *   "delete"          → DELETE /instance/delete/{instance}
 *   "fetchInstances"  → GET    /instance/fetchInstances
 *   "create"          → POST   /instance/create
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
  const targetInstance = (body.instanceName || INSTANCE || "").trim();

  type RouteConfig = { method: string; endpoint: string; bodyPayload?: unknown };

  let route: RouteConfig;

  switch (action) {
    case "state":
      route = { method: "GET", endpoint: `/instance/connectionState/${targetInstance}` };
      break;
    case "connect":
      route = { method: "GET", endpoint: `/instance/connect/${targetInstance}` };
      break;
    case "restart":
      route = { method: "POST", endpoint: `/instance/restart/${targetInstance}` };
      break;
    case "logout":
      route = { method: "DELETE", endpoint: `/instance/logout/${targetInstance}`, bodyPayload: {} };
      break;
    case "delete":
      route = { method: "DELETE", endpoint: `/instance/delete/${targetInstance}`, bodyPayload: {} };
      break;
    case "fetchInstances":
      route = { method: "GET", endpoint: "/instance/fetchInstances" };
      break;
    case "create":
      route = { method: "POST", endpoint: "/instance/create", bodyPayload: body.payload };
      break;
    default:
      return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
  }

  try {
    const fetchOpts: RequestInit = {
      method: route.method,
      headers: { apikey: EVOLUTION_API_KEY, "Content-Type": "application/json" },
    };
    if (route.bodyPayload !== undefined) {
      fetchOpts.body = JSON.stringify(route.bodyPayload);
    }

    const url = `${EVOLUTION_BASE_URL}${route.endpoint}`;
    console.log(`[wa-instance] ${route.method} ${url}`);

    const res = await fetch(url, fetchOpts);
    const text = await res.text();

    console.log(`[wa-instance] status=${res.status} body=${text.slice(0, 500)}`);

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    // Selalu return 200 agar Supabase invoke tidak throw
    return new Response(
      JSON.stringify({ evolutionStatus: res.status, data }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error(`[wa-instance] fetch error:`, e);
    return new Response(
      JSON.stringify({ evolutionStatus: 500, error: e instanceof Error ? e.message : "unknown" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
