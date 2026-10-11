/**
 * Utility untuk delete file dari Cloudflare R2 via Edge Function proxy.
 * Frontend tidak bisa langsung hit R2 (credentials harus di server),
 * jadi kita pakai Supabase Edge Function sebagai proxy delete.
 *
 * Alternatif lebih simple: R2 URL berbeda dari Supabase Storage URL.
 * Kita extract filename dari URL lalu panggil delete via fetch ke edge function.
 */

import { supabase } from "@/integrations/supabase/client";

const R2_PUBLIC_HOST = "r2.dev"; // pub-xxx.r2.dev
const SUPABASE_STORAGE_HOST = "supabase.co"; // *.supabase.co/storage/...

/** Apakah URL ini dari R2 (bukan Supabase Storage)? */
export function isR2Url(url: string): boolean {
  if (!url) return false;
  return url.includes(R2_PUBLIC_HOST) || url.includes("r2.cloudflarestorage.com");
}

/** Apakah URL ini dari Supabase Storage (public, bisa diakses langsung)? */
function isSupabaseStorageUrl(url: string): boolean {
  if (!url) return false;
  return url.includes(SUPABASE_STORAGE_HOST) && url.includes("/storage/v1/object/public/");
}

/** Extract filename dari URL (R2 atau Supabase Storage) */
export function extractFileName(url: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (isSupabaseStorageUrl(url)) {
      // https://xxx.supabase.co/storage/v1/object/public/receipts/filename.jpg
      const parts = u.pathname.split("/storage/v1/object/public/receipts/");
      return parts[1] || null;
    }
    // R2 URL atau URL lain: ambil bagian terakhir path sebagai filename
    // https://pub-xxx.r2.dev/filename.jpg  OR  https://custom-domain.com/filename.jpg
    return u.pathname.replace(/^\/+/, "").split("/").pop() || null;
  } catch {
    return null;
  }
}

/**
 * Konversi URL gambar ke URL yang bisa diakses browser.
 * - Supabase Storage URL → langsung (sudah public)
 * - Semua URL lain (R2, custom domain, dll) → proxy via r2-image edge function
 */
export function getImageProxyUrl(url: string): string {
  if (!url) return "";
  // Supabase Storage sudah public — bisa langsung
  if (isSupabaseStorageUrl(url)) return url;
  // Semua URL lain (R2 pub domain, custom domain, dll) → route via proxy
  const fileName = extractFileName(url);
  if (!fileName) return url;
  const SUPABASE_URL = (supabase as any).supabaseUrl as string;
  return `${SUPABASE_URL}/functions/v1/r2-image?file=${encodeURIComponent(fileName)}`;
}

/** 
 * Hapus satu atau lebih file gambar resi.
 * - R2: panggil edge function delete-r2-file
 * - Supabase Storage: panggil supabase.storage.remove() langsung
 */
export async function deleteReceiptFiles(imageUrls: string[]): Promise<void> {
  const urls = imageUrls.filter(Boolean);
  if (urls.length === 0) return;

  const r2Urls = urls.filter(isR2Url);
  const supabaseUrls = urls.filter(u => !isR2Url(u));

  // Delete dari R2 via edge function
  if (r2Urls.length > 0) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const SUPABASE_URL = (supabase as any).supabaseUrl as string;
      await fetch(`${SUPABASE_URL}/functions/v1/delete-r2-file`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ urls: r2Urls }),
      });
    } catch (e) {
      console.error("[R2 Delete]", e);
    }
  }

  // Delete dari Supabase Storage (file lama sebelum migrasi)
  if (supabaseUrls.length > 0) {
    const fileNames = supabaseUrls
      .map(extractFileName)
      .filter((f): f is string => !!f);
    if (fileNames.length > 0) {
      // Chunk per 100
      for (let i = 0; i < fileNames.length; i += 100) {
        await supabase.storage.from("receipts").remove(fileNames.slice(i, i + 100));
      }
    }
  }
}
