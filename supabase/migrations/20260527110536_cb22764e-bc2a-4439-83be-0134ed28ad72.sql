
ALTER TABLE public.service_bookings
  ADD COLUMN IF NOT EXISTS invoice_url text;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('tenant_invoices', 'tenant_invoices', true, 10485760, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Public read tenant_invoices" ON storage.objects;
CREATE POLICY "Public read tenant_invoices"
ON storage.objects FOR SELECT
USING (bucket_id = 'tenant_invoices');

DROP POLICY IF EXISTS "Tenant users upload tenant_invoices" ON storage.objects;
CREATE POLICY "Tenant users upload tenant_invoices"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'tenant_invoices'
  AND (public.is_user_tenant(((storage.foldername(name))[1])::uuid) OR public.is_super_admin())
);

DROP POLICY IF EXISTS "Tenant users update tenant_invoices" ON storage.objects;
CREATE POLICY "Tenant users update tenant_invoices"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'tenant_invoices'
  AND (public.is_user_tenant(((storage.foldername(name))[1])::uuid) OR public.is_super_admin())
);

DROP POLICY IF EXISTS "Tenant users delete tenant_invoices" ON storage.objects;
CREATE POLICY "Tenant users delete tenant_invoices"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'tenant_invoices'
  AND (public.is_user_tenant(((storage.foldername(name))[1])::uuid) OR public.is_super_admin())
);
