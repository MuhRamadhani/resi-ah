import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { wasenderRequest, getApiKey } from "../_shared/wasender.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/**
 * Upload gambar ke Wasender → dapat publicUrl yang hidup 24 jam.
 * Dipakai supaya gambar TIDAK perlu disimpan di R2/Supabase Storage sama
 * sekali. Wasender yang hapus sendiri setelah 24 jam, jadi tidak ada file
 * nyangkut dan tidak ada job cleanup baru.
 *
 * Endpoint: POST /api/upload (raw binary, Content-Type = mime asli)
 * Response: { success: true, publicUrl: "https://..." }
 */
async function uploadToWasender(bytes: Uint8Array, mime: string): Promise<string | null> {
  const res = await fetch("https://www.wasenderapi.com/api/upload", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${getApiKey()}`,
      "Content-Type": mime,
    },
    body: bytes,
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = await res.text().catch(() => null);
  }
  if (!res.ok || !data?.publicUrl) {
    const brief = typeof data === "string"
      ? data.slice(0, 200)
      : String(data?.message || data?.error || "").slice(0, 200);
    console.error(`[send-payment-image] upload gagal -> ${res.status} ${brief}`);
    return null;
  }
  return data.publicUrl as string;
}

/** 08xxx / 62xxx / JID → digits internasional 62xxx (tanpa + dan tanpa @...) */
function toIntl(raw: string): string {
  const d = (raw || "").split("@")[0].replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("62")) return d;
  if (d.startsWith("0")) return "62" + d.slice(1);
  return d;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { entry_id, image_base64, mime } = await req.json();
    if (!entry_id) return json({ error: "entry_id required" }, 400);
    if (!image_base64) return json({ error: "image_base64 required" }, 400);

    const { data: entry, error: fetchErr } = await supabase
      .from("payment_entries")
      .select("id, group_id, tag_phone, tag_jid, key_json, message_json")
      .eq("id", entry_id)
      .maybeSingle();

    if (fetchErr || !entry) return json({ error: "Entry not found" }, 404);
    if (!entry.group_id) return json({ error: "Entry tidak punya group_id" }, 400);

    // Decode base64 → bytes. Terima dengan atau tanpa prefix data URL.
    const comma = String(image_base64).indexOf(",");
    const b64 = comma >= 0 ? String(image_base64).slice(comma + 1) : String(image_base64);
    let bytes: Uint8Array;
    try {
      const bin = atob(b64);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } catch {
      return json({ error: "image_base64 tidak valid" }, 400);
    }
    if (bytes.length === 0) return json({ error: "Gambar kosong" }, 400);

    const contentType = typeof mime === "string" && mime.startsWith("image/")
      ? mime
      : "image/jpeg";

    const publicUrl = await uploadToWasender(bytes, contentType);
    if (!publicUrl) return json({ error: "Gagal upload gambar ke Wasender" }, 502);

    // Tag member yang dibayar. Sama seperti approve-payment: nomor ditulis
    // di teks sebagai @62xxx supaya tampil sebagai mention di WA, dan JID-nya
    // dikirim di array mentions supaya notifikasinya benar-benar masuk.
    const memberIntl = toIntl(entry.tag_phone || entry.tag_jid || "");
    const mentions: string[] = memberIntl ? [`${memberIntl}@s.whatsapp.net`] : [];
    const tag = memberIntl ? `@${memberIntl} ` : "";
    const caption = `Selamat ya kakak ${tag}ditunggu next kloter 💸`;

    const payload: Record<string, unknown> = {
      to: entry.group_id,
      text: caption,       // untuk pesan bergambar, "text" berfungsi sebagai caption
      imageUrl: publicUrl,
      ...(mentions.length > 0 ? { mentions } : {}),
    };

    // Reply ke pesan payment aslinya — pola sama dengan approve-payment,
    // supaya tampil mengutip pesan payment seperti di WA.
    if (entry.key_json) {
      payload.replyToObject = {
        key: entry.key_json,
        message: entry.message_json || entry.key_json,
      };
    }

    const result = await wasenderRequest("/api/send-message", "POST", payload);
    if (!result.ok) {
      return json({ error: "Gagal kirim gambar", detail: result.data }, 502);
    }

    // Tandai terkirim hanya setelah pesan benar-benar masuk ke group.
    // Error UPDATE WAJIB dicek: kalau kolom image_sent_at belum ada, gambar
    // tetap terkirim tapi status tidak tersimpan. Tanpa cek ini kegagalannya
    // lolos diam-diam dan badge balik ke "No Img" setiap refresh.
    const imageSentAt = new Date().toISOString();
    const { error: updErr } = await supabase
      .from("payment_entries")
      .update({ image_sent_at: imageSentAt })
      .eq("id", entry_id);

    if (updErr) {
      console.error(`[send-payment-image] gambar terkirim tapi gagal simpan status: ${updErr.message}`);
      return json({
        success: true,
        image_sent_at: null,
        mentioned: memberIntl || null,
        warning: `Gambar terkirim, tapi status gagal disimpan: ${updErr.message}`,
      });
    }

    return json({ success: true, image_sent_at: imageSentAt, mentioned: memberIntl || null });
  } catch (e) {
    console.error("send-payment-image error:", e);
    return json({ error: String(e) }, 500);
  }
});
