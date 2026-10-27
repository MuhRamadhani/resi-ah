-- Tambah kolom category ke payment_whitelist
-- Nilai: '500k+' (default) atau '<500k'
-- 500k+  → auto-approve berapapun nominal getnya
-- <500k  → auto-approve hanya jika total_get < 500000

ALTER TABLE public.payment_whitelist
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT '500k+';

-- Semua member lama otomatis masuk 500k+
UPDATE public.payment_whitelist
  SET category = '500k+'
  WHERE category IS NULL OR category NOT IN ('500k+', '<500k');

-- Constraint: hanya izinkan dua nilai
ALTER TABLE public.payment_whitelist
  ADD CONSTRAINT payment_whitelist_category_check
  CHECK (category IN ('500k+', '<500k'));
