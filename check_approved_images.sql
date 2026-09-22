-- SAFE CLEANUP: Hapus hanya Approved receipts yang masih punya image
-- Step 1: Identifikasi dulu (JANGAN HAPUS dulu)

-- Cek berapa Approved receipts yang masih punya image_url
SELECT 
  COUNT(*) as total_approved_with_images
FROM receipts
WHERE status = 'Approved'
  AND image_url IS NOT NULL 
  AND image_url != '';

-- List 10 Approved receipts pertama yang masih punya image
SELECT 
  id,
  nama,
  nomor_hp,
  nominal,
  image_url,
  approved_at,
  created_at
FROM receipts
WHERE status = 'Approved'
  AND image_url IS NOT NULL 
  AND image_url != ''
ORDER BY approved_at DESC
LIMIT 10;

-- Step 2: Jika ada, extract filename untuk manual delete dari Storage UI
-- Copy paste output ini ke notepad, lalu delete manual dari Supabase Storage UI

-- Step 3: Setelah file dihapus dari Storage, update database
-- UPDATE receipts 
-- SET image_url = '' 
-- WHERE status = 'Approved' 
--   AND image_url IS NOT NULL 
--   AND image_url != '';
