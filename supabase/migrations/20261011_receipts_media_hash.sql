-- Tambah media_hash ke receipts untuk dedup atomik di level DB
-- Ini mencegah race condition saat 3 webhook paralel masuk untuk 1 gambar yang sama

ALTER TABLE receipts ADD COLUMN IF NOT EXISTS media_hash TEXT;

-- Unique partial index: hanya enforce uniqueness kalau media_hash tidak null
-- (pesan teks / non-gambar boleh NULL)
CREATE UNIQUE INDEX IF NOT EXISTS receipts_media_hash_unique
  ON receipts (media_hash)
  WHERE media_hash IS NOT NULL;
