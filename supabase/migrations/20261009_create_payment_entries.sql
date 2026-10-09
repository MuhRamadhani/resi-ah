-- Tabel untuk menyimpan payment list yang dikirim admin ke group
CREATE TABLE IF NOT EXISTS public.payment_entries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kode        text NOT NULL,          -- K.AH1221
  tag_raw     text,                   -- teks mentah setelah @ (nama di WA)
  tag_phone   text,                   -- nomor HP hasil konversi dari JID (08xxx)
  tag_jid     text,                   -- JID WhatsApp mentah (62xxx@s.whatsapp.net)
  nama        text,                   -- Nama dari field "Nama :"
  norek       text,                   -- Nomor rekening
  bank        text,                   -- Jenis bank
  total_get   text,                   -- Total get
  potget      text,                   -- Potongan get
  note        text,                   -- Note / keterangan
  raw_text    text,                   -- Raw pesan asli
  group_id    text,                   -- JID group asal
  sender_jid  text,                   -- JID pengirim (admin)
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Index untuk query per kode dan per tanggal
CREATE INDEX IF NOT EXISTS idx_payment_entries_kode       ON public.payment_entries(kode);
CREATE INDEX IF NOT EXISTS idx_payment_entries_created_at ON public.payment_entries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_entries_tag_jid    ON public.payment_entries(tag_jid);

-- RLS: hanya service role yang bisa insert (dari webhook), authenticated bisa baca
ALTER TABLE public.payment_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_insert" ON public.payment_entries
  FOR INSERT TO service_role WITH CHECK (true);

CREATE POLICY "auth_select" ON public.payment_entries
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_delete" ON public.payment_entries
  FOR DELETE TO authenticated USING (true);
