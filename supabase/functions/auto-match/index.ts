import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { r2Delete, r2FileNameFromUrl } from "../_shared/r2.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DAY_MINUTES = 24 * 60;

// Delete image dari R2 dan update DB
async function deleteReceiptImage(supabase: any, receiptId: string, imageUrl: string) {
  if (!imageUrl || imageUrl === "") return;
  try {
    const fileName = r2FileNameFromUrl(imageUrl);
    if (fileName) await r2Delete(fileName);
    await supabase.from("receipts").update({ image_url: "" }).eq("id", receiptId);
  } catch (e) {
    console.error(`[DELETE IMAGE] Error:`, e instanceof Error ? e.message : "unknown");
  }
}

// Delete duplicate approved receipts (keep oldest, delete newer ones).
// WA messages from duplicates are re-linked to the kept receipt so reactions
// are sent to every group the member submitted the receipt in.
async function deleteDuplicateApproved(supabase: any, receipt: any, targetDate: string) {
  try {
    const todayStart = `${targetDate}T00:00:00+07:00`;
    const todayEnd = `${targetDate}T23:59:59.999+07:00`;
    
    // Find all approved receipts with same nama+nominal+jam today
    const { data: duplicates } = await supabase
      .from("receipts")
      .select("id, image_url, created_at, nama")
      .eq("nama", receipt.nama)
      .eq("nominal", receipt.nominal)
      .eq("jam_transfer", receipt.jam_transfer)
      .eq("status", "Approved")
      .gte("created_at", todayStart)
      .lt("created_at", todayEnd)
      .order("created_at", { ascending: true });
    
    if (!duplicates || duplicates.length <= 1) return; // No duplicates
    
    const toKeep = duplicates[0]; // Keep oldest
    const toDelete = duplicates.slice(1); // Delete newer ones

    for (const dup of toDelete) {
      // Re-link WA messages from this duplicate to the kept receipt so that
      // send-wa-notification can react to every group message.
      await supabase
        .from("receipt_wa_messages")
        .update({ receipt_id: toKeep.id })
        .eq("receipt_id", dup.id);

      // Delete image if exists
      if (dup.image_url && dup.image_url !== "") {
        const fileName = r2FileNameFromUrl(dup.image_url);
        if (fileName) await r2Delete(fileName);
      }
      
      // Delete the duplicate receipt (wa_messages already re-linked, no FK issue)
      await supabase.from("receipts").delete().eq("id", dup.id);
    }
  } catch (e) {
    console.error(`[DUPLICATE] Error deleting duplicates:`, e instanceof Error ? e.message : "unknown");
  }
}

// Parse HH:mm, HH:mm:ss, HH.mm, or AM/PM to minutes since midnight.
function toMinutes(t: string): number {
  const raw = String(t || "").trim();
  const m = /(\d{1,2})\s*[:.]\s*(\d{2})(?::\d{2})?\s*([ap]\.?m\.?)?/i.exec(raw);
  if (!m) return -1;

  let hour = parseInt(m[1], 10);
  const minute = parseInt(m[2], 10);
  const ampm = (m[3] || "").toLowerCase().replace(/\./g, "");

  if (minute < 0 || minute > 59) return -1;
  if (ampm === "pm" && hour < 12) hour += 12;
  if (ampm === "am" && hour === 12) hour = 0;
  if (hour < 0 || hour > 23) return -1;

  return hour * 60 + minute;
}

function normalizeMinute(value: number): number {
  return ((value % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
}

function formatMinute(value: number): string {
  const min = normalizeMinute(value);
  const hh = String(Math.floor(min / 60)).padStart(2, "0");
  const mm = String(min % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

function exactTimezoneOffsetHours(txMinute: number, receiptMinute: number): number | null {
  for (const offsetMinutes of [0, -60, 60]) {
    if (normalizeMinute(txMinute + offsetMinutes) === receiptMinute) {
      return offsetMinutes / 60;
    }
  }
  return null;
}

function circularDiffMinutes(a: number, b: number): number {
  const diff = Math.abs(normalizeMinute(a) - normalizeMinute(b));
  return Math.min(diff, DAY_MINUTES - diff);
}

function roundNominal(value: unknown): number {
  return Math.round(Number(value) || 0);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  try {
    const body = await req.json().catch(() => ({}));
    const url = new URL(req.url);
    const mode = (body.mode || url.searchParams.get("mode") || "preview") as "preview" | "apply";
    const video_id: string | undefined = body.video_id || undefined;
    const targetDate: string =
      body.transaction_date || new Date().toISOString().slice(0, 10);
    // Toleransi waktu dalam menit (0 = harus sama persis, 1 = boleh beda 1 menit)
    const timeTolerance: number = Math.max(0, Math.min(5, Number(body.time_tolerance_minutes) || 0));

    // Load transaksi yang masih bisa dipakai match (scoped to date).
    // Transaksi "matched" tetap ikut diambil: satu transaksi bisa dipakai
    // berkali-kali untuk resi dengan nominal + jam sama dari group/admin berbeda.
    // Yang tidak boleh adalah transaksi yang sudah "review" (butuh keputusan manual).
    let txQuery = supabase
      .from("transactions")
      .select("id, nominal, transaction_date, transaction_time, kode_transaksi, video_id, status_match")
      .or("status_match.eq.unmatched,status_match.eq.matched,status_match.is.null")
      .eq("transaction_date", targetDate);
    if (video_id) txQuery = txQuery.eq("video_id", video_id);
    const { data: txs, error: txErr } = await txQuery;
    if (txErr) throw txErr;

    // Load ALL pending receipts (not scoped to date — user bisa upload resi lintas hari)
    const { data: receipts, error: rErr } = await supabase
      .from("receipts")
      .select("id, nominal, jam_transfer, nomor_hp, nama, status, created_at")
      .ilike("status", "Pending")
      .limit(5000);
    if (rErr) throw rErr;

    const txItems = (txs || [])
      .map((tx: any) => ({
        ...tx,
        nominal_round: roundNominal(tx.nominal),
        minute: toMinutes(tx.transaction_time as unknown as string),
      }))
      .sort((a: any, b: any) => a.minute - b.minute || String(a.id).localeCompare(String(b.id)));

    const receiptItems = (receipts || [])
      .map((r: any) => ({
        ...r,
        nominal_round: roundNominal(r.nominal),
        minute: toMinutes(r.jam_transfer as unknown as string),
      }))
      .sort((a: any, b: any) => String(a.created_at || "").localeCompare(String(b.created_at || "")) || String(a.id).localeCompare(String(b.id)));

    const usedReceipts = new Set<string>();
    const handledTx = new Set<string>();
    // auto_approve: one entry per receipt (a single tx can have multiple entries = multi-group)
    const auto_approve: Array<{
      transaction_id: string;
      receipt_id: string;
      confidence: number;
      nominal: number;
      tx_time: string;
      receipt_time: string;
      time_offset_hours: number;
      reason: string;
    }> = [];
    const review: Array<{
      transaction_id: string;
      candidates: string[];
      confidence: number;
      nominal: number;
      tx_time: string;
      reason: string;
    }> = [];
    const unmatched: Array<{
      transaction_id: string;
      nominal: number;
      tx_time: string;
      reason: string;
    }> = [];

    // Satu transaksi bisa approve semua receipt dengan nominal + jam yang sama,
    // tanpa peduli nomor pengirim (karena admin bisa berbeda submit resi sama).
    function pushApproveAll(tx: any, matches: Array<{ r: any; offsetHours: number }>, reason: string) {
      for (const { r, offsetHours } of matches) {
        auto_approve.push({
          transaction_id: tx.id,
          receipt_id: r.id,
          confidence: 100,
          nominal: tx.nominal_round,
          tx_time: formatMinute(tx.minute),
          receipt_time: formatMinute(r.minute),
          time_offset_hours: offsetHours,
          reason,
        });
        usedReceipts.add(r.id);
      }
      handledTx.add(tx.id);
    }

    function availableReceiptsFor(tx: any, offsets: number[], toleranceMin = 0) {
      return receiptItems
        .filter((r: any) => !usedReceipts.has(r.id))
        .filter((r: any) => r.minute >= 0 && r.nominal_round === tx.nominal_round)
        .map((r: any) => {
          // Cek semua kombinasi offset jam × toleransi menit
          for (const offsetMinutes of offsets.map(h => h * 60)) {
            const diff = circularDiffMinutes(normalizeMinute(tx.minute + offsetMinutes), r.minute);
            if (diff <= toleranceMin) {
              return { r, offsetHours: offsetMinutes / 60, diffMinutes: diff };
            }
          }
          return null;
        })
        .filter((c: any) => c !== null);
    }

    // Phase 1: exact same nominal + sama/toleransi menit, jam sama persis.
    for (const tx of txItems) {
      if (tx.minute < 0 || tx.nominal_round <= 0) continue;
      const exactAll = availableReceiptsFor(tx, [0], timeTolerance);
      if (exactAll.length > 0) {
        pushApproveAll(
          tx,
          exactAll,
          timeTolerance > 0
            ? `Nominal sama, jam sama, selisih ≤${timeTolerance} menit`
            : "Nominal dan jam sama persis",
        );
      }
    }

    // Phase 2: timezone tolerance ±1 hour, dengan toleransi menit.
    for (const tx of txItems) {
      if (handledTx.has(tx.id)) continue;
      if (tx.minute < 0 || tx.nominal_round <= 0) continue;

      const zoneCandidates = availableReceiptsFor(tx, [-1, 1], timeTolerance);
      const distinctOffsets = new Set(zoneCandidates.map((c: any) => c.offsetHours));

      if (zoneCandidates.length === 0) continue;

      if (distinctOffsets.size > 1) {
        review.push({
          transaction_id: tx.id,
          candidates: zoneCandidates.slice(0, 10).map((c: any) => c.r.id),
          confidence: 95,
          nominal: tx.nominal_round,
          tx_time: formatMinute(tx.minute),
          reason: "Ada kandidat di +1 jam dan -1 jam, perlu pilih manual",
        });
        handledTx.add(tx.id);
        continue;
      }

      // All candidates have the same offset — approve them all
      const offsetHours = zoneCandidates[0].offsetHours;
      pushApproveAll(
        tx,
        zoneCandidates,
        offsetHours === -1
          ? `Nominal sama, jam transaksi -1 jam cocok dengan resi${timeTolerance > 0 ? ` (toleransi ≤${timeTolerance} menit)` : ""}`
          : `Nominal sama, jam transaksi +1 jam cocok dengan resi${timeTolerance > 0 ? ` (toleransi ≤${timeTolerance} menit)` : ""}`,
      );
    }

    // Receipt tanpa transaction_id tidak boleh di-approve. Dukungan multi-group
    // sudah ditangani pada match transaksi yang sama, dengan guard nomor pengirim.

    // Phase 3: explain anything still unmatched.
    for (const tx of txItems) {
      if (handledTx.has(tx.id)) continue;
      if (tx.nominal_round <= 0) {
        unmatched.push({
          transaction_id: tx.id,
          nominal: tx.nominal_round,
          tx_time: String(tx.transaction_time || "-"),
          reason: "Nominal transaksi tidak valid",
        });
        continue;
      }
      if (tx.minute < 0) {
        unmatched.push({
          transaction_id: tx.id,
          nominal: tx.nominal_round,
          tx_time: String(tx.transaction_time || "-"),
          reason: "Jam transaksi tidak valid",
        });
        continue;
      }

      const sameNominal = receiptItems
        .filter((r: any) => !usedReceipts.has(r.id))
        .filter((r: any) => r.nominal_round === tx.nominal_round);

      if (sameNominal.length === 0) {
        unmatched.push({
          transaction_id: tx.id,
          nominal: tx.nominal_round,
          tx_time: formatMinute(tx.minute),
          reason: "Tidak ada resi pending dengan nominal yang sama",
        });
        continue;
      }

      const validTimeReceipts = sameNominal.filter((r: any) => r.minute >= 0);
      if (validTimeReceipts.length === 0) {
        unmatched.push({
          transaction_id: tx.id,
          nominal: tx.nominal_round,
          tx_time: formatMinute(tx.minute),
          reason: "Nominal cocok, tapi jam resi kosong/tidak terbaca",
        });
        continue;
      }

      const closest = validTimeReceipts
        .map((r: any) => ({ r, diff: circularDiffMinutes(tx.minute, r.minute) }))
        .sort((a: any, b: any) => a.diff - b.diff)[0];

      unmatched.push({
        transaction_id: tx.id,
        nominal: tx.nominal_round,
        tx_time: formatMinute(tx.minute),
        reason: `Nominal cocok, tapi jam resi terdekat ${formatMinute(closest.r.minute)} beda ${closest.diff} menit. Sistem hanya approve kalau menit persis sama atau beda zona waktu tepat 1 jam.`,
      });
    }

    const debug = {
      transactions_checked: txItems.length,
      pending_receipts: receiptItems.length,
      valid_transaction_times: txItems.filter((tx: any) => tx.minute >= 0).length,
      valid_receipt_times: receiptItems.filter((r: any) => r.minute >= 0).length,
      invalid_transaction_times: txItems.filter((tx: any) => tx.minute < 0).length,
      invalid_receipt_times: receiptItems.filter((r: any) => r.minute < 0).length,
      rule: timeTolerance > 0
        ? `Nominal sama + selisih waktu ≤${timeTolerance} menit (jam boleh ±1 untuk WIB/WITA).`
        : "Nominal sama + menit sama persis. Jam boleh sama, +1, atau -1 untuk beda WIB/WITA.",
    };

    if (mode === "preview") {
      return new Response(
        JSON.stringify({
          success: true,
          mode,
          summary: {
            total: (txs || []).length,
            pending_receipts: (receipts || []).length,
            auto_approve: auto_approve.length,
            transaction_backed_matches: auto_approve.filter((m) => m.transaction_id).length,
            review: review.length,
            unmatched: unmatched.length,
          },
          debug,
          auto_approve,
          review,
          unmatched,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── apply mode ──────────────────────────────────────────────────────────

    const approvedReceiptIds: string[] = auto_approve.map((m) => m.receipt_id);
    const now = new Date().toISOString();

    // Hanya receipt yang benar-benar punya pasangan transaksi yang boleh
    // di-approve. Receipt baru dari group lain akan menunggu transaksi sendiri.

    // Batch 1: approve all matched receipts in one call
    if (approvedReceiptIds.length > 0) {
      const { error: eReceipts } = await supabase
        .from("receipts")
        .update({ status: "Approved", approved_at: now })
        .in("id", approvedReceiptIds)
        .ilike("status", "Pending");
      if (eReceipts) console.error("batch approve receipts fail", eReceipts.message);

      // FLOW 1: Delete images for approved receipts
      for (const match of auto_approve) {
        const receiptId = match.receipt_id;
        const { data: receipt } = await supabase
          .from("receipts")
          .select("id, image_url")
          .eq("id", receiptId)
          .single();
        if (receipt?.image_url) {
          await deleteReceiptImage(supabase, receipt.id, receipt.image_url);
        }
      }
    }

    // Batch 2: update matched transactions
    const matchesWithTx = auto_approve.filter((m) => m.transaction_id);
    const matchedTransactionIds = new Set(matchesWithTx.map((m) => m.transaction_id));
    if (matchesWithTx.length > 0) {
      // Group receipt_ids by transaction_id
      const txReceiptMap = new Map<string, string[]>();
      for (const m of matchesWithTx) {
        if (!txReceiptMap.has(m.transaction_id)) txReceiptMap.set(m.transaction_id, []);
        txReceiptMap.get(m.transaction_id)!.push(m.receipt_id);
      }

      const updateGroups = new Map<string, string[]>();
      for (const [txId, rIds] of txReceiptMap) {
        const key = rIds.sort().join(",");
        if (!updateGroups.has(key)) updateGroups.set(key, []);
        updateGroups.get(key)!.push(txId);
      }

      for (const [receiptIdsCsv, txIds] of updateGroups) {
        const primaryReceiptId = receiptIdsCsv.split(",")[0];
        const { error: eTxMatch } = await supabase
          .from("transactions")
          .update({
            status_match: "matched",
            matched_receipt_id: primaryReceiptId,
            confidence: 100,
          })
          .in("id", txIds);
        if (eTxMatch) console.error("batch match transactions fail", eTxMatch.message);
      }
    }

    // Batch 3: update review transactions in one call
    if (review.length > 0) {
      const reviewIds = review.map((r) => r.transaction_id);
      const { error: eTxReview } = await supabase
        .from("transactions")
        .update({ status_match: "review", confidence: 95 })
        .in("id", reviewIds);
      if (eTxReview) console.error("batch review transactions fail", eTxReview.message);
    }

    // Update video stats
    if (video_id) {
      await supabase
        .from("merchant_videos")
        .update({
          matched_count: auto_approve.length + review.length,
          auto_approved_count: approvedReceiptIds.length,
        })
        .eq("id", video_id);
    }

    // Kirim WA notifications — semua chunk paralel sekaligus, tanpa delay.
    // send-wa-notification sudah handle reaction secara paralel di dalamnya.
    if (approvedReceiptIds.length > 0) {
      const todayStart = `${targetDate}T00:00:00+07:00`;
      const todayEnd   = `${targetDate}T23:59:59.999+07:00`;

      // PRE-STEP: Re-link receipt_wa_messages dari semua duplikat ke receipt tertua,
      // lalu kumpulkan ID receipt tertua saja untuk notifikasi.
      // Ini memastikan 1 receipt punya semua wa_messages dari semua group
      // sebelum send-wa-notification dijalankan.
      const { data: approvedReceipts } = await supabase
        .from("receipts")
        .select("id, nomor_hp, nominal, jam_transfer")
        .in("id", approvedReceiptIds);

      const notifyIds = new Set<string>(); // receipt tertua per grup nomor+nominal+jam
      const processedKeys = new Set<string>();

      for (const r of approvedReceipts || []) {
        if (!r.nomor_hp || !r.nominal || !r.jam_transfer) {
          notifyIds.add(r.id);
          continue;
        }
        const key = `${r.nomor_hp}|${r.nominal}|${r.jam_transfer}`;
        if (processedKeys.has(key)) continue;
        processedKeys.add(key);

        // Cari semua Approved dari nomor+nominal+jam yang sama hari ini
        const { data: allSame } = await supabase
          .from("receipts")
          .select("id, created_at")
          .eq("nomor_hp", r.nomor_hp)
          .eq("nominal", r.nominal)
          .eq("jam_transfer", r.jam_transfer)
          .eq("status", "Approved")
          .gte("created_at", todayStart)
          .lt("created_at", todayEnd)
          .order("created_at", { ascending: true });

        if (!allSame || allSame.length === 0) { notifyIds.add(r.id); continue; }

        const oldest = allSame[0];
        notifyIds.add(oldest.id);

        // Re-link semua receipt_wa_messages dari duplikat ke receipt tertua
        const dupIds = allSame.slice(1).map((d: any) => d.id);
        if (dupIds.length > 0) {
          await supabase
            .from("receipt_wa_messages")
            .update({ receipt_id: oldest.id })
            .in("receipt_id", dupIds);
        }
      }

      // Kirim notifikasi hanya ke receipt tertua (yang sudah punya semua wa_messages)
      const notifyIdArr = Array.from(notifyIds);
      const CHUNK_SIZE = 20;
      const chunks: string[][] = [];
      for (let i = 0; i < notifyIdArr.length; i += CHUNK_SIZE) {
        chunks.push(notifyIdArr.slice(i, i + CHUNK_SIZE));
      }
      await Promise.all(chunks.map((chunk) =>
        fetch(`${SUPABASE_URL}/functions/v1/send-wa-notification`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SERVICE_ROLE}`,
          },
          body: JSON.stringify({ status: "Approved", receipt_ids: chunk }),
        }).catch((e) => console.error(`wa notify fail`, e instanceof Error ? e.message : "unknown"))
      ));

    }

    console.log(
      `[AUTO-MATCH] date=${targetDate} transactions=${matchedTransactionIds.size} ` +
      `receipts=${approvedReceiptIds.length} review=${review.length} unmatched=${unmatched.length}`,
    );

    return new Response(
      JSON.stringify({
        success: true,
        mode,
        applied: {
          approved_receipts: approvedReceiptIds.length,
          transaction_backed_matches: matchesWithTx.length,
          matched_transactions: matchedTransactionIds.size,
          review: review.length,
          unmatched: unmatched.length,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("auto-match error", e instanceof Error ? e.message : "unknown");
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// redeploy: 1787200001
