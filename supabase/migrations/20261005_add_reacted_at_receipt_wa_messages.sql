-- Migration: Add reacted_at column to track sent notifications
-- receipt_wa_messages rows with reacted_at IS NULL = belum terkirim (nyangkut)

ALTER TABLE public.receipt_wa_messages
  ADD COLUMN IF NOT EXISTS reacted_at timestamptz DEFAULT NULL;

COMMENT ON COLUMN public.receipt_wa_messages.reacted_at IS
  'Timestamp when reaction/message was successfully sent. NULL means not yet sent (stuck).';

-- Index for fast stuck-notification queries
CREATE INDEX IF NOT EXISTS idx_receipt_wa_messages_reacted_at
  ON public.receipt_wa_messages(reacted_at)
  WHERE reacted_at IS NULL;
