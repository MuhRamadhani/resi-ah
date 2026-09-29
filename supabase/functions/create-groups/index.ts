import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createGroup, promoteParticipants } from "../_shared/evolution.ts";
// Evolution createGroup expects (name, participants[])

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface GroupSpec {
  subject: string;
  participants: string[];
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  try {
    // Auth: must be admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: claims } = await supabase.auth.getClaims(authHeader.replace("Bearer ", ""));
    if (!claims?.claims?.sub) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", claims.claims.sub)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleRow) {
      return new Response(JSON.stringify({ error: "Forbidden: admin only" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const groups: GroupSpec[] = body.groups || [];

    const results: any[] = [];
    for (const g of groups) {
      const subject = (g.subject || "").trim();
      const participants = (g.participants || [])
        .map((p) => p.replace(/[^0-9]/g, ""))
        .map((p) => p.startsWith("0") ? "62" + p.slice(1) : p)
        .filter((p) => p.length >= 8);

      if (!subject || participants.length === 0) {
        results.push({ subject, ok: false, error: "subject/participants kosong" });
        continue;
      }

      const r = await createGroup(subject, participants);

      // Try to promote all participants to admin after group is created
      let promoteResult: any = null;
      if (r.ok) {
        const groupJid =
          r.data?.data?.id || r.data?.data?.jid ||
          r.data?.id || r.data?.jid || r.data?.group?.id || "";
        if (groupJid) {
          await new Promise((res) => setTimeout(res, 800));
          const pr = await promoteParticipants(groupJid, participants);
          promoteResult = { ok: pr.ok, status: pr.status };
        }
      }

      results.push({
        subject,
        participantCount: participants.length,
        ok: r.ok,
        status: r.status,
        data: r.data,
        promoted: promoteResult,
      });
      // small delay between calls
      await new Promise((res) => setTimeout(res, 800));
    }

    return new Response(JSON.stringify({ success: true, results }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("create-groups error:", e);
    return new Response(JSON.stringify({ success: false, error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
