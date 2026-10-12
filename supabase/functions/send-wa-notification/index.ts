import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendText, sendQuotedText, sendReaction } from "../_shared/wasender.ts";
import { r2Delete, r2FileNameFromUrl } from "../_shared/r2.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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

async function sendOneReaction(m: any, emoji: string): Promise<boolean> {
  if (!m.wa_message_id || !m.key_json) {
    console.error("[REACT] Missing wa_message_id or key_json for receipt_id:", m.receipt_id);
    return false;
  }
  const savedKey = typeof m.key_json === "string" ? JSON.parse(m.key_json) : m.key_json;
  const keyObj = {
    id:          savedKey?.id || m.wa_message_id,
    remoteJid:   savedKey?.remoteJid || m.remote_jid || "",
    fromMe:      savedKey?.fromMe ?? false,
    participant: savedKey?.participant || undefined,
  };
  const resp = await sendReaction(keyObj, emoji);
  console.log(`[REACT] to=${keyObj.remoteJid} id=${keyObj.id} emoji=${emoji} -> ${resp.status}`, JSON.stringify(resp.data));
  return resp.ok;
}

async function sendOneMessage(m: any, r: any, templateApproved: string, templateRejected: string, status: string): Promise<boolean> {
  const target = m.is_group && m.group_id
    ? m.group_id
    : m.remote_jid || `${intlDigits(m.phone || "")}@s.whatsapp.net`;
  if (!target) { console.error("[MSG] No target for receipt_id:", m.receipt_id); return false; }
  const nominal = formatRupiah(Number(r?.nominal || 0));
  const text = (status === "Approved" ? templateApproved : templateRejected).replace(/\{nominal\}/g, nominal);
  if (m.wa_message_id && m.key_json) {
    const savedKey = typeof m.key_json === "string" ? JSON.parse(m.key_json) : m.key_json;
    const resp = await sendQuotedText(target, text, savedKey?.id || m.wa_message_id);
    if (resp.ok) return true;
  }
  const fallback = await sendText(target, text);
  return fallback.ok;
}

async function runSerial<T>(tasks: Array<() => Promise<T>>): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < tasks.length; i++) {
    results.push(await tasks[i]());
    if (i < tasks.length - 1) await new Promise((r) => setTimeout(r, 2500));
  }
  return results;
}

async function runParallel<T>(tasks: Array<() => Promise<T>>): Promise<T[]> {
  return Promise.all(tasks.map((t) => t()));
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL             = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const payload = await req.json();
    const { status } = payload;
    if (!status) throw new Error("Missing required field: status");
    if (status !== "Approved" && status !== "Rejected") {
      return new Response(JSON.stringify({ success: true, skipped: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ids: string[] = Array.isArray(payload.receipt_ids) && payload.receipt_ids.length > 0
      ? payload.receipt_ids
      : payload.receipt_id ? [payload.receipt_id] : [];
    if (ids.length === 0) throw new Error("Missing receipt_id(s)");
    const safeIds = ids.slice(0, 20);

    // Settings
    const { data: settingsRow } = await supabase
      .from("notification_settings")
      .select("mode, reaction_approved, reaction_rejected, message_approved, message_rejected")
      .eq("id", "default").single();
    const mode             = settingsRow?.mode || "message";
    const reactionApproved = settingsRow?.reaction_approved || "❤️";
    const reactionRejected = settingsRow?.reaction_rejected || "❌";
    const msgApproved      = (settingsRow as any)?.message_approved || "Resi Sebesar {nominal} Masuk ✅";
    const msgRejected      = (settingsRow as any)?.message_rejected || "Resi Sebesar {nominal} Tidak Masuk ❌";

    // Ambil info receipts
    const { data: receipts } = await supabase
      .from("receipts")
      .select("id, nominal, nomor_hp, nama, jam_transfer")
      .in("id", safeIds);

    // STEP 1: Kumpulkan SEMUA receipt duplikat (pengirim + nominal sama, hari ini).
    // Tanpa filter status — receipt ke-2,3 bisa masih Pending (OCR belum selesai),
    // tapi reaction-nya tetap harus terkirim.
    const today = new Date().toISOString().slice(0, 10);
    const todayStart = `${today}T00:00:00+07:00`;
    const todayEnd   = `${today}T23:59:59.999+07:00`;

    // groups: key "nomor_hp|nominal" -> daftar receipt (urut created_at ASC)
    const dupGroups = new Map<string, any[]>();
    const allReceiptIds = new Set<string>(safeIds);

    for (const r of receipts || []) {
      const rr = r as any;
      if (!rr.nomor_hp || !rr.nominal) continue;
      const key = `${rr.nomor_hp}|${rr.nominal}`;
      if (dupGroups.has(key)) continue;

      const { data: allSame } = await supabase
        .from("receipts")
        .select("id, image_url, created_at")
        .eq("nomor_hp", rr.nomor_hp)
        .eq("nominal", rr.nominal)
        .gte("created_at", todayStart).lt("created_at", todayEnd)
        .order("created_at", { ascending: true });

      dupGroups.set(key, allSame || []);
      for (const s of allSame || []) allReceiptIds.add(s.id);
    }

    const allIds = Array.from(allReceiptIds);

    // STEP 2: Query SEMUA receipt_wa_messages dari semua receipt duplikat.
    // Tidak difilter reacted_at — reaction WhatsApp idempotent, dan ini menjamin
    // semua group tetap dapat reaction walau fungsi dipanggil lebih dari sekali.
    const { data: waMessages } = await supabase
      .from("receipt_wa_messages")
      .select("id, receipt_id, wa_message_id, phone, group_id, is_group, remote_jid, participant, from_me, key_json, message_json")
      .in("receipt_id", allIds);

    if (!waMessages || waMessages.length === 0) {
      console.log("[NOTIF] Tidak ada wa_messages untuk receipts:", allIds.join(","));
      return new Response(JSON.stringify({ success: true, no_msgs: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const willReact =
      mode === "reaction" ||
      (mode === "hybrid_react_approve" && status === "Approved") ||
      (mode === "hybrid_react_reject" && status === "Rejected");

    const makeTask = (m: any) => async () => {
      let ok = false;
      try {
        if (mode === "reaction") {
          ok = await sendOneReaction(m, status === "Approved" ? reactionApproved : reactionRejected);
        } else if (mode === "hybrid_react_approve") {
          ok = status === "Approved"
            ? await sendOneReaction(m, reactionApproved)
            : await sendOneMessage(m, { nominal: 0 }, msgApproved, msgRejected, status);
        } else if (mode === "hybrid_react_reject") {
          ok = status === "Approved"
            ? await sendOneMessage(m, { nominal: 0 }, msgApproved, msgRejected, status)
            : await sendOneReaction(m, reactionRejected);
        } else {
          ok = await sendOneMessage(m, { nominal: 0 }, msgApproved, msgRejected, status);
        }
      } catch (e) {
        console.error("[SEND ERROR]", e instanceof Error ? e.message : "unknown");
      }
      if (ok) {
        await supabase.from("receipt_wa_messages")
          .update({ reacted_at: new Date().toISOString() }).eq("id", m.id);
      }
      return ok;
    };

    // STEP 3: Kirim reaction/pesan ke SEMUA wa_messages. Reaction tanpa delay
    // (paralel), pesan teks tetap serial agar tidak kena rate limit.
    const msgList = waMessages as any[];
    console.log(`[NOTIF] Kirim ${msgList.length} ${willReact ? "reaction" : "pesan"} untuk ${allIds.length} receipt`);
    const tasks = msgList.map(makeTask);
    const results = willReact ? await runParallel(tasks) : await runSerial(tasks);
    const sent   = results.filter(Boolean).length;
    const failed = results.filter((v) => !v).length;

    // STEP 4: Hapus duplikat SETELAH semua reaction terkirim. Sisakan yang paling awal.
    let deleted = 0;
    const deletedIds = new Set<string>();
    if (status === "Approved") {
      for (const [key, group] of dupGroups) {
        if (group.length <= 1) continue;
        const keep = group[0];
        const dups = group.slice(1);
        const dupIds = dups.map((d: any) => d.id);

        // Pindahkan wa_messages duplikat ke receipt yang disimpan agar
        // riwayat reaction tidak hilang, lalu hapus receipt duplikatnya.
        await supabase.from("receipt_wa_messages")
          .update({ receipt_id: keep.id }).in("receipt_id", dupIds);

        for (const d of dups) {
          if (d.image_url) {
            const fileName = r2FileNameFromUrl(d.image_url);
            if (fileName) await r2Delete(fileName).catch(() => {});
          }
        }

        const { error: delErr } = await supabase.from("receipts").delete().in("id", dupIds);
        if (delErr) {
          console.error(`[DEDUP] Gagal hapus ${dupIds.length} duplikat (${key}):`, delErr.message);
        } else {
          deleted += dupIds.length;
          for (const id of dupIds) deletedIds.add(id);
          console.log(`[DEDUP] Hapus ${dupIds.length} duplikat (${key}), simpan ${keep.id}`);
        }
      }
    }

    // STEP 5: Hapus image di R2 untuk resi Approved yang TETAP ada.
    // Sebelumnya hanya image duplikat yang dihapus, sedangkan image resi yang
    // disimpan menumpuk di R2 jadi orphan. auto-match sudah melakukan ini lewat
    // deleteReceiptImage, tapi approve manual dari dashboard tidak lewat sana.
    let imagesDeleted = 0;
    if (status === "Approved") {
      const survivorIds = allIds.filter((id) => !deletedIds.has(id));
      if (survivorIds.length > 0) {
        const { data: survivors } = await supabase
          .from("receipts")
          .select("id, image_url")
          .in("id", survivorIds)
          .not("image_url", "is", null)
          .neq("image_url", "");

        for (const s of (survivors || []) as any[]) {
          const fileName = r2FileNameFromUrl(s.image_url);
          if (!fileName) continue;
          try {
            await r2Delete(fileName);
            // Kosongkan image_url hanya kalau R2 delete sukses, supaya file
            // yang gagal dihapus tidak kehilangan jejak URL-nya.
            await supabase.from("receipts").update({ image_url: "" }).eq("id", s.id);
            imagesDeleted++;
          } catch (e) {
            console.error(`[R2] Gagal hapus image resi ${s.id}:`, e instanceof Error ? e.message : "unknown");
          }
        }
        if (imagesDeleted > 0) console.log(`[R2] Hapus ${imagesDeleted} image resi Approved`);
      }
    }

    return new Response(JSON.stringify({ success: true, sent, failed, deleted, images_deleted: imagesDeleted, total: tasks.length, mode }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("Error:", msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
