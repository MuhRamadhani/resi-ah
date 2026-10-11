-- Hapus baris duplikat wa_message_id, pertahankan yang paling lama (created_at terkecil)
DELETE FROM public.receipt_wa_messages a
USING public.receipt_wa_messages b
WHERE a.wa_message_id = b.wa_message_id
  AND a.created_at > b.created_at;

-- Untuk created_at yang sama persis, hapus berdasarkan ctid (internal row id)
DELETE FROM public.receipt_wa_messages a
USING public.receipt_wa_messages b
WHERE a.wa_message_id = b.wa_message_id
  AND a.created_at = b.created_at
  AND a.ctid > b.ctid;

-- Tambah unique constraint agar tidak terjadi lagi
ALTER TABLE public.receipt_wa_messages
  ADD CONSTRAINT receipt_wa_messages_wa_message_id_unique
  UNIQUE (wa_message_id);
