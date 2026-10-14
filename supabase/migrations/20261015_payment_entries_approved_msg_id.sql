-- Simpan msgId numerik dari pesan "Approved ✅" yang dikirim ke group.
--
-- Wasender DELETE /api/messages/{msgId} MEWAJIBKAN msgId numerik yang
-- dikembalikan endpoint send-message — bukan key.id WhatsApp. Tanpa kolom ini
-- pesan Approved tidak mungkin dihapus lagi setelah terkirim.
--
-- Diisi oleh wa-webhook (auto-approve whitelist) dan approve-payment (manual).
-- NULL berarti pesan Approved dikirim sebelum kolom ini ada, atau belum pernah
-- di-approve — dua-duanya tidak bisa dihapus otomatis.
ALTER TABLE public.payment_entries
  ADD COLUMN IF NOT EXISTS approved_msg_id BIGINT;

-- Lookup saat webhook messages.delete masuk: cari entri dari key.id pesan
-- payment aslinya. Tanpa index ini tiap event delete jadi full table scan.
CREATE INDEX IF NOT EXISTS idx_payment_entries_key_json_id
  ON public.payment_entries ((key_json->>'id'));
