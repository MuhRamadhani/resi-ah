/**
 * auto-ocr — Fire-and-forget OCR untuk resi yang baru masuk dari wa-webhook.
 *
 * Flow:
 *   1. Terima { receipt_id }
 *   2. Ambil receipt dari DB (image_url, status)
 *   3. Panggil ocr-receipt-ai dengan image_url
 *   4. Cek blocked list (blocked_identifiers)
 *   4b. Cek resi duplikat lintas hari (nomor_hp + nominal + jam_transfer sudah Approved kemarin)
 *       → Auto Reject + kirim notif ke member + tag admin di group
 *   5. Update receipt: nominal, jam_transfer, nama (dari OCR), status
 *      - Jika blocked → delete receipt (sama dengan perilaku AdminDashboard)
 *      - Jika OCR gagal → biarkan status "Pending", admin bisa OCR manual
 *   6. Trigger auto-match untuk tanggal transaksi
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { wasenderRequest, sendText, sendQuotedText } from "../_shared/wasender.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function formatRupiah(n: number): string {
  if (!n || isNaN(n)) return "Rp 0";
  return "Rp " + Math.round(n).toLocaleString("id-ID");
}

function intlDigits(s: string): string {
  let d = (s || "").replace(/[^0-9]/g, "");
  if (d.startsWith("0")) d = "62" + d.slice(1);
  return d;
}

/**
 * Kirim notifikasi auto-reject ke member.
 * Jika is_group → kirim ke group + mention admin juga.
 * notify_type: "reaction" → sendReaction, "message" → sendText+mention
 */
async function sendAutoRejectNotif(opts: {
  waMsg: any;
  nominal: number;
  notifyType: string;
  reaction: string;
  messageTemplate: string;
  adminPhone: string;
}): Promise<void> {
  const { waMsg, nominal, notifyType, reaction, messageTemplate, adminPhone } = opts;

  const nominalFmt = formatRupiah(nominal);
  const text = messageTemplate.replace(/\{nominal\}/g, nominalFmt);

  // Target: group JID atau personal JID
  const target = waMsg.is_group && waMsg.group_id
    ? waMsg.group_id
    : waMsg.remote_jid || `${intlDigits(waMsg.phone || "")}@s.whatsapp.net`;

  if (!target) return;

  const savedKey = waMsg.key_json
    ? (typeof waMsg.key_json === "string" ? JSON.parse(waMsg.key_json) : waMsg.key_json)
    : null;

  if (notifyType === "reaction" && savedKey && waMsg.wa_message_id) {
    // Kirim reaction ke pesan resi (Wasender format)
    await wasenderRequest("/api/messages/react", "POST", {
      jid:      savedKey?.remoteJid || target,
      msgId:    savedKey?.id || waMsg.wa_message_id,
      reaction,
    });

    // Jika di group dan ada admin phone → kirim juga mention teks ke group
    if (waMsg.is_group && adminPhone) {
      const adminPhn = intlDigits(adminPhone);
      const memberPhn = intlDigits(waMsg.phone || "");
      await wasenderRequest("/api/send-message", "POST", {
        to: target,
        type: "text",
        message: `@${adminPhn} — Ada resi duplikat masuk dari @${memberPhn}. Resi ${nominalFmt} sudah pernah di-Approve sebelumnya.`,
        mentions: [adminPhn, memberPhn].filter(Boolean),
      });
    }
  } else {
    // Kirim pesan teks (dengan reply quote kalau ada)
    const adminPhn = waMsg.is_group && adminPhone ? intlDigits(adminPhone) : "";
    const adminTag = adminPhn ? `\n\n📢 @${adminPhn}` : "";
    const fullText = text + adminTag;
    const mentions: string[] = adminPhn ? [adminPhn] : [];

    if (savedKey && waMsg.wa_message_id) {
      const quotedMsgId = savedKey?.id || waMsg.wa_message_id;
      // sendQuotedText tidak support mentions — kirim sebagai wasenderRequest langsung
      await wasenderRequest("/api/send-message", "POST", {
        to: target,
        type: "text",
        message: fullText,
        quotedMsgId,
        ...(mentions.length > 0 ? { mentions } : {}),
      });
    } else {
      if (mentions.length > 0) {
        await wasenderRequest("/api/send-message", "POST", {
          to: target,
          type: "text",
          message: fullText,
          mentions,
        });
      } else {
        await sendText(target, fullText);
      }
    }
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  try {
    const { receipt_id } = await req.json();
    if (!receipt_id) {
      return new Response(JSON.stringify({ error: "receipt_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Ambil receipt
    const { data: receipt, error: rErr } = await supabase
      .from("receipts")
      .select("id, image_url, status, nama, nomor_hp, keterangan")
      .eq("id", receipt_id)
      .single();

    if (rErr || !receipt) {
      return new Response(JSON.stringify({ error: "receipt not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!receipt.image_url) {
      return new Response(JSON.stringify({ error: "no image_url" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Panggil ocr-receipt-ai
    const ocrResp = await fetch(`${SUPABASE_URL}/functions/v1/ocr-receipt-ai`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_ROLE}`,
      },
      body: JSON.stringify({ image_url: receipt.image_url }),
    });

    if (!ocrResp.ok) {
      console.error("[auto-ocr] ocr-receipt-ai error", ocrResp.status);
      return new Response(JSON.stringify({ success: false, reason: "ocr_error" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ocr = await ocrResp.json();

    // OCR gagal parse — nominal atau jam null berarti gambar tidak terbaca
    if (ocr.error || ocr.nominal == null || ocr.jam == null) {
      await supabase.from("receipts").update({ ocr_status: "OCR_FAILED" }).eq("id", receipt_id);
      return new Response(JSON.stringify({ success: false, reason: "ocr_incomplete", ocr }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Cek blocked list
    const { data: blockedRows } = await supabase
      .from("blocked_identifiers")
      .select("type, value");

    const blockedNames: string[] = [];
    const blockedPhones: string[] = [];
    for (const row of blockedRows || []) {
      if (row.type === "name") blockedNames.push((row.value as string).toLowerCase());
      else if (row.type === "phone") blockedPhones.push(row.value as string);
    }

    // Teks gabungan untuk cek nama
    const checkText = [
      ocr.nama_penerima || "",
      ocr.keterangan || "",
      receipt.nama || "",
      receipt.keterangan || "",
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    const isNameBlocked = blockedNames.some((n) => n && checkText.includes(n));
    const isPhoneBlocked = blockedPhones.some(
      (p) =>
        (receipt.nomor_hp || "").replace(/[^0-9]/g, "").includes(p.replace(/[^0-9]/g, "")) ||
        p.replace(/[^0-9]/g, "").includes((receipt.nomor_hp || "").replace(/[^0-9]/g, "")),
    );

    if (isNameBlocked || isPhoneBlocked) {
      // Hapus gambar dari storage bucket dulu (sama seperti delete manual di AdminDashboard)
      if (receipt.image_url) {
        const marker = "/storage/v1/object/public/receipts/";
        const idx = receipt.image_url.indexOf(marker);
        if (idx !== -1) {
          const filePath = receipt.image_url.slice(idx + marker.length);
          await supabase.storage.from("receipts").remove([filePath]);
        }
      }
      // Hapus relasi receipt_wa_messages lalu receipt-nya
      await supabase.from("receipt_wa_messages").delete().eq("receipt_id", receipt_id);
      await supabase.from("receipts").delete().eq("id", receipt_id);
      return new Response(
        JSON.stringify({ success: true, action: "deleted_blocked" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 4b. Cek resi duplikat lintas hari
    // Kondisi: nomor_hp + nominal + jam_transfer sama, sudah Approved di hari sebelumnya
    // Guard: skip jika jam tidak valid (OCR gagal baca jam → tidak bisa diandalkan untuk cek duplikat)
    const jamValid = ocr.jam && ocr.jam !== "00:00:00" && ocr.jam !== "0" && ocr.jam.trim() !== "";

    const todayWIB = new Date(
      new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" }),
    ).toISOString().slice(0, 10);

    const prevApproved = jamValid ? (await supabase
      .from("receipts")
      .select("id, created_at, jam_transfer")
      .eq("nomor_hp", receipt.nomor_hp)
      .eq("nominal", ocr.nominal)
      .eq("jam_transfer", ocr.jam)    // jam harus sama persis
      .neq("jam_transfer", "00:00:00") // skip resi lama yang jam-nya invalid
      .eq("status", "Approved")
      .lt("created_at", `${todayWIB}T00:00:00+07:00`)
      .limit(1)).data : null;

    if (prevApproved && prevApproved.length > 0) {
      // Tandai Rejected
      await supabase.from("receipts").update({ status: "Rejected" }).eq("id", receipt_id);

      // Baca setting notifikasi auto-reject
      const { data: settings } = await supabase
        .from("notification_settings")
        .select("auto_reject_notify_type, auto_reject_reaction, auto_reject_message, auto_reject_admin_phone")
        .eq("id", "default")
        .single();

      const notifyType     = (settings as any)?.auto_reject_notify_type || "message";
      const reactionEmoji  = (settings as any)?.auto_reject_reaction    || "❌";
      const msgTemplate    = (settings as any)?.auto_reject_message      || "Resi {nominal} kamu ditolak otomatis karena resi ini sudah pernah digunakan sebelumnya.";
      const adminPhone     = (settings as any)?.auto_reject_admin_phone  || "";

      // Ambil WA message untuk reply/reaction
      const { data: waMessages } = await supabase
        .from("receipt_wa_messages")
        .select("id, receipt_id, wa_message_id, phone, group_id, is_group, remote_jid, participant, from_me, key_json")
        .eq("receipt_id", receipt_id);

      if (waMessages && waMessages.length > 0) {
        for (const waMsg of waMessages) {
          try {
            await sendAutoRejectNotif({
              waMsg,
              nominal: ocr.nominal,
              notifyType,
              reaction: reactionEmoji,
              messageTemplate: msgTemplate,
              adminPhone,
            });
          } catch (e) {
            console.error("[auto-ocr] sendAutoRejectNotif error:", e instanceof Error ? e.message : "unknown");
          }
        }
      }

      return new Response(
        JSON.stringify({ success: true, action: "auto_rejected_duplicate", receipt_id }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 4. Update receipt dengan hasil OCR
    const keteranganFull = [ocr.nama_penerima, ocr.keterangan]
      .filter(Boolean)
      .join(" · ") || receipt.keterangan || "";

    const updatePayload: Record<string, unknown> = {
      nominal: ocr.nominal,
      jam_transfer: ocr.jam,
      ocr_source: ocr.source || "9ROUTER",
      ocr_status: "OK",
    };
    if (ocr.confidence != null) {
      updatePayload.ocr_confidence = ocr.confidence;
    }
    if (ocr.keterangan || ocr.nama_penerima) {
      updatePayload.keterangan = keteranganFull || receipt.keterangan;
    }

    const { error: updErr } = await supabase
      .from("receipts")
      .update(updatePayload)
      .eq("id", receipt_id);

    if (updErr) {
      console.error("[auto-ocr] update receipt error:", updErr.message);
      return new Response(JSON.stringify({ success: false, reason: "update_error", error: updErr.message }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 5. Trigger auto-match untuk tanggal hari ini (atau tanggal dari OCR jika ada)
    const targetDate =
      ocr.tanggal || new Date().toISOString().slice(0, 10);

    const matchResp = await fetch(`${SUPABASE_URL}/functions/v1/auto-match`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_ROLE}`,
      },
      body: JSON.stringify({ mode: "apply", transaction_date: targetDate }),
    });

    const matched = matchResp.ok;
    if (!matchResp.ok) {
      console.error("[auto-ocr] auto-match failed", matchResp.status);
    }

    return new Response(
      JSON.stringify({
        success: true,
        receipt_id,
        ocr: { nominal: ocr.nominal, jam: ocr.jam, tanggal: ocr.tanggal },
        matched,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[auto-ocr] fatal", e instanceof Error ? e.message : "unknown");
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
