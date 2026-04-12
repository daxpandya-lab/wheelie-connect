
CREATE POLICY "Public can read basic tenant info for chatbot"
ON public.tenants
FOR SELECT
TO anon
USING (status = 'active');
