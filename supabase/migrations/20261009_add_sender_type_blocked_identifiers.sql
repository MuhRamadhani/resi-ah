-- Tambah type 'sender' ke constraint blocked_identifiers
ALTER TABLE public.blocked_identifiers
  DROP CONSTRAINT IF EXISTS blocked_identifiers_type_check,
  ADD CONSTRAINT blocked_identifiers_type_check
    CHECK (type IN ('name', 'phone', 'sender'));
