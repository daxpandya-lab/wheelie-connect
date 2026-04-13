
-- Allow anon to insert service bookings for active tenants (public chatbot)
CREATE POLICY "Anon can insert service bookings for active tenants"
ON public.service_bookings
FOR INSERT
TO anon
WITH CHECK (is_tenant_id_active(tenant_id));

-- Allow anon to insert test drive bookings for active tenants (public chatbot)
CREATE POLICY "Anon can insert test drive bookings for active tenants"
ON public.test_drive_bookings
FOR INSERT
TO anon
WITH CHECK (is_tenant_id_active(tenant_id));

-- Allow anon to read active chatbot flows (for public chatbot page)
CREATE POLICY "Anon can read active chatbot flows"
ON public.chatbot_flows
FOR SELECT
TO anon
USING (is_active = true AND is_tenant_id_active(tenant_id));
