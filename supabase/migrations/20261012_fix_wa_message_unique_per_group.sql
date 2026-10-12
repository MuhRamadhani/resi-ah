-- Drop unique constraint lama yang hanya berdasarkan wa_message_id saja.
-- Constraint ini memblokir insert untuk group ke-2, ke-3, dst
-- ketika 1 resi yang sama dikirim ke banyak group (wa_message_id sama, group berbeda).
ALTER TABLE public.receipt_wa_messages
  DROP CONSTRAINT IF EXISTS receipt_wa_messages_wa_message_id_unique;

-- Ganti dengan composite unique (wa_message_id, group_id):
-- Pesan yang sama di group berbeda = baris berbeda (diizinkan).
-- Pesan yang sama di group yang sama = duplikat (diblokir).
-- Pakai NULLS NOT DISTINCT agar NULL group_id (DM/personal) juga di-dedup dengan benar.
ALTER TABLE public.receipt_wa_messages
  ADD CONSTRAINT receipt_wa_messages_wa_message_id_group_unique
  UNIQUE NULLS NOT DISTINCT (wa_message_id, group_id);
