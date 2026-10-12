-- Gambar yang sama dikirim ke beberapa group punya fileSha256 IDENTIK,
-- jadi unique index global pada media_hash memblokir insert untuk group ke-2, ke-3, dst.
-- Akibatnya receipt-nya tersimpan tanpa baris receipt_wa_messages → reaction tidak terkirim.
-- Dedup tetap diperlukan, tapi harus per-group, bukan global.
DROP INDEX IF EXISTS public.receipt_wa_messages_media_hash_unique;

CREATE UNIQUE INDEX IF NOT EXISTS receipt_wa_messages_media_hash_group_unique
  ON public.receipt_wa_messages (media_hash, group_id)
  NULLS NOT DISTINCT
  WHERE media_hash IS NOT NULL;
