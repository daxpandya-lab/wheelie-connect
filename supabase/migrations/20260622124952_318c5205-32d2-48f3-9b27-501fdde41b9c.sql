
ALTER TABLE public.service_bookings
  ADD COLUMN IF NOT EXISTS checkin_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS checkin_state text,
  ADD COLUMN IF NOT EXISTS customer_notes text;

CREATE INDEX IF NOT EXISTS idx_service_bookings_checkin_pending
  ON public.service_bookings (tenant_id, booking_date)
  WHERE checkin_sent_at IS NULL;
