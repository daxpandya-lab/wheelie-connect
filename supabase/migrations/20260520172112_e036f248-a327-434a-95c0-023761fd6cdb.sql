
-- 1. Public bucket for campaign media
insert into storage.buckets (id, name, public)
values ('campaign-media', 'campaign-media', true)
on conflict (id) do nothing;

-- Public read
create policy "Public read campaign-media"
on storage.objects for select
to public
using (bucket_id = 'campaign-media');

-- Authenticated tenant users can manage files under their tenant folder: {tenant_id}/...
create policy "Tenant users insert campaign-media"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'campaign-media'
  AND (storage.foldername(name))[1] = public.get_user_tenant_id()::text
);

create policy "Tenant users update campaign-media"
on storage.objects for update
to authenticated
using (
  bucket_id = 'campaign-media'
  AND (storage.foldername(name))[1] = public.get_user_tenant_id()::text
);

create policy "Tenant users delete campaign-media"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'campaign-media'
  AND (storage.foldername(name))[1] = public.get_user_tenant_id()::text
);

-- 2. Campaign media columns
alter table public.campaigns
  add column if not exists media_url text,
  add column if not exists media_type text,
  add column if not exists media_filename text;

-- 3. Queue media + link to recipient
alter table public.whatsapp_message_queue
  add column if not exists media_url text,
  add column if not exists media_type text,
  add column if not exists media_filename text,
  add column if not exists campaign_recipient_id uuid;

create index if not exists whatsapp_message_queue_campaign_recipient_idx
  on public.whatsapp_message_queue(campaign_recipient_id);
