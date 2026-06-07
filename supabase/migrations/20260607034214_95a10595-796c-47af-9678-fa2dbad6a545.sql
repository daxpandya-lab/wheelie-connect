
CREATE OR REPLACE FUNCTION public.hash_phone(_tenant_id uuid, _phone text)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  _digits text;
  _salt text;
BEGIN
  _digits := regexp_replace(COALESCE(_phone, ''), '\D', '', 'g');
  IF _digits = '' OR _tenant_id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT value INTO _salt FROM public.app_secrets WHERE key = 'phone_hash_salt';
  IF _salt IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN encode(
    extensions.digest(convert_to(_salt || ':' || _tenant_id::text || ':' || _digits, 'UTF8'), 'sha256'),
    'hex'
  );
END;
$$;
REVOKE ALL ON FUNCTION public.hash_phone(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hash_phone(uuid, text) TO service_role;
