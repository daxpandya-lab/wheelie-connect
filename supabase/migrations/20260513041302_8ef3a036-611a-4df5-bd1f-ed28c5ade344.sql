-- 1. Add media_attachments column to service_bookings
ALTER TABLE public.service_bookings
  ADD COLUMN IF NOT EXISTS media_attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 2. Public storage bucket for customer-sent media
INSERT INTO storage.buckets (id, name, public)
VALUES ('service_media', 'service_media', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- 3. Storage policies
DROP POLICY IF EXISTS "Service media public read" ON storage.objects;
CREATE POLICY "Service media public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'service_media');

DROP POLICY IF EXISTS "Service media service role write" ON storage.objects;
CREATE POLICY "Service media service role write"
  ON storage.objects FOR INSERT TO service_role
  WITH CHECK (bucket_id = 'service_media');

DROP POLICY IF EXISTS "Service media service role update" ON storage.objects;
CREATE POLICY "Service media service role update"
  ON storage.objects FOR UPDATE TO service_role
  USING (bucket_id = 'service_media');

DROP POLICY IF EXISTS "Service media service role delete" ON storage.objects;
CREATE POLICY "Service media service role delete"
  ON storage.objects FOR DELETE TO service_role
  USING (bucket_id = 'service_media');