// Cleanup: Delete images for Approved receipts (one-time migration)
// Deploy: npx supabase functions deploy cleanup-approved-images
// Run: curl -X POST https://ytsvvbbsrnoxwlsbaoja.supabase.co/functions/v1/cleanup-approved-images

import { createClient } from "jsr:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log("[CLEANUP] Starting cleanup of Approved receipt images...");

    // Get all Approved receipts with image_url
    const { data: receipts, error: fetchError } = await supabase
      .from("receipts")
      .select("id, image_url")
      .eq("status", "Approved")
      .not("image_url", "is", null)
      .neq("image_url", "");

    if (fetchError) {
      console.error("[CLEANUP] Fetch error:", fetchError);
      return new Response(JSON.stringify({ error: fetchError.message }), { status: 500 });
    }

    if (!receipts || receipts.length === 0) {
      console.log("[CLEANUP] No Approved receipts with images found. Already clean!");
      return new Response(JSON.stringify({ 
        message: "No cleanup needed", 
        deleted: 0 
      }), { 
        headers: { "Content-Type": "application/json" } 
      });
    }

    console.log(`[CLEANUP] Found ${receipts.length} Approved receipts with images`);

    // Extract filenames
    const filesToDelete: string[] = [];
    const receiptIds: string[] = [];

    for (const receipt of receipts) {
      const match = receipt.image_url.match(/\/receipts\/(.+)$/);
      if (match) {
        const originalFile = match[1];
        const thumbFile = originalFile.replace('.jpg', '_thumb.jpg');
        
        filesToDelete.push(originalFile);
        filesToDelete.push(thumbFile);
        receiptIds.push(receipt.id);
        
        console.log(`[CLEANUP] Will delete: ${originalFile} + ${thumbFile}`);
      }
    }

    console.log(`[CLEANUP] Total files to delete: ${filesToDelete.length}`);

    // Delete files from storage (batch of 100)
    let deletedCount = 0;
    for (let i = 0; i < filesToDelete.length; i += 100) {
      const batch = filesToDelete.slice(i, i + 100);
      const { error: deleteError } = await supabase.storage
        .from("receipts")
        .remove(batch);
      
      if (deleteError) {
        console.warn(`[CLEANUP] Delete error (batch ${i}-${i + 100}):`, deleteError.message);
        // Continue anyway - file might already be deleted
      } else {
        deletedCount += batch.length;
        console.log(`[CLEANUP] Deleted batch ${i}-${i + 100}: ${batch.length} files`);
      }
    }

    // Update database: set image_url to empty
    const { error: updateError } = await supabase
      .from("receipts")
      .update({ image_url: "" })
      .in("id", receiptIds);

    if (updateError) {
      console.error("[CLEANUP] Update error:", updateError);
      return new Response(JSON.stringify({ 
        error: updateError.message,
        deleted: deletedCount 
      }), { 
        status: 500,
        headers: { "Content-Type": "application/json" } 
      });
    }

    console.log(`[CLEANUP] Success! Deleted ${deletedCount} files, updated ${receiptIds.length} receipts`);

    return new Response(JSON.stringify({
      success: true,
      deleted_files: deletedCount,
      updated_receipts: receiptIds.length,
      receipts: receiptIds
    }), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (e) {
    console.error("[CLEANUP] Error:", e);
    return new Response(JSON.stringify({ error: String(e) }), { 
      status: 500,
      headers: { "Content-Type": "application/json" } 
    });
  }
});
