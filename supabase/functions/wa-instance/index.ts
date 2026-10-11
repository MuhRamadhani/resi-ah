/**
 * wa-instance — Proxy ke WasenderAPI untuk status session.
 *
 * Actions (body._action):
 *   "state"          → GET /api/whatsapp-sessions (ambil status session aktif)
 *   "fetchInstances" → GET /api/whatsapp-sessions (list semua sessions)
 *   "connect" / "restart" / "logout" / "delete" / "create"
 *       → Tidak tersedia via API — kelola melalui WasenderAPI dashboard
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BASE_URL = "https://www.wasenderapi.com";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const WASENDER_API_KEY = Deno.env.get("WASENDER_API_KEY") || "";

  if (!WASENDER_API_KEY) {
    return new Response(JSON.stringify({ error: "WASENDER_API_KEY not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const body   = await req.json().catch(() => ({}));
  const action = body._action || "state";

  // Actions yang butuh manajemen manual via dashboard WasenderAPI
  const dashboardOnly = new Set(["connect", "restart", "logout", "delete", "create"]);
  if (dashboardOnly.has(action)) {
    return new Response(JSON.stringify({
      evolutionStatus: 200,
      data: {
        message: `Action "${action}" tidak tersedia via API WasenderAPI. Kelola session melalui dashboard: https://www.wasenderapi.com`,
        dashboardUrl: "https://www.wasenderapi.com",
      },
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // "state" dan "fetchInstances" → GET /api/whatsapp-sessions
  if (action === "state" || action === "fetchInstances") {
    try {
      const res = await fetch(`${BASE_URL}/api/whatsapp-sessions`, {
        headers: {
          "Authorization": `Bearer ${WASENDER_API_KEY}`,
          "Content-Type": "application/json",
        },
      });
      const text = await res.text();
      let data: unknown;
      try { data = JSON.parse(text); } catch { data = { raw: text }; }

      // Normalisasi agar frontend kompatibel:
      // Evolution mengembalikan { state: "open" } untuk action=state
      // Wasender mengembalikan array sessions
      let normalized = data;
      if (action === "state" && Array.isArray((data as any)?.data)) {
        const sessions: any[] = (data as any).data;
        const first = sessions[0];
        normalized = {
          state: first?.status === "connected" ? "open" : (first?.status || "close"),
          sessions,
          raw: data,
        };
      }

      return new Response(
        JSON.stringify({ evolutionStatus: res.status, data: normalized }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    } catch (e) {
      console.error("[wa-instance] fetch error:", e);
      return new Response(
        JSON.stringify({ evolutionStatus: 500, error: e instanceof Error ? e.message : "unknown" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
  }

  return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
    status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
