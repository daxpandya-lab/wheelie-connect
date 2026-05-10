
ALTER TABLE public.service_bookings
  ADD COLUMN IF NOT EXISTS estimate_amount numeric,
  ADD COLUMN IF NOT EXISTS estimation_sent_at timestamptz;

-- Make sure approval_status default exists
ALTER TABLE public.service_bookings
  ALTER COLUMN approval_status SET DEFAULT 'pending';

-- Allow anon (public web rich card) to read minimal estimate info AND record approval/rejection.
-- Read: public estimate page only needs to fetch a single booking by id; the rest is filtered client-side.
DROP POLICY IF EXISTS "Anon can read estimate booking" ON public.service_bookings;
CREATE POLICY "Anon can read estimate booking"
ON public.service_bookings
FOR SELECT
TO anon
USING (estimation_sent_at IS NOT NULL);

-- Update: anon may only set approval_status to approved/rejected for bookings that have an estimate sent and are still pending.
DROP POLICY IF EXISTS "Anon can respond to estimate" ON public.service_bookings;
CREATE POLICY "Anon can respond to estimate"
ON public.service_bookings
FOR UPDATE
TO anon
USING (estimation_sent_at IS NOT NULL AND COALESCE(approval_status,'pending') = 'pending')
WITH CHECK (approval_status IN ('approved','rejected'));
