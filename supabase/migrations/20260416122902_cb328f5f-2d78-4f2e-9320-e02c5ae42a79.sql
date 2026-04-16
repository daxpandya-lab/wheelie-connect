CREATE POLICY "Tenant admins can update their own tenant"
ON public.tenants
FOR UPDATE
TO authenticated
USING (id = get_user_tenant_id())
WITH CHECK (id = get_user_tenant_id());