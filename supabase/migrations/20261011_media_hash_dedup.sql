-- Dedup berdasarkan hash konten media (fileSha256), bukan wa_message_id.
-- Wasender mengirim 1 gambar sebagai 3 pesan dengan wa_message_id BERBEDA,
-- tapi fileSha256-nya sama. Kolom ini jadi kunci dedup yang sebenarnya.
ALTER TABLE public.receipt_wa_messages ADD COLUMN IF NOT EXISTS media_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS receipt_wa_messages_media_hash_unique
  ON public.receipt_wa_messages (media_hash)
  WHERE media_hash IS NOT NULL;
