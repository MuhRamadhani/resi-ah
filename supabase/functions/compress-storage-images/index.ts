// Batch compress existing storage images to reduce egress
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function compressImage(imageBuffer: Uint8Array): Promise<Uint8Array> {
  try {
    const image = await Image.decode(imageBuffer);
    
    // Resize jika lebar lebih dari 1024px
    const maxWidth = 1024;
    if (image.width > maxWidth) {
      const ratio = maxWidth / image.width;
      const newHeight = Math.floor(image.height * ratio);
      image.resize(maxWidth, newHeight);
    }
    
    // Encode ke JPEG dengan quality 80%
    const compressed = await image.encodeJPEG(80);
    return compressed;
  } catch (e) {
    console.error("[COMPRESS] Error:", e);
    return imageBuffer; // fallback to original
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { limit = 50, offset = 0 } = await req.json();

    console.log(`[COMPRESS] Processing batch: offset=${offset}, limit=${limit}`);

    // List files from storage
    const { data: files, error: listErr } = await supabase.storage
      .from("receipts")
      .list("", {
        limit,
        offset,
        sortBy: { column: "created_at", order: "desc" },
      });

    if (listErr) throw listErr;

    const actualFiles = files.filter((f: any) => f.name && !f.name.endsWith("/"));
    console.log(`[COMPRESS] Found ${actualFiles.length} files to process`);

    const results = [];

    for (const file of actualFiles) {
      try {
        // Download original
        const { data: downloadData, error: downloadErr } = await supabase.storage
          .from("receipts")
          .download(file.name);

        if (downloadErr) {
          console.error(`[COMPRESS] Download failed: ${file.name}`, downloadErr);
          results.push({ file: file.name, status: "download_failed", error: downloadErr.message });
          continue;
        }

        const originalBuffer = new Uint8Array(await downloadData.arrayBuffer());
        const originalSize = originalBuffer.length;

        // Skip if already small (< 100KB)
        if (originalSize < 100 * 1024) {
          console.log(`[COMPRESS] Skip ${file.name}: already small (${(originalSize / 1024).toFixed(2)}KB)`);
          results.push({ file: file.name, status: "skipped_small", size_kb: (originalSize / 1024).toFixed(2) });
          continue;
        }

        // Compress
        const compressedBuffer = await compressImage(originalBuffer);
        const compressedSize = compressedBuffer.length;
        const reduction = ((originalSize - compressedSize) / originalSize * 100).toFixed(1);

        // Skip if compression didn't help much (< 20% reduction)
        if (compressedSize >= originalSize * 0.8) {
          console.log(`[COMPRESS] Skip ${file.name}: low compression (${reduction}%)`);
          results.push({ file: file.name, status: "skipped_low_compression", reduction });
          continue;
        }

        // Upload compressed version (overwrite)
        const { error: uploadErr } = await supabase.storage
          .from("receipts")
          .upload(file.name, compressedBuffer, {
            contentType: "image/jpeg",
            upsert: true, // overwrite
          });

        if (uploadErr) {
          console.error(`[COMPRESS] Upload failed: ${file.name}`, uploadErr);
          results.push({ file: file.name, status: "upload_failed", error: uploadErr.message });
          continue;
        }

        console.log(`[COMPRESS] Success: ${file.name} - ${(originalSize / 1024).toFixed(2)}KB → ${(compressedSize / 1024).toFixed(2)}KB (${reduction}% reduction)`);
        results.push({
          file: file.name,
          status: "compressed",
          original_kb: (originalSize / 1024).toFixed(2),
          compressed_kb: (compressedSize / 1024).toFixed(2),
          reduction: `${reduction}%`,
        });
      } catch (err: any) {
        console.error(`[COMPRESS] Error processing ${file.name}:`, err);
        results.push({ file: file.name, status: "error", error: err.message });
      }
    }

    const summary = {
      processed: actualFiles.length,
      compressed: results.filter(r => r.status === "compressed").length,
      skipped: results.filter(r => r.status.startsWith("skipped")).length,
      failed: results.filter(r => r.status.includes("failed") || r.status === "error").length,
    };

    return new Response(
      JSON.stringify({ success: true, summary, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("[COMPRESS] Fatal error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
