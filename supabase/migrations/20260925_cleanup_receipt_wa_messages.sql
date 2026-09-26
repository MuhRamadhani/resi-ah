-- Migration: Clean up receipt_wa_messages to reduce database size
-- Problem: key_json and message_json contain base64 images (148 MB for 655 rows)
-- Solution: Set JSONB fields to NULL (image already in Storage)

-- Step 1: Set existing JSONB fields to NULL
UPDATE public.receipt_wa_messages
SET 
  key_json = NULL,
  message_json = NULL
WHERE key_json IS NOT NULL OR message_json IS NOT NULL;

-- Step 2: Create function to auto-delete old messages (> 4 days)
CREATE OR REPLACE FUNCTION cleanup_old_receipt_wa_messages()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.receipt_wa_messages
  WHERE created_at < NOW() - INTERVAL '4 days';
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 3: Create scheduled job to run cleanup daily
-- Note: pg_cron extension must be enabled
SELECT cron.schedule(
  'cleanup-old-receipt-wa-messages',
  '0 2 * * *', -- Run at 2 AM daily
  $$SELECT cleanup_old_receipt_wa_messages();$$
);

-- Comments
COMMENT ON FUNCTION cleanup_old_receipt_wa_messages IS 'Auto-delete receipt_wa_messages older than 4 days to save database space';
