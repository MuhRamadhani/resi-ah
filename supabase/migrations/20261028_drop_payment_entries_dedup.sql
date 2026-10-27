-- Hapus unique constraint dedup (kode, norek, group_id) di payment_entries
-- Supaya duplikat dari admin yang kirim ulang tetap masuk semua.
ALTER TABLE public.payment_entries
  DROP CONSTRAINT IF EXISTS payment_entries_kode_norek_group_id_key;
