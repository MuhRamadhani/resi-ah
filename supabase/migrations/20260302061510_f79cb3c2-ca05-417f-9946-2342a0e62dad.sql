
CREATE TABLE public.receipt_wa_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  receipt_id uuid NOT NULL REFERENCES public.receipts(id) ON DELETE CASCADE,
  wa_message_id text,
  phone text NOT NULL,
  group_id text,
  group_name text,
  is_group boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.receipt_wa_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view receipt_wa_messages"
  ON public.receipt_wa_messages
  FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Service role can insert receipt_wa_messages"
  ON public.receipt_wa_messages
  FOR INSERT
  WITH CHECK (true);
