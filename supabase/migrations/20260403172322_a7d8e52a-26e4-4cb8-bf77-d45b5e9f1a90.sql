CREATE POLICY "Admins can delete receipt_wa_messages"
ON public.receipt_wa_messages
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));