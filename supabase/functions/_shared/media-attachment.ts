// Deno-side mirror of src/lib/media-attachment.ts.
// Keep both files in sync — Deno edge functions can't import from src/.

export type MediaKind = "image" | "audio" | "video" | "file";
export type MediaSource = "web_chat" | "whatsapp_meta";

export interface MediaAttachment {
  url: string;
  mime: string;
  kind: MediaKind;
  source: MediaSource;
  received_at: string;
  name?: string;
  booking_id?: string | null;
}

export function classifyMime(mime: string | undefined | null): MediaKind {
  const m = (mime || "").toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("audio/")) return "audio";
  if (m.startsWith("video/")) return "video";
  return "file";
}

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
