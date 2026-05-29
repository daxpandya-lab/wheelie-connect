-- Tighten write policies on service-intake-media (chatMedia bucket).
-- Reads remain public (by design: dashboard <img>, WhatsApp links).
-- Writes are restricted so a tenant's folder can only be mutated by that tenant
-- (or by anon visitors uploading INTO a real tenant folder via the public chatbot).

-- Drop the existing wide-open insert policy
DROP POLICY IF EXISTS "service-intake-media anon upload" ON storage.objects;

-- INSERT: allow if the first path segment is a real tenant id.
-- Covers both anon (public chatbot) and authenticated dashboard uploads.
CREATE POLICY "service-intake-media tenant-scoped insert"
ON storage.objects FOR INSERT
TO anon, authenticated
WITH CHECK (
  bucket_id = 'service-intake-media'
  AND (storage.foldername(name))[1] IS NOT NULL
  AND public.is_tenant_id_active(((storage.foldername(name))[1])::uuid)
);

-- UPDATE: only authenticated users belonging to the owning tenant
CREATE POLICY "service-intake-media tenant update"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'service-intake-media'
  AND public.is_user_tenant(((storage.foldername(name))[1])::uuid)
)
WITH CHECK (
  bucket_id = 'service-intake-media'
  AND public.is_user_tenant(((storage.foldername(name))[1])::uuid)
);

-- DELETE: only authenticated users belonging to the owning tenant
CREATE POLICY "service-intake-media tenant delete"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'service-intake-media'
  AND public.is_user_tenant(((storage.foldername(name))[1])::uuid)
);

-- Note: SELECT policy "service-intake-media public read" is intentionally left in place
-- so public chatbot media URLs continue working in the dashboard and WhatsApp messages.