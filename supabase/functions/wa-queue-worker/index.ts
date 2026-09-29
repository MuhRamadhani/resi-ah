import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendMentions } from "../_shared/evolution.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
};

serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data: jobs } = await supabase
    .from("wa_send_queue")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (!jobs?.length) {
    return new Response(
      JSON.stringify({ success: true, empty: true }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }

  for (const job of jobs ?? []) {
    try {
      await sendMentions(
        job.target,
        job.text,
        job.mentions || []
      );

      console.log("SEND SUCCESS", job.id);

      await supabase
        .from("wa_send_queue")
        .delete()
        .eq("id", job.id);

      await new Promise(resolve =>
        setTimeout(resolve, 6000)
      );

    } catch (e) {
      console.error("SEND FAILED", job.id, e);

      await supabase
        .from("wa_send_queue")
        .update({
          retry_count: (job.retry_count || 0) + 1,
          error_message: String(e)
        })
        .eq("id", job.id);
    }
  }

  return new Response(
    JSON.stringify({
      success: true,
      processed: jobs?.length || 0
    }),
    {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    }
  );
});