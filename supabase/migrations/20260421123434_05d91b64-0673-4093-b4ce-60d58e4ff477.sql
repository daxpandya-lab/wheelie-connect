
CREATE OR REPLACE FUNCTION public.validate_campaign_carousel_mapping()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  _mapping jsonb;
  _key text;
  _card jsonb;
  _var_key text;
  _img_url text;
BEGIN
  IF NEW.audience_filter IS NULL THEN
    RETURN NEW;
  END IF;

  _mapping := NEW.audience_filter -> 'carousel_mapping';

  IF _mapping IS NULL OR jsonb_typeof(_mapping) <> 'object' THEN
    RETURN NEW;
  END IF;

  FOR _key, _card IN SELECT * FROM jsonb_each(_mapping)
  LOOP
    IF jsonb_typeof(_card) <> 'object' THEN
      RAISE EXCEPTION 'Carousel card % must be an object', _key
        USING ERRCODE = 'check_violation';
    END IF;

    _var_key := NULLIF(btrim(COALESCE(_card ->> 'variable_key', '')), '');
    _img_url := NULLIF(btrim(COALESCE(_card ->> 'image_url', '')), '');

    IF _var_key IS NULL THEN
      RAISE EXCEPTION 'Carousel card %: variable_key is required', _key
        USING ERRCODE = 'check_violation';
    END IF;

    IF _img_url IS NULL THEN
      RAISE EXCEPTION 'Carousel card %: image_url is required', _key
        USING ERRCODE = 'check_violation';
    END IF;

    IF _img_url !~ '^https://.+' THEN
      RAISE EXCEPTION 'Carousel card %: image_url must start with https://', _key
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;
