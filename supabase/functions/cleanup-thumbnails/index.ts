// Cleanup script: Delete all orphaned thumbnails (files ending with _thumb.jpg)
// Run once after Option B deployment

import { createClient } from "jsr:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log("[CLEANUP-THUMBS] Fetching all files from Storage...");

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

    console.log(`[CLEANUP-THUMBS] Found ${files.length} total files`);

    // Find all thumbnail files
    const thumbnailFiles = files
      .filter(f => f.name.endsWith('_thumb.jpg'))
      .map(f => f.name);

    console.log(`[CLEANUP-THUMBS] Found ${thumbnailFiles.length} thumbnail files to delete`);

    if (thumbnailFiles.length === 0) {
      return new Response(JSON.stringify({
        message: "No thumbnails found. Already clean!",
        deleted: 0
      }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // Delete thumbnails in batches of 100
    let deletedCount = 0;
    for (let i = 0; i < thumbnailFiles.length; i += 100) {
      const batch = thumbnailFiles.slice(i, i + 100);
      const { error: deleteError } = await supabase.storage
        .from("receipts")
        .remove(batch);
      
      if (deleteError) {
        console.warn(`[CLEANUP-THUMBS] Delete error (batch ${i}-${i + 100}):`, deleteError.message);
        // Continue anyway
      } else {
        deletedCount += batch.length;
        console.log(`[CLEANUP-THUMBS] Deleted batch ${i}-${i + 100}: ${batch.length} thumbnails`);
      }
    }

    console.log(`[CLEANUP-THUMBS] Success! Deleted ${deletedCount} thumbnail files`);

    return new Response(JSON.stringify({
      success: true,
      total_files: files.length,
      thumbnail_files_found: thumbnailFiles.length,
      deleted: deletedCount,
      remaining_files: files.length - deletedCount
    }), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (e) {
    console.error("[CLEANUP-THUMBS] Error:", e);
    return new Response(JSON.stringify({ error: String(e) }), { 
      status: 500,
      headers: { "Content-Type": "application/json" } 
    });
  }
});
