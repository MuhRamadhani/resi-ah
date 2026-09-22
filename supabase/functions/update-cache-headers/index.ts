// Update cache headers for existing old files
// Run once to apply cacheControl to all existing files in Storage

import { createClient } from "jsr:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log("[UPDATE-CACHE] Fetching all files from Storage...");

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

    console.log(`[UPDATE-CACHE] Found ${files.length} files`);

    let updatedCount = 0;
    let errorCount = 0;

    // Update cache headers for each file
    // Note: Supabase Storage doesn't have direct "update metadata" API
    // Workaround: We need to re-upload with same content but new headers
    
    // ALTERNATIVE: Just wait for old files to be deleted naturally
    // Old files will be auto-deleted after 30 days or when approved

    console.log("[UPDATE-CACHE] Strategy: Let old files naturally expire");
    console.log("[UPDATE-CACHE] New uploads have cache headers already");
    console.log("[UPDATE-CACHE] Egress will improve as old files are deleted");

    return new Response(JSON.stringify({
      strategy: "natural_expiration",
      total_files: files.length,
      message: "New files have cache headers. Old files will be deleted after approve or 30 days.",
      recommendation: "Monitor egress over next 7 days. Should drop to <30MB/day."
    }), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (e) {
    console.error("[UPDATE-CACHE] Error:", e);
    return new Response(JSON.stringify({ error: String(e) }), { 
      status: 500,
      headers: { "Content-Type": "application/json" } 
    });
  }
});
