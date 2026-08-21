-- Tabel settings notifikasi WA
create table if not exists public.notification_settings (
  id      text primary key default 'default',
  mode    text not null default 'message' check (mode in ('message', 'reaction')),
  reaction_approved  text not null default '❤️',
  reaction_rejected  text not null default '❌',
  updated_at timestamptz not null default now()
);

-- Insert default row
insert into public.notification_settings (id, mode, reaction_approved, reaction_rejected)
values ('default', 'message', '❤️', '❌')
on conflict (id) do nothing;

-- RLS
alter table public.notification_settings enable row level security;
create policy "Admin can manage notification_settings"
  on public.notification_settings for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');
