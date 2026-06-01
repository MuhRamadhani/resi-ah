
-- Fix: Restrict receipt updates to admins only
DROP POLICY "Authenticated users can update receipts" ON public.receipts;
CREATE POLICY "Admins can update receipts"
ON public.receipts FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Fix: Restrict receipt inserts - keep public but log it's intentional
-- The INSERT policy for receipts is intentionally permissive (public upload form)
-- Drop and recreate with a clearer name
DROP POLICY "Anyone can upload receipts" ON public.receipts;
CREATE POLICY "Public receipt upload"
ON public.receipts FOR INSERT
TO anon, authenticated
WITH CHECK (
  status = 'Pending'
  AND approved_by IS NULL
  AND approved_at IS NULL
);
