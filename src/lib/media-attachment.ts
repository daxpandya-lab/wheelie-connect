/**
 * Unified media-attachment schema used by every ingestion channel
 * (Web bot uploads + WhatsApp webhook uploads).
 *
 * Persisted into `service_bookings.media_attachments` (jsonb[]) and read by
 * the ServiceBookings grid `AttachmentsCell` and the Job Details modal.
 *
 * Keep this file in sync with `supabase/functions/_shared/media-attachment.ts`
 * (Deno can't import from src/, so the edge function ships its own copy).
 */

export type MediaKind = "image" | "audio" | "video" | "file";

/** Allowed provenance values — one per ingestion channel. */
export type MediaSource =
  | "web_chat"            // PublicChatPage upload to `service-intake-media`
  | "whatsapp_evolution"  // Evolution API webhook
  | "whatsapp_meta";      // Meta Cloud API webhook

export interface MediaAttachment {
  url: string;
  mime: string;
  kind: MediaKind;
  source: MediaSource;
  received_at: string;       // ISO timestamp
  name?: string;             // original filename, when known
  booking_id?: string | null; // populated by the webhook when matched
}

export function classifyMime(mime: string | undefined | null): MediaKind {
  const m = (mime || "").toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("audio/")) return "audio";
  if (m.startsWith("video/")) return "video";
  return "file";
}

/**
 * Canonical attachment builder. Every ingestion site MUST go through this
 * so the row written into media_attachments has identical field names,
 * ordering, and defaults regardless of channel.
 */
export function buildMediaAttachment(input: {
  url: string;
  mime: string;
  source: MediaSource;
  name?: string;
  receivedAt?: string;
}): MediaAttachment {
  return {
    url: input.url,
    mime: input.mime,
    kind: classifyMime(input.mime),
    source: input.source,
    received_at: input.receivedAt ?? new Date().toISOString(),
    ...(input.name ? { name: input.name } : {}),
  };
}
