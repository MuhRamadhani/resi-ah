-- Add custom message text columns to notification_settings
-- Run this in Supabase Dashboard → SQL Editor

ALTER TABLE notification_settings
  ADD COLUMN IF NOT EXISTS message_approved text NOT NULL DEFAULT 'Resi Sebesar {nominal} Masuk ✅',
  ADD COLUMN IF NOT EXISTS message_rejected text NOT NULL DEFAULT 'Resi Sebesar {nominal} Tidak Masuk ❌';

-- Update the default row
UPDATE notification_settings
SET
  message_approved = 'Resi Sebesar {nominal} Masuk ✅',
  message_rejected = 'Resi Sebesar {nominal} Tidak Masuk ❌'
WHERE id = 'default';
