/**
 * resend-wa.mjs
 * Kirim ulang WA notification untuk semua receipt Approved yang belum/gagal kirim.
 *
 * Usage:
 *   node scripts/resend-wa.mjs <SERVICE_ROLE_KEY> [tanggal]
 *
 * Contoh:
 *   node scripts/resend-wa.mjs eyJhbGc... 2026-08-20
 *   node scripts/resend-wa.mjs eyJhbGc...          (tanggal = hari ini)
 */

const SUPABASE_URL = "https://ytsvvbbsrnoxwlsbaoja.supabase.co";
const SERVICE_ROLE = process.argv[2];
const targetDate = process.argv[3] || new Date().toISOString().slice(0, 10);

if (!SERVICE_ROLE) {
  console.error("❌ Usage: node scripts/resend-wa.mjs <SERVICE_ROLE_KEY> [tanggal YYYY-MM-DD]");
  process.exit(1);
}

console.log(`\n📋 Fetching Approved receipts for date: ${targetDate}`);

// 1. Fetch semua receipt Approved hari ini
const receiptRes = await fetch(
  `${SUPABASE_URL}/rest/v1/receipts?status=eq.Approved&created_at=gte.${targetDate}T00:00:00&created_at=lte.${targetDate}T23:59:59&select=id,nominal,nomor_hp,created_at&order=created_at.asc`,
  {
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
    },
  }
);

if (!receiptRes.ok) {
  console.error("❌ Gagal fetch receipts:", await receiptRes.text());
  process.exit(1);
}

const receipts = await receiptRes.json();
console.log(`✅ Ditemukan ${receipts.length} receipt Approved pada ${targetDate}`);

if (receipts.length === 0) {
  console.log("Tidak ada yang perlu dikirim.");
  process.exit(0);
}

const allIds = receipts.map((r) => r.id);

// 2. Chunk per 50 dan panggil send-wa-notification
const CHUNK_SIZE = 50;
const chunks = [];
for (let i = 0; i < allIds.length; i += CHUNK_SIZE) {
  chunks.push(allIds.slice(i, i + CHUNK_SIZE));
}

console.log(`\n🚀 Mengirim dalam ${chunks.length} batch (${CHUNK_SIZE} per batch)...\n`);

let totalSent = 0;
let totalFailed = 0;

for (let ci = 0; ci < chunks.length; ci++) {
  const chunk = chunks[ci];
  const label = `Batch ${ci + 1}/${chunks.length} (${chunk.length} receipts)`;
  process.stdout.write(`  ${label} → `);

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-wa-notification`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_ROLE}`,
      },
      body: JSON.stringify({ status: "Approved", receipt_ids: chunk }),
    });

    const json = await res.json().catch(() => ({}));

    if (res.ok && json.success) {
      const sent = json.sent ?? "?";
      const failed = json.failed ?? "?";
      const total = json.total ?? chunk.length;
      console.log(`✅ sent=${sent} failed=${failed} total=${total}`);
      totalSent += Number(json.sent || 0);
      totalFailed += Number(json.failed || 0);
    } else {
      console.log(`❌ HTTP ${res.status} — ${JSON.stringify(json)}`);
      totalFailed += chunk.length;
    }
  } catch (e) {
    console.log(`❌ Error — ${e.message}`);
    totalFailed += chunk.length;
  }

  // Jeda antar batch supaya tidak overwhelm Evolution API
  if (ci < chunks.length - 1) {
    await new Promise((r) => setTimeout(r, 2000));
  }
}

console.log(`\n✅ Selesai! Total sent=${totalSent} failed=${totalFailed} dari ${allIds.length} receipts`);
