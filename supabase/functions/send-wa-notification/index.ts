import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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


serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // let lockAcquired = false;
  try {
    const payload = await req.json();
    const { status } = payload;
    if (!status) throw new Error("Missing required field: status");
    if (status !== "Approved" && status !== "Rejected") {
      return new Response(JSON.stringify({ success: true, skipped: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ids: string[] = Array.isArray(payload.receipt_ids) && payload.receipt_ids.length > 0
      ? payload.receipt_ids
      : payload.receipt_id ? [payload.receipt_id] : [];
    if (ids.length === 0) throw new Error("Missing receipt_id(s)");

    const { data: receipts } = await supabase
      .from("receipts")
      .select("id, nominal, nomor_hp")
      .in("id", ids);

    const { data: waMessages } = await supabase
      .from("receipt_wa_messages")
      .select("*")
      .in("receipt_id", ids);

    if (!waMessages || waMessages.length === 0) {
      return new Response(JSON.stringify({ success: true, no_msgs: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const receiptMap = new Map<string, any>((receipts || []).map((r: any) => [r.id, r]));

    type Entry = { receipts: Map<string, string> };
    const byTarget = new Map<string, Entry>();
    for (const m of waMessages as any[]) {
      const target = m.is_group && m.group_id
        ? m.group_id
        : `${intlDigits(m.phone || "")}@s.whatsapp.net`;
      if (!target) continue;
      const entry = byTarget.get(target) || { receipts: new Map() };
      const mention = intlDigits(m.phone || "");
      if (!entry.receipts.has(m.receipt_id)) entry.receipts.set(m.receipt_id, mention);
      byTarget.set(target, entry);
    }

    const verb = status === "Approved" ? "Masuk ✅" : "Tidak Masuk ❌";

    let sent = 0;
    let failed = 0;
    let first = true;
    for (const [target, entry] of byTarget) {
      const lines: string[] = [];
      const mentions: string[] = [];
      const seen = new Set<string>();
      for (const [rid, mention] of entry.receipts) {
        const r = receiptMap.get(rid);
        if (!r) continue;
        const key = `${mention}|${r.nominal}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const tag = mention ? `@${mention}` : r.nomor_hp;
        lines.push(`Resi ${tag}\nSebesar *${formatRupiah(Number(r.nominal || 0))}* ${verb}`);
        if (mention && !mentions.includes(mention)) mentions.push(mention);
      }
      if (lines.length === 0) continue;
      const text = lines.join("\n\n");

      await supabase
        .from("wa_send_queue")
        .insert({
          target,
          text,
          mentions,
          status: "pending"
        });
      
      await fetch(
        `${SUPABASE_URL}/functions/v1/wa-queue-worker`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
          }
        }
      );

      sent++;
    }

    return new Response(JSON.stringify({ success: true, sent, failed, groups: byTarget.size }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("Error sending WA message:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
