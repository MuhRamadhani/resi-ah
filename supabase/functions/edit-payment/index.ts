import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { wasenderRequest, deleteMessage } from "../_shared/wasender.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/** 08xxx / 62xxx / JID → 08xxx. Sama dengan normalizePhone di wa-webhook. */
function normalizePhone(p: string): string {
  const d = (p || "").split("@")[0].replace(/\D/g, "");
  if (!d) return "";
  return d.startsWith("62") ? "0" + d.slice(2) : d;
}

/** 08xxx → 62xxx untuk mention */
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
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { entry_id, tag_phone, note } = await req.json();
    if (!entry_id) return json({ error: "entry_id required" }, 400);
    // Minimal satu field harus dikirim. undefined = tidak diubah.
    if (tag_phone === undefined && note === undefined) {
      return json({ error: "tag_phone atau note harus diisi" }, 400);
    }

    const { data: entry, error: fetchErr } = await supabase
      .from("payment_entries")
      .select("id, group_id, tag_phone, note, approved_at, approved_msg_id, key_json, message_json")
      .eq("id", entry_id)
      .maybeSingle();

    if (fetchErr || !entry) return json({ error: "Entry not found" }, 404);

    // ── Simpan perubahan ──
    const patch: Record<string, unknown> = {};
    if (tag_phone !== undefined) {
      const cleaned = normalizePhone(String(tag_phone));
      patch.tag_phone = cleaned || null;
      // tag_jid ikut disesuaikan supaya mention tidak memakai nomor lama.
      patch.tag_jid = cleaned ? `${toIntl(cleaned)}@s.whatsapp.net` : null;
    }
    if (note !== undefined) patch.note = String(note).trim() || null;

    const { error: updErr } = await supabase
      .from("payment_entries")
      .update(patch)
      .eq("id", entry_id);
    if (updErr) return json({ error: `Gagal menyimpan: ${updErr.message}` }, 500);

    // ── Re-evaluasi kelayakan Approved dengan nilai BARU ──
    const newTagPhone = (tag_phone !== undefined ? normalizePhone(String(tag_phone)) : normalizePhone(entry.tag_phone || ""));
    const newNote = (note !== undefined ? String(note).trim() : (entry.note || ""));

    const { data: wlData } = await supabase
      .from("payment_whitelist").select("phone").limit(200);
    const whitelistSet = new Set((wlData || []).map((w: any) => normalizePhone(w.phone)));

    const { data: nwData } = await supabase
      .from("payment_note_whitelist").select("keyword").eq("enabled", true);
    const enabledNoteKeywords: string[] = (nwData || [])
      .map((n: any) => (n.keyword as string).toLowerCase().trim());

    // Aturan identik dengan wa-webhook: lolos kalau nomor ada di whitelist
    // ATAU note mengandung keyword yang enabled.
    const phoneInWhitelist = !!newTagPhone && whitelistSet.has(newTagPhone);
    const noteVal = newNote.toLowerCase();
    const noteInWhitelist = !!noteVal && enabledNoteKeywords.some(k => noteVal.includes(k));
    const shouldBeApproved = phoneInWhitelist || noteInWhitelist;

    const isApproved = !!entry.approved_at;
    let action: "none" | "revoked" | "approved" = "none";
    let warning: string | null = null;

    if (isApproved && !shouldBeApproved) {
      // ── Tidak lolos lagi → hapus pesan Approved ──
      if (entry.approved_msg_id) {
        const r = await deleteMessage(entry.approved_msg_id);
        if (!r.ok) {
          // Batas waktu delete-for-everyone WhatsApp sudah lewat, atau pesan
          // sudah hilang. Status DB tetap dibersihkan supaya dashboard jujur,
          // tapi user diberi tahu bahwa pesan di WA harus dihapus manual.
          warning = "Status dibatalkan, tapi pesan Approved di WA gagal dihapus (kemungkinan sudah lewat batas waktu hapus WhatsApp). Hapus manual di group.";
        }
      } else {
        warning = "Status dibatalkan, tapi pesan Approved di WA tidak bisa dihapus otomatis karena dikirim sebelum fitur ini ada. Hapus manual di group.";
      }
      await supabase
        .from("payment_entries")
        .update({ approved_at: null, approved_msg_id: null })
        .eq("id", entry_id);
      action = "revoked";

    } else if (!isApproved && shouldBeApproved && entry.group_id) {
      // ── Sekarang lolos → kirim Approved (payload sama dengan approve-payment) ──
      const ccRaw = Deno.env.get("APPROVED_CC_PHONE") || "";
      const ccDigits = ccRaw.replace(/\D/g, "");
      const ccIntl = ccDigits.startsWith("0") ? "62" + ccDigits.slice(1) : ccDigits;
      const mentions: string[] = ccIntl ? [`${ccIntl}@s.whatsapp.net`] : [];
      const ccText = ccIntl ? `\n\nCC : @${ccIntl}` : "";

      const payload: Record<string, unknown> = {
        to: entry.group_id,
        text: `Approved ✅${ccText}`,
        ...(mentions.length > 0 ? { mentions } : {}),
      };
      if (entry.key_json) {
        payload.replyToObject = {
          key: entry.key_json,
          message: entry.message_json || entry.key_json,
        };
      }

      const result = await wasenderRequest("/api/send-message", "POST", payload);
      if (result.ok) {
        const msgId = result.data?.data?.msgId ?? result.data?.msgId ?? null;
        await supabase
          .from("payment_entries")
          .update({ approved_at: new Date().toISOString(), approved_msg_id: msgId })
          .eq("id", entry_id);
        action = "approved";
      } else {
        warning = "Perubahan tersimpan, tapi pesan Approved gagal dikirim.";
      }
    }

    return json({
      success: true,
      action,
      should_be_approved: shouldBeApproved,
      matched: phoneInWhitelist ? "whitelist" : noteInWhitelist ? "note" : null,
      ...(warning ? { warning } : {}),
    });
  } catch (e) {
    console.error("edit-payment error:", e);
    return json({ error: String(e) }, 500);
  }
});
