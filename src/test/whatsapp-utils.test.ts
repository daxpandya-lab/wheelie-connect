import { describe, it, expect } from "vitest";

// Mirror of detectLanguage() in supabase/functions/whatsapp-webhook/index.ts
type Lang = "en" | "hi" | "ar";
function detectLanguage(text: string): Lang | null {
  if (!text) return null;
  if (/[\u0600-\u06FF\u0750-\u077F]/.test(text)) return "ar";
  if (/[\u0900-\u097F]/.test(text)) return "hi";
  const lower = text.toLowerCase();
  const hiRoman = /\b(namaste|namaskar|kaise|kaisa|kaisi|kya|hai|haan|nahi|nahin|theek|thik|sahi|kar|karo|chahiye|seva|gaadi|service|book karna|krna|krdo|kardo|bhai|bhaiya|aap|tumhara|hamara|hindi|mein|me|mai)\b/;
  if (hiRoman.test(lower)) return "hi";
  return "en";
}

function pickLang(bundle: any, lang: Lang): string {
  if (!bundle) return "";
  if (typeof bundle === "string") return bundle;
  return bundle[lang] || bundle.en || bundle.hi || bundle.ar || "";
}

// Mirror of renderVariables() in supabase/functions/whatsapp-send/index.ts
function renderVariables(text: string, ctx: Record<string, string | null | undefined>): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key) => {
    const v = ctx[key.toLowerCase()];
    return v == null || v === "" ? `{{${key}}}` : String(v);
  });
}

describe("detectLanguage", () => {
  it("detects Arabic", () => expect(detectLanguage("مرحبا")).toBe("ar"));
  it("detects Devanagari Hindi", () => expect(detectLanguage("नमस्ते")).toBe("hi"));
  it("detects romanized Hindi keywords", () => {
    expect(detectLanguage("namaste bhai")).toBe("hi");
    expect(detectLanguage("haan theek hai")).toBe("hi");
  });
  it("defaults to English", () => expect(detectLanguage("Hello there")).toBe("en"));
  it("returns null for empty", () => expect(detectLanguage("")).toBeNull());
});

describe("pickLang", () => {
  it("returns string bundles directly", () => expect(pickLang("hi there", "en")).toBe("hi there"));
  it("returns matching language", () => expect(pickLang({ en: "Hello", hi: "Namaste", ar: "Marhaba" }, "hi")).toBe("Namaste"));
  it("falls back to en when missing", () => expect(pickLang({ en: "Hello" }, "ar")).toBe("Hello"));
  it("returns empty for null/undefined", () => expect(pickLang(null, "en")).toBe(""));
});

describe("renderVariables", () => {
  it("replaces known placeholders", () => {
    const out = renderVariables("Hi {{name}}, your {{vehicle_model}} is ready", {
      name: "Asha",
      vehicle_model: "Swift",
    });
    expect(out).toBe("Hi Asha, your Swift is ready");
  });
  it("preserves unknown placeholders", () => {
    expect(renderVariables("Hi {{name}}, code {{otp}}", { name: "A" })).toBe("Hi A, {{otp}}");
  });
  it("preserves placeholders for empty values", () => {
    expect(renderVariables("Hi {{name}}", { name: "" })).toBe("Hi {{name}}");
  });
  it("is case-insensitive on keys", () => {
    expect(renderVariables("Hi {{Name}}", { name: "B" })).toBe("Hi B");
  });
  it("handles whitespace inside braces", () => {
    expect(renderVariables("Hi {{  name  }}", { name: "C" })).toBe("Hi C");
  });
});

describe("Evolution webhook detection", () => {
  // Mirror of the detector in whatsapp-webhook/index.ts
  function isEvolution(body: any): boolean {
    const evtName = String(body?.event || "");
    return !!body?.instance && (evtName.includes("messages.upsert") || !!body?.data?.key);
  }
  it("detects Evolution payloads", () => {
    expect(isEvolution({ event: "messages.upsert", instance: "x", data: { key: { remoteJid: "1@s.whatsapp.net" } } })).toBe(true);
  });
  it("ignores Meta payloads", () => {
    expect(isEvolution({ object: "whatsapp_business_account", entry: [] })).toBe(false);
  });
  it("requires instance field", () => {
    expect(isEvolution({ event: "messages.upsert", data: { key: {} } })).toBe(false);
  });
});
