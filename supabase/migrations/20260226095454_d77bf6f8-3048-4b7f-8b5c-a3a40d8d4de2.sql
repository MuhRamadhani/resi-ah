
-- Create receipts table
CREATE TABLE public.receipts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  nama TEXT NOT NULL,
  nomor_hp TEXT NOT NULL,
  nominal BIGINT NOT NULL,
  jam_transfer TIME NOT NULL,
  keterangan TEXT NOT NULL,
  image_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Rejected')),
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;

-- Anyone can insert receipts (public upload)
CREATE POLICY "Anyone can upload receipts"
ON public.receipts FOR INSERT
TO anon, authenticated
WITH CHECK (true);

-- Only authenticated users (admins) can view receipts
CREATE POLICY "Authenticated users can view receipts"
ON public.receipts FOR SELECT
TO authenticated
USING (true);

-- Only authenticated users can update receipts (approve/reject)
CREATE POLICY "Authenticated users can update receipts"
ON public.receipts FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- Create user_roles table
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

CREATE POLICY "Users can view own roles"
ON public.user_roles FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Storage bucket for receipt images
INSERT INTO storage.buckets (id, name, public) VALUES ('receipts', 'receipts', true);

-- Anyone can upload to receipts bucket
CREATE POLICY "Anyone can upload receipts"
ON storage.objects FOR INSERT
TO anon, authenticated
WITH CHECK (bucket_id = 'receipts');

-- Anyone can view receipt images
CREATE POLICY "Anyone can view receipt images"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (bucket_id = 'receipts');
