# Plan: OCR Video Livin' Merchant (final)

Client-side OCR list-scroll dengan Tesseract.js. Tidak ada AI Vision, tidak ada upload video. Ada mode **Preview Matching** sebelum auto-approve massal.

## Pipeline

```text
Video (browser)
   │
   ▼ extract frame @ 1 fps (auto 2 fps bila scroll cepat)
Canvas crop area LIST TRANSAKSI (skip header/saldo/QR/navbar/footer)
   │
   ▼
Tesseract.js worker pool (ind+eng)
   │
   ▼
Parser regex → [{ nominal, transaction_time, kode_transaksi?, ocr_confidence, raw_ocr }]
   │
   ▼
Dedup in-memory: `${nominal}|${HH:mm}|${kode||''}`
   │
   ▼ POST batch  /transactions-ingest  → INSERT (ON CONFLICT DO NOTHING)
   │
   ▼ POST         /auto-match?mode=preview  → hitung match TANPA ubah DB
   │
   ▼ Admin klik "Terapkan Matching"
   │
   ▼ POST         /auto-match?mode=apply    → update DB + enqueue send-wa-notification
```

## Database (SQL untuk dijalankan manual di Supabase pribadi)

```sql
CREATE TABLE public.merchant_videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name text NOT NULL,
  file_size_bytes bigint,
  duration_seconds numeric,
  total_frames int DEFAULT 0,
  used_frames int DEFAULT 0,
  transactions_parsed int DEFAULT 0,
  duplicates_skipped int DEFAULT 0,
  matched_count int DEFAULT 0,
  auto_approved_count int DEFAULT 0,
  processing_time_ms bigint,
  status text NOT NULL DEFAULT 'processing',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nominal integer NOT NULL,
  transaction_time time without time zone NOT NULL,
  transaction_date date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Jakarta')::date,
  kode_transaksi text,
  ocr_confidence numeric(5,2),
  raw_ocr text,
  video_id uuid REFERENCES public.merchant_videos(id) ON DELETE SET NULL,
  status_match text NOT NULL DEFAULT 'unmatched', -- unmatched|matched|review
  matched_receipt_id uuid REFERENCES public.receipts(id) ON DELETE SET NULL,
  confidence int,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX transactions_dedup_idx
  ON public.transactions (transaction_date, nominal, transaction_time, COALESCE(kode_transaksi,''));
CREATE INDEX transactions_status_idx ON public.transactions (status_match);
CREATE INDEX transactions_date_idx ON public.transactions (transaction_date);

GRANT SELECT,INSERT,UPDATE,DELETE ON public.merchant_videos,public.transactions TO authenticated;
GRANT ALL ON public.merchant_videos,public.transactions TO service_role;
ALTER TABLE public.merchant_videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions   ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mv_auth_all" ON public.merchant_videos FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "tx_auth_all" ON public.transactions   FOR ALL TO authenticated USING (true) WITH CHECK (true);
```

Catatan: `transaction_time` tipe `time` (bukan text) supaya query BETWEEN aman. `ocr_confidence` diisi dari Tesseract per baris. `raw_ocr` menyimpan teks mentah baris tersebut untuk debug tanpa OCR ulang. `processing_time_ms` dihitung client dari mulai extract sampai ingest selesai, dikirim di payload ingest.

## Client-side (`src/lib/video-ocr/`)

- `frameExtractor.ts` — HTMLVideoElement + Canvas 2D, seek adaptif 1s → 0.5s.
- `merchantOcr.ts` — Tesseract.js worker pool concurrency 3–4, whitelist angka+`Rp.:,` + huruf.
- `merchantParser.ts` — line grouping; regex nominal (`Rp\s*([\d.]+)`) + jam (`\b([01]?\d|2[0-3])[.:]([0-5]\d)\b`) + kode opsional; ambil confidence rata-rata token per baris; simpan `raw_ocr` per baris.
- `dedup.ts` — Set by `nominal|HH:mm|kode||''`.
- `scrollSpeed.ts` — kesamaan token antar frame → decide 1/2 fps.
- `pipeline.ts` — orchestrator + event emitter untuk progress: Reading → Extracting Frames → Cropping → OCR → Parsing → Dedup → Sending → Completed. Kirim juga `processing_time_ms`.

Validasi: ≤500 MB, durasi ≤10 menit, MIME mp4/mov/mkv/webm. Video tidak diupload.

Crop area: default top 18% / bottom 12% / left-right 4%, tersimpan di `localStorage`, ada overlay editor di halaman upload.

## Edge Functions

1. `transactions-ingest` — POST `{ video_meta (incl processing_time_ms), transaction_date, transactions: [{nominal, transaction_time, kode_transaksi?, ocr_confidence, raw_ocr}] }`. Insert `merchant_videos`, insert transaksi `ON CONFLICT DO NOTHING`, kembalikan `{ video_id, inserted, duplicates_skipped }`.

2. `auto-match` — POST `{ video_id?, mode: 'preview' | 'apply' }`.
   - Untuk tiap transaksi `unmatched` (scope `video_id` bila ada):
     - Cari receipts pending tanggal sama + `nominal` sama.
     - Δmenit = |transaction_time − receipts.jam_transfer|.
     - Confidence: 100 (Δ=0), 95 (Δ≤2), 90 (Δ≤5).
     - **Aturan aksi**:
       - `confidence=100` **dan** tepat 1 kandidat → kandidat auto-approve.
       - `confidence 95–99` **atau** kandidat >1 → review manual.
       - Selain itu → tetap unmatched.
   - **mode=preview**: hanya kembalikan ringkasan `{ auto_approve: [{transaction_id, receipt_id, confidence}], review: [...], unmatched: [...] }`. TIDAK ubah DB.
   - **mode=apply**: update `receipts.status='approved'` untuk yang auto, update `transactions.status_match`+`matched_receipt_id`+`confidence`, enqueue `send-wa-notification` (queue existing, tidak diubah) hanya untuk auto-approved.

## UI

Menu **Transaksi** dengan sub-route:

- `/admin/transaksi/upload` — dropzone, crop editor overlay, tanggal (default hari ini), tombol Start. Progress realtime 8 tahap + ringkasan (frame terpakai, transaksi terbaca, duplicates, processing time).
  - Setelah ingest selesai → auto call `/auto-match?mode=preview` → tampilkan **Preview Matching Card**: `X akan Auto Approve`, `Y perlu Review`, `Z unmatched`, plus tabel expand. Ada tombol **✔ Terapkan Matching** (call apply) dan **Batal**.
- `/admin/transaksi/riwayat` — tabel transactions + filter tanggal/status/pagination 100. Kolom `ocr_confidence` bisa difilter (`<85` → review manual).
- `/admin/transaksi/matching` — Review Manual: daftar transaksi `review` + kandidat receipt, Approve Manual/Tolak. Tombol "Jalankan Matching (Preview)" & "Match Ulang".
- `/admin/transaksi/history` — daftar `merchant_videos` + statistik (durasi vs `processing_time_ms`).
- **AdminDashboard**: card statistik (Total Video, Total Frame, Transaksi, Matched, Pending Match, Auto Approved Hari Ini, Duplicate, Perlu Review). Bagian receipt existing tidak diubah.
- **Detail Receipt**: panel "Auto Matching Result" (confidence, transaction, video, nominal/jam/kode, `raw_ocr` snippet).

Style dark mode + shadcn + responsive.

## Yang TIDAK disentuh

- `extract-receipt` (OCR Resi)
- `send-wa-notification` + advisory lock queue
- `wa-queue-worker`
- `wa-webhook`
- Approval manual + list receipt di AdminDashboard

## Urutan build

1. Kirim SQL migration final ke user.
2. Buat lib `src/lib/video-ocr/*`.
3. Buat edge function `transactions-ingest` + `auto-match` (support preview & apply).
4. Buat halaman `/admin/transaksi/upload|riwayat|matching|history` + Preview Matching Card + tautan menu.
5. Tambah card statistik di AdminDashboard & panel Auto Matching Result di detail receipt.