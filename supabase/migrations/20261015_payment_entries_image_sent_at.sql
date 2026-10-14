-- Status "Gambar terkirim" untuk payment_entries.
-- Diisi saat gambar bukti + ucapan "Selamat ya kakak @member" berhasil
-- terkirim ke group lewat edge function send-payment-image.
-- Pola sama seperti approved_at: NULL = belum, timestamp = sudah.
ALTER TABLE public.payment_entries
  ADD COLUMN IF NOT EXISTS image_sent_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_payment_entries_image_sent_at
  ON public.payment_entries (image_sent_at);
