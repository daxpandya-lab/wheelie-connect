create table if not exists public.tenant_api_keys (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  token_prefix text not null,
  token_hash text not null unique,
  label text,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists tenant_api_keys_tenant_idx on public.tenant_api_keys(tenant_id);
grant select, insert, update, delete on public.tenant_api_keys to authenticated;
grant all on public.tenant_api_keys to service_role;
alter table public.tenant_api_keys enable row level security;
create policy "Tenant admins read own api keys" on public.tenant_api_keys for select to authenticated
using (public.is_user_tenant(tenant_id) and (public.has_role(auth.uid(),'tenant_admin') or public.has_role(auth.uid(),'super_admin')));
create policy "Tenant admins insert own api keys" on public.tenant_api_keys for insert to authenticated
with check (public.is_user_tenant(tenant_id) and (public.has_role(auth.uid(),'tenant_admin') or public.has_role(auth.uid(),'super_admin')));
create policy "Tenant admins update own api keys" on public.tenant_api_keys for update to authenticated
using (public.is_user_tenant(tenant_id) and (public.has_role(auth.uid(),'tenant_admin') or public.has_role(auth.uid(),'super_admin')));
create policy "Tenant admins delete own api keys" on public.tenant_api_keys for delete to authenticated
using (public.is_user_tenant(tenant_id) and (public.has_role(auth.uid(),'tenant_admin') or public.has_role(auth.uid(),'super_admin')));