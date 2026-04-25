-- Backend safeguard: once a chat_session is marked complete, it cannot be re-opened or mutated.
-- This guarantees the frontend will always fall back to the template greeting on revisit.
CREATE OR REPLACE FUNCTION public.prevent_completed_chat_session_updates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.is_complete = true AND NEW.is_complete = true THEN
    -- Allow no-op updates that keep is_complete true but do not change pointers/data
    IF NEW.current_node_id IS DISTINCT FROM OLD.current_node_id
       OR NEW.collected_data IS DISTINCT FROM OLD.collected_data THEN
      RAISE EXCEPTION 'Cannot modify a completed chat session (id=%). Start a new session instead.', OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_completed_chat_session_updates ON public.chat_sessions;
CREATE TRIGGER trg_prevent_completed_chat_session_updates
BEFORE UPDATE ON public.chat_sessions
FOR EACH ROW
EXECUTE FUNCTION public.prevent_completed_chat_session_updates();