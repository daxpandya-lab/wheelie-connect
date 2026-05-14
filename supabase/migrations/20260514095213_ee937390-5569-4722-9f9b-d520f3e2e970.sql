
INSERT INTO storage.buckets (id, name, public)
VALUES ('service-intake-media', 'service-intake-media', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Public read
CREATE POLICY "service-intake-media public read"
ON storage.objects FOR SELECT
USING (bucket_id = 'service-intake-media');

-- Anonymous (public chatbot visitors) can upload
CREATE POLICY "service-intake-media anon upload"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'service-intake-media');
