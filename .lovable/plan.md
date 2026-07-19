## Rencana Perbaikan Auto Matching

Masalah yang terlihat dari kode saat ini: matching hanya auto-approve kalau **nominal sama + jam persis + kandidat resinya hanya satu**. Kalau ada beberapa resi pending dengan nominal dan jam yang sama, sistem memasukkannya ke review/atau tidak jelas di UI, jadi kelihatan seperti “tidak approve” walaupun datanya sama. Selain itu UI tidak menampilkan alasan kenapa transaksi tidak cocok.

## Yang akan saya ubah

1. **Jadikan aturan waktu sesuai kebutuhan asli**
   - Match utama: nominal sama dan menit sama persis.
   - Dukung beda zona waktu:
     - jam sama persis,
     - transaksi +1 jam,
     - transaksi -1 jam.
   - Tetap tidak auto-approve kalau beda menit.

2. **Perbaiki kasus banyak resi dengan nominal/jam sama**
   - Kalau ada beberapa transaksi video dan beberapa resi pending yang sama nominal + jam, sistem akan memasangkan satu-per-satu.
   - Tidak lagi gagal hanya karena kandidatnya lebih dari satu, selama jumlah transaksi dan resi bisa dipasangkan aman.

3. **Tambahkan alasan hasil matching**
   - Preview akan menampilkan ringkasan debug, misalnya:
     - jumlah transaksi yang dicek,
     - jumlah resi pending,
     - nominal cocok tapi jam beda,
     - jam cocok tapi nominal beda,
     - kandidat dobel,
     - tidak ada resi pending.
   - Jadi bisa kelihatan kenapa nominal 18.000 jam 21:00 belum approve.

4. **Perbaiki UI Auto Matching**
   - Tambahkan daftar contoh hasil:
     - Auto Approve,
     - Review Manual,
     - Tidak Match + alasan.
   - Tombol “Terapkan” tetap hanya approve hasil aman.

5. **Deploy ulang fungsi backend**
   - Setelah perubahan, fungsi `auto-match` akan saya deploy ulang agar halaman live memakai logic baru.

## Teknis

- File backend: `supabase/functions/auto-match/index.ts`
- File UI: `src/pages/AutoMatching.tsx`
- Tidak perlu ubah struktur database dulu.
- Saya sempat coba baca database lewat koneksi yang tersedia, tapi backend sedang timeout dari tool baca, jadi fix akan dibuat dari alur kode dan dibuat lebih transparan lewat preview debug.