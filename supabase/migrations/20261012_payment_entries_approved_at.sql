-- Status Approved/Pending untuk payment_entries.
-- Diisi saat pesan "Approved ✅" berhasil terkirim ke group — baik otomatis
-- dari wa-webhook (whitelist nomor / note) maupun manual via approve-payment.
ALTER TABLE public.payment_entries
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_payment_entries_approved_at
  ON public.payment_entries (approved_at);
