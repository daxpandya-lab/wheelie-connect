// Unified search helpers used across modules (Service Bookings, Test Drives, Customers, Leads).
// Vehicle numbers can be entered with spaces, dots, or hyphens — normalize them all away
// so that "MH 12 AB-1234" matches "mh12ab1234".
export const normalizeVehicle = (v: string | null | undefined) =>
  (v || "").toLowerCase().replace(/[\s.\-_/]/g, "");

/**
 * Generic free-text matcher. Returns true when the (trimmed) query is empty.
 * - Plain string fields: case-insensitive `includes`.
 * - Vehicle fields (license plate / vehicle number): also checked with `normalizeVehicle`
 *   so spacing/punctuation differences don't break the match.
 */
export function matchesGlobalSearch(opts: {
  query: string;
  text?: Array<string | null | undefined>;
  vehicle?: Array<string | null | undefined>;
}): boolean {
  const q = (opts.query || "").trim();
  if (!q) return true;
  const lower = q.toLowerCase();
  const qNorm = normalizeVehicle(q);
  if (opts.text?.some((v) => (v || "").toLowerCase().includes(lower))) return true;
  if (opts.vehicle?.some((v) => normalizeVehicle(v).includes(qNorm))) return true;
  return false;
}

// Booking source labels — "Web Bot" comes from the embeddable chat URL,
// "WhatsApp Bot" comes from inbound WhatsApp webhook bookings,
// anything explicitly "manual" is dealer-dashboard entry.
export type BotSource = "manual" | "web_bot" | "whatsapp_bot" | "ai_bot";

export function classifyBookingSource(raw: string | null | undefined): BotSource {
  const s = (raw || "").toLowerCase().trim();
  if (!s || s === "manual" || s === "dealer" || s === "dashboard") return "manual";
  if (s.includes("whatsapp") || s.includes("wa_")) return "whatsapp_bot";
  if (s.includes("web") || s.includes("chatbot") || s.includes("ai")) return "web_bot";
  return "ai_bot";
}

export function bookingSourceLabel(raw: string | null | undefined): string {
  switch (classifyBookingSource(raw)) {
    case "whatsapp_bot": return "WhatsApp Bot";
    case "web_bot": return "Web Bot";
    case "ai_bot": return "AI Bot";
    default: return "Manual";
  }
}
