
## Scope

Five connected features across DB schema, the public chatbot, the Service Booking dashboard, and the WhatsApp dispatch pipeline.

## 1. Storage + schema

Migration:
- Create public bucket `tenant_invoices` (10 MB cap, `application/pdf` only) with policies: tenant-scoped insert/update/delete via `is_user_tenant`, public read.
- Add `service_bookings.invoice_url text` column (nullable).

## 2. Tenant-branded welcome with two CTAs (chatbot)

In `src/pages/PublicChatPage.tsx`:
- Greeting line already uses `dealer.name` — keep it, reword to `Welcome to {dealer.name} Workshop! How can we assist you today?`.
- Before the flow's first node fires, inject a synthetic "intro" step rendering two quick-reply chips: **📅 Book New Service** and **🔍 View Past Service History**.
  - "Book New Service" → start normal flow (sets `current_node_id` to flow start).
  - "View Past Service History" → ask for phone, then run the existing history-lookup branch (reuse the `wantsHistory` code path).

## 3. Multi-vehicle selector

After the phone-entry node resolves a phone number (existing `fetchReturningCustomer` path):
- Query `service_bookings` for the tenant + phone, select distinct `vehicle_model` + `metadata->>registration` (or `registration_number` if stored in metadata).
- If ≥2 unique vehicles found, render selectable chips for each plus an **🚗 Add a New Vehicle** chip. Selection pre-fills `vehicle_model` / `registration_number` in `collected_data` and skips ahead to the issue step. "Add a New Vehicle" resumes the normal intake.
- If only 0–1 vehicles found, behave as today.

## 4. Manual invoice upload in Job Details modal

In `src/pages/ServiceBookingsPage.tsx` Estimation panel:
- Add labelled file input "Upload Final Invoice (PDF)" with accept=`application/pdf`.
- On select, upload to `tenant_invoices/{tenant_id}/{booking_id}.pdf` (upsert), grab `getPublicUrl`, write `invoice_url` to the booking row, show a "View invoice" link + replace button.

## 5. Auto WhatsApp "Service Ready" dispatch with invoice link

Extend `supabase/functions/mark-service-ready/index.ts` (already triggers on `ready_for_pickup`):
- Select `invoice_url` alongside the booking.
- If present, append `\n\n📄 Final invoice: {invoice_url}` to the WhatsApp body before `dispatchNotification`.
- No new trigger needed — UI already calls this function when status flips.

## 6. Chatbot history download chip

In the existing history reply branch in `PublicChatPage.tsx`:
- When the most recent completed booking has `invoice_url`, append a quick-reply chip **📥 Download Invoice (PDF)** that opens the URL in a new tab (`window.open(url, "_blank", "noopener")`).
- Add an additional intent match for `download bill` / `download invoice` that short-circuits to the invoice chip if available.

## Files touched

- `supabase/migrations/<new>.sql` — bucket + column + policies.
- `src/pages/PublicChatPage.tsx` — welcome chips, multi-vehicle selector, download chip, intent.
- `src/pages/ServiceBookingsPage.tsx` — invoice upload UI.
- `supabase/functions/mark-service-ready/index.ts` — invoice link in body.
- `src/integrations/supabase/types.ts` — regenerated automatically post-migration.

## Out of scope / assumptions

- No changes to the flow_templates JSON; intro chips and vehicle picker are rendered as in-component overlays on top of the existing flow so this works for every tenant immediately.
- `registration_number` is read from `service_bookings.metadata->>'registration_number'` (existing convention).
- Bucket is public-read so the WhatsApp link is openable without auth.
