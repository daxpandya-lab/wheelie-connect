// Shared helpers for outbound Evolution API traffic:
//   • cleanPhoneNumber(): strips +, spaces, dashes and prepends default country
//     code (India = 91) so Baileys accepts the recipient JID.
//   • sendPresence(): fires a "composing" indicator on the recipient chat.
//   • humanTypingDelayMs(): Gaussian-jitter delay between 3–6s scaled by
//     message length, so outbound bot replies look human-timed.
//   • sleep(): tiny helper.

export function cleanPhoneNumber(raw: string | null | undefined, defaultCountryCode = "91"): string {
  if (!raw) return "";
  let digits = String(raw).replace(/\D+/g, "");
  if (!digits) return "";
  // Strip leading zeros (e.g. "09876..." → "9876...")
  digits = digits.replace(/^0+/, "");
  // Local Indian mobile numbers arrive as 10 digits — prepend CC.
  if (digits.length === 10) digits = defaultCountryCode + digits;
  return digits;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Box–Muller Gaussian sample, clamped to [3000, 6000] ms.
 * Longer messages sit slightly longer in the queue, mimicking real typing.
 */
export function humanTypingDelayMs(text: string | null | undefined): number {
  const len = (text || "").length;
  const u1 = Math.random() || 1e-9;
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const mean = 3800 + Math.min(1800, len * 8); // 3.8s..5.6s baseline
  const jitter = z * 500;
  const ms = Math.round(mean + jitter);
  return Math.max(3000, Math.min(6000, ms));
}

export async function sendPresence(
  evoUrl: string,
  instance: string,
  apiKey: string,
  cleanedNumber: string,
): Promise<void> {
  if (!evoUrl || !instance || !apiKey || !cleanedNumber) return;
  try {
    await fetch(`${evoUrl.replace(/\/+$/, "")}/chat/sendPresence/${encodeURIComponent(instance)}`, {
      method: "POST",
      headers: { apikey: apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ presence: "composing", number: cleanedNumber, delay: 1200 }),
    });
  } catch (e) {
    console.warn("[wa-evolution] sendPresence failed", String(e).slice(0, 200));
  }
}
