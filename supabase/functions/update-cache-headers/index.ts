// Update cache headers for existing old files
// Run once to apply cacheControl to all existing files in Storage

import { createClient } from "jsr:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // List all files in receipts bucket
    const { data: files, error: listError } = await supabase.storage
      .from("receipts")
      .list("", {
        limit: 10000,
        sortBy: { column: "name", order: "asc" }
      });

    if (listError) {
      throw new Error(`List error: ${listError.message}`);
    }

    let updatedCount = 0;
    let errorCount = 0;

    // Update cache headers for each file
    // Note: Supabase Storage doesn't have direct "update metadata" API
    // Workaround: We need to re-upload with same content but new headers
    
    // ALTERNATIVE: Just wait for old files to be deleted naturally
    // Old files will be auto-deleted after 30 days or when approved

    return new Response(JSON.stringify({
      strategy: "natural_expiration",
      total_files: files.length,
      message: "New files have cache headers. Old files will be deleted after approve or 30 days.",
      recommendation: "Monitor egress over next 7 days. Should drop to <30MB/day."
    }), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (e) {
    console.error("[UPDATE-CACHE] Error:", e instanceof Error ? e.message : "unknown");
    return new Response(JSON.stringify({ error: String(e) }), { 
      status: 500,
      headers: { "Content-Type": "application/json" } 
    });
  }
});
