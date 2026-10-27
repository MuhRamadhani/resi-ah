-- Tambah RLS policy UPDATE untuk authenticated di payment_whitelist
-- Sebelumnya hanya ada SELECT, INSERT, DELETE — UPDATE tidak ada
-- sehingga edit whitelist dari dashboard tidak bisa tersimpan.
CREATE POLICY "Allow authenticated update" ON public.payment_whitelist
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);
