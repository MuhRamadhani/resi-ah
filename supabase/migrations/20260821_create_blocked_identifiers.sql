-- Tabel untuk menyimpan daftar nama / nomor HP yang akan otomatis dihapus saat OCR
create table if not exists public.blocked_identifiers (
  id         uuid primary key default gen_random_uuid(),
  type       text not null check (type in ('name', 'phone')),
  value      text not null,
  note       text,
  created_at timestamptz not null default now()
);

-- Index untuk query cepat
create index if not exists blocked_identifiers_type_idx on public.blocked_identifiers (type);

-- RLS: hanya admin yang sudah login bisa akses
alter table public.blocked_identifiers enable row level security;

create policy "Admin can manage blocked_identifiers"
  on public.blocked_identifiers
  for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- Seed: pindahkan data hardcoded lama ke tabel
insert into public.blocked_identifiers (type, value, note) values
  ('name',  'tiqka',          'Pengirim yang sering melakukan penipuan'),
  ('name',  'mutiah',         'Nama terkait Tiqka Mutiah'),
  ('name',  'wahyu',          'Pengirim bermasalah'),
  ('phone', '082352476245',   'Nomor HP Tiqka'),
  ('phone', '081545081942',   'Nomor HP terkait')
on conflict do nothing;
