-- Migration: Add fields for Evolution API reply support
-- Evolution v1.7.x requires full key and message object for quoted reply

-- Add columns to receipt_wa_messages
ALTER TABLE public.receipt_wa_messages 
ADD COLUMN IF NOT EXISTS remote_jid text,
ADD COLUMN IF NOT EXISTS participant text,
ADD COLUMN IF NOT EXISTS from_me boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS key_json jsonb,
ADD COLUMN IF NOT EXISTS message_json jsonb;

-- Add index for faster lookup
CREATE INDEX IF NOT EXISTS idx_receipt_wa_messages_receipt_id 
ON public.receipt_wa_messages(receipt_id);

-- Comment
COMMENT ON COLUMN public.receipt_wa_messages.remote_jid IS 'Full JID where message was sent (group JID or user JID)';
COMMENT ON COLUMN public.receipt_wa_messages.participant IS 'Sender JID for group messages';
COMMENT ON COLUMN public.receipt_wa_messages.from_me IS 'Whether message was sent by bot';
COMMENT ON COLUMN public.receipt_wa_messages.key_json IS 'Full key object from Evolution webhook (needed for reply)';
COMMENT ON COLUMN public.receipt_wa_messages.message_json IS 'Full message object from Evolution webhook (needed for quoted reply)';