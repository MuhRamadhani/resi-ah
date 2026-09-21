-- Find all receipts with image_url in database
-- This will show us which files SHOULD exist in Storage
SELECT 
  id,
  status,
  image_url,
  created_at
FROM receipts
WHERE image_url IS NOT NULL 
  AND image_url != ''
ORDER BY created_at DESC;

-- Count by status
SELECT 
  status,
  COUNT(*) as count
FROM receipts
WHERE image_url IS NOT NULL 
  AND image_url != ''
GROUP BY status;

-- Find Approved receipts that still have images (should be 0 after fix)
SELECT 
  id,
  nama,
  image_url,
  approved_at
FROM receipts
WHERE status = 'Approved'
  AND image_url IS NOT NULL 
  AND image_url != ''
ORDER BY approved_at DESC;
