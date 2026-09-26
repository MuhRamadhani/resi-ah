-- Migration: Add 'sender' type to blocked_identifiers
-- Purpose: Allow blocking by WA sender name (pushName) before upload/OCR
-- 'sender' = block by WA display name (pushName), checked BEFORE upload
-- 'name'   = block by OCR result name, checked AFTER OCR
-- 'phone'  = block by WA phone number, checked BEFORE upload

ALTER TABLE public.blocked_identifiers
  DROP CONSTRAINT blocked_identifiers_type_check,
  ADD CONSTRAINT blocked_identifiers_type_check 
    CHECK (type IN ('name', 'phone', 'sender'));
