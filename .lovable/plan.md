## 1. Fix upload video "Failed to send request to Edge Function"

Screenshot daftar function menunjukkan hanya `create-groups`, `extract-receipt`, `send-wa-notification`, `wa-queue-worker`, `wa-webhook` yang aktif — `transactions-ingest` dan `auto-match` **belum ter-deploy**, jadi `supabase.functions.invoke("transactions-ingest")` gagal di level jaringan.

**Aksi:**
- Force redeploy `transactions-ingest` dan `auto-match` (touch file agar auto-deploy).
- Jalankan migration untuk memastikan tabel `merchant_videos` & `transactions` ada (idempoten, `CREATE TABLE IF NOT EXISTS` + GRANT + RLS + unique index dedup).
- Setelah deploy, uji ulang tombol **Proses** di `/admin/transaksi`. Kalau masih error, tarik log function untuk diagnosis lanjutan.

## 2. Floating action toolbar di Admin Dashboard

- Bungkus grup tombol aksi (**Refresh**, **OCR All**, **OCR Pilihan** [baru], **Approve Selected**, **Reject Selected**, **Delete Selected**) dalam floating bar `fixed bottom-4 inset-x-4 md:inset-x-auto md:right-6` dengan `z-50`, shadow, dan backdrop blur.
- Muncul selalu — tidak perlu scroll ke atas untuk hapus resi terpilih.
- Menampilkan badge jumlah item terpilih; tombol destructive disable ketika `selected = 0`.
- Padding bawah list ditambah agar tidak tertutup floating bar.

## 3. Tombol OCR Pilihan (baru)

- Tombol baru **OCR Pilihan** di floating bar.
- Aktif hanya jika ada checkbox terpilih.
- Jalankan pipeline Tesseract worker pool (batch 5 konkuren) khusus untuk `selectedIds` yang statusnya belum di-OCR (Nominal = 0).
- Update state lokal per resi — tidak refetch seluruh list.

## 4. Hapus Export CSV

- Hilangkan tombol + handler `exportCsv` dari `AdminDashboard.tsx`.
- Hapus impor util CSV bila tak dipakai di tempat lain.

## 5. Bersih total fitur "Commands"

- Hapus link/tombol menu **Group Commands** dari header `AdminDashboard.tsx`.
- Hapus route `/admin/group-commands` dari `src/App.tsx`.
- Hapus file halaman `src/pages/GroupCommands.tsx`.
- **Tidak** menyentuh `supabase/functions/wa-webhook/index.ts` — logika command di bot WA tetap berjalan lewat webhook (sesuai keinginan user: "Fitur command sebagian besar ada di Wa-webhook").
- Tabel `group_settings` / `group_blacklist` tidak di-drop (bot masih baca), hanya UI-nya yang hilang.

## Yang tidak diubah

- Bot WhatsApp, matching, storage manager, monthly report, create group.
- File auto-generated Supabase.

## Catatan Teknis

- Files diedit: `src/pages/AdminDashboard.tsx`, `src/App.tsx`.
- Files dihapus: `src/pages/GroupCommands.tsx`.
- Files disentuh untuk re-deploy: `supabase/functions/transactions-ingest/index.ts`, `supabase/functions/auto-match/index.ts`.
- Migration baru untuk `merchant_videos` + `transactions` (idempoten).
