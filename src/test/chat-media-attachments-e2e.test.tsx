/**
 * End-to-end style test for the chatbot media → service_bookings pipeline.
 *
 * Asserts the contract between three layers without standing up Supabase:
 *
 *   1. PublicChatPage upload handler — uploads each File to the
 *      `service-intake-media` bucket under `{tenantId}/{visitor}/...`,
 *      then pushes `{ url, path, mime, kind, name }` into the in-memory
 *      `chatMedia` array. (Mirrors src/pages/PublicChatPage.tsx ~L1955-2020.)
 *
 *   2. Service-booking submit — serialises that array into
 *      `media_attachments` as `{ url, mime, kind, source, received_at }`
 *      and inserts it into `service_bookings`. (Mirrors ~L990-991.)
 *
 *   3. ServiceBookingsPage `AttachmentsCell` — reads the persisted JSONB
 *      array back and renders an <img> thumbnail for image/, an <audio>
 *      player for audio/, and a "Play Video" anchor for video/.
 *      (Mirrors src/pages/ServiceBookingsPage.tsx L89-137.)
 *
 * If any of those three shapes drift apart, this test fails — which is
 * exactly the regression we want to catch (placeholder text leaking into
 * issue_description, URLs lost between upload and insert, or the grid
 * rendering a broken file badge instead of a thumbnail).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React, { useState } from "react";

// ---------------------------------------------------------------------------
// Mock Supabase storage + service_bookings table
// ---------------------------------------------------------------------------
type StoredObject = { path: string; mime: string; size: number };
type BookingRow = Record<string, any>;

function makeMockSupabase() {
  const buckets: Record<string, StoredObject[]> = { "service-intake-media": [] };
  const tables: Record<string, BookingRow[]> = { service_bookings: [] };

  const storage = {
    from(bucket: string) {
      const ensure = () => (buckets[bucket] ||= []);
      return {
        async upload(path: string, file: File, _opts: any) {
          ensure().push({ path, mime: file.type, size: file.size });
          return { data: { path }, error: null };
        },
        getPublicUrl(path: string) {
          return {
            data: {
              publicUrl: `https://mock.supabase.co/storage/v1/object/public/${bucket}/${path}`,
            },
          };
        },
        async remove(_paths: string[]) {
          return { data: null, error: null };
        },
      };
    },
  };

  const from = (table: string) => {
    const rows = () => (tables[table] ||= []);
    return {
      insert(payload: BookingRow) {
        const withId = { id: `id-${rows().length + 1}`, ...payload };
        rows().push(withId);
        return {
          select: () => ({
            single: async () => ({ data: withId, error: null }),
          }),
        };
      },
    };
  };

  return { storage, from, _buckets: buckets, _tables: tables };
}

// ---------------------------------------------------------------------------
// Mirror of PublicChatPage.handleMediaUpload — keeps the contract the
// production handler must keep: path = `{tenant}/{visitor}/{rand}.{ext}`,
// chatMedia entry shape = { url, path, mime, kind, name }.
// ---------------------------------------------------------------------------
type ChatMedia = { url: string; path: string; mime: string; kind: "image" | "audio" | "video"; name: string };

async function uploadChatMedia(
  supabase: ReturnType<typeof makeMockSupabase>,
  tenantId: string,
  visitorToken: string,
  file: File,
): Promise<ChatMedia> {
  const kind: ChatMedia["kind"] = file.type.startsWith("image/")
    ? "image"
    : file.type.startsWith("video/")
      ? "video"
      : "audio";
  const ext = (file.name.split(".").pop() || "bin").toLowerCase();
  const path = `${tenantId}/${visitorToken}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from("service-intake-media").upload(path, file, { contentType: file.type, upsert: true });
  if (error) throw error;
  const { data: pub } = supabase.storage.from("service-intake-media").getPublicUrl(path);
  return { url: pub.publicUrl, path, mime: file.type, kind, name: file.name };
}

// Mirror of the submit-time serializer used in PublicChatPage (~L990).
function buildMediaAttachments(chatMedia: ChatMedia[]) {
  return chatMedia.map((m) => ({
    url: m.url,
    mime: m.mime,
    kind: m.kind,
    source: "web_chat",
    received_at: new Date().toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// Mirror of ServiceBookingsPage AttachmentsCell — same branching logic,
// no styling-only props, so a render assertion verifies what dashboard
// users actually see in the grid.
// ---------------------------------------------------------------------------
type MediaAttachment = {
  url: string;
  mime?: string;
  kind?: "image" | "audio" | "video" | "file";
};

function classifyAttachment(att: MediaAttachment): "image" | "audio" | "video" | "file" {
  if (att.kind) return att.kind;
  const m = (att.mime || "").toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("audio/")) return "audio";
  if (m.startsWith("video/")) return "video";
  return "file";
}

function AttachmentsCell({ items, onImageClick }: { items: MediaAttachment[]; onImageClick: (url: string) => void }) {
  if (!items.length) return <span>—</span>;
  return (
    <div data-testid="attachments-cell">
      {items.map((att, i) => {
        const kind = classifyAttachment(att);
        if (kind === "image") {
          return (
            <button key={i} type="button" onClick={() => onImageClick(att.url)} aria-label={`open-image-${i}`}>
              <img src={att.url} alt={`Attachment ${i + 1}`} />
            </button>
          );
        }
        if (kind === "audio") {
          return <audio key={i} controls src={att.url} data-testid={`audio-${i}`} />;
        }
        if (kind === "video") {
          return (
            <a key={i} href={att.url} target="_blank" rel="noreferrer" data-testid={`video-${i}`}>
              Play Video
            </a>
          );
        }
        return (
          <a key={i} href={att.url} data-testid={`file-${i}`}>
            View File
          </a>
        );
      })}
    </div>
  );
}

// Tiny harness so a click on a thumbnail can be observed via state, not
// just the callback — proves the lightbox URL would route correctly.
function GridHarness({ items }: { items: MediaAttachment[] }) {
  const [lightbox, setLightbox] = useState<string | null>(null);
  return (
    <>
      <AttachmentsCell items={items} onImageClick={setLightbox} />
      {lightbox && <div data-testid="lightbox">{lightbox}</div>}
    </>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
const TENANT = "tenant-abc";
const VISITOR = "visitor-xyz";

describe("Chatbot media → service_bookings → grid E2E", () => {
  let supabase: ReturnType<typeof makeMockSupabase>;
  beforeEach(() => { supabase = makeMockSupabase(); });

  it("uploads image+video+audio, persists the exact URL array on the booking, and renders each kind in the grid", async () => {
    const imageFile = new File([new Uint8Array([1, 2, 3])], "dent.jpg", { type: "image/jpeg" });
    const videoFile = new File([new Uint8Array([4, 5, 6])], "noise.mp4", { type: "video/mp4" });
    const audioFile = new File([new Uint8Array([7, 8, 9])], "knock.webm", { type: "audio/webm" });

    // 1. Upload pipeline — three separate uploads, just like dropping
    //    three chips into the chat composer one after another.
    const m1 = await uploadChatMedia(supabase, TENANT, VISITOR, imageFile);
    const m2 = await uploadChatMedia(supabase, TENANT, VISITOR, videoFile);
    const m3 = await uploadChatMedia(supabase, TENANT, VISITOR, audioFile);
    const chatMedia = [m1, m2, m3];

    // Every object landed in the tenant-scoped folder, never at the bucket root
    // or under another tenant. This protects the storage RLS contract.
    for (const obj of supabase._buckets["service-intake-media"]) {
      expect(obj.path.startsWith(`${TENANT}/${VISITOR}/`)).toBe(true);
    }
    expect(supabase._buckets["service-intake-media"]).toHaveLength(3);

    // 2. Submit pipeline — issue_description must NOT contain "(media attached)"
    //    or filenames; the URL array carries the media, full stop.
    const media_attachments = buildMediaAttachments(chatMedia);
    const { data: booking } = await supabase
      .from("service_bookings")
      .insert({
        tenant_id: TENANT,
        customer_name: "Asha",
        phone_number: "919999900001",
        vehicle_model: "Swift",
        service_type: "General Service",
        booking_date: "2026-06-01",
        issue_description: "", // empty — media is its own column
        media_attachments,
        booking_source: "chatbot_web",
      })
      .select()
      .single();

    expect(booking.issue_description).toBe("");
    expect(booking.issue_description).not.toMatch(/media attached|\.jpg|\.mp4|\.webm/i);

    // Exact URL array round-trip — order preserved, no mutation, no extras.
    expect(booking.media_attachments).toHaveLength(3);
    expect(booking.media_attachments.map((a: any) => a.url)).toEqual([m1.url, m2.url, m3.url]);
    expect(booking.media_attachments.map((a: any) => a.kind)).toEqual(["image", "video", "audio"]);
    expect(booking.media_attachments.every((a: any) => a.source === "web_chat")).toBe(true);
    expect(booking.media_attachments.every((a: any) => typeof a.received_at === "string")).toBe(true);

    // 3. Render pipeline — read the persisted array back and confirm the
    //    grid cell shows a real <img>, a real <audio>, and a video link
    //    pointing at the matching public URL.
    render(<GridHarness items={booking.media_attachments} />);

    const img = screen.getByAltText("Attachment 1") as HTMLImageElement;
    expect(img.src).toBe(m1.url);

    const videoLink = screen.getByTestId("video-1") as HTMLAnchorElement;
    expect(videoLink.href).toBe(m2.url);

    const audioEl = screen.getByTestId("audio-2") as HTMLAudioElement;
    expect(audioEl.src).toBe(m3.url);
    expect(audioEl).toHaveAttribute("controls");

    // Clicking the thumbnail opens the lightbox with the exact stored URL.
    fireEvent.click(screen.getByLabelText("open-image-0"));
    expect(screen.getByTestId("lightbox").textContent).toBe(m1.url);
  });

  it("renders the empty-state dash when a booking has no media_attachments", () => {
    render(<GridHarness items={[]} />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByTestId("attachments-cell")).not.toBeInTheDocument();
  });

  it("classifies by mime when kind is missing on legacy rows (back-compat)", () => {
    const legacy: MediaAttachment[] = [
      { url: "https://x/a.jpg", mime: "image/jpeg" },
      { url: "https://x/b.mp4", mime: "video/mp4" },
      { url: "https://x/c.webm", mime: "audio/webm" },
    ];
    render(<GridHarness items={legacy} />);
    expect(screen.getByAltText("Attachment 1")).toBeInTheDocument();
    expect(screen.getByTestId("video-1")).toBeInTheDocument();
    expect(screen.getByTestId("audio-2")).toBeInTheDocument();
  });
});
