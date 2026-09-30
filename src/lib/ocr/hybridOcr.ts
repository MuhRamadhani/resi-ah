// Hybrid OCR: Tesseract.js first, Lovable AI Vision as fallback.
// Provider-based architecture so more providers (OpenAI Vision, Gemini, Claude)
// can be added later without touching consumer code.
import { supabase } from "@/integrations/supabase/client";

export type OcrSource = "TESSERACT" | "LOVABLE_AI" | "9ROUTER";
export type OcrStatus = "OK" | "OCR_FAILED";

export interface OcrFields {
  nominal: number | null;
  jam_transfer: string | null; // HH:MM
  keterangan?: string | null;
  raw_text?: string;
}

export interface OcrOutcome extends OcrFields {
  source: OcrSource | null;
  confidence: number | null;
  status: OcrStatus;
}

export interface OcrProvider {
  name: OcrSource;
  run(input: { imageUrl: string; imageBlob?: Blob }): Promise<OcrFields & { confidence: number | null }>;
}

// ---------- Field validation ----------
export function isValidNominal(n: number | null | undefined): boolean {
  // Accept small nominals (member kadang kirim Rp 100, Rp 700, dst).
  return typeof n === "number" && n >= 1 && n <= 100_000_000;
}
export function isValidJam(j: string | null | undefined): boolean {
  if (!j) return false;
  const m = j.match(/^(\d{2}):(\d{2})/);
  if (!m) return false;
  const h = parseInt(m[1]);
  const mi = parseInt(m[2]);
  if (h === 0 && mi === 0) return false; // 00:00 dianggap gagal
  return h >= 0 && h <= 23 && mi >= 0 && mi <= 59;
}
export function fieldsAreValid(f: OcrFields): boolean {
  return isValidNominal(f.nominal) && isValidJam(f.jam_transfer);
}

// ---------- Tesseract parsing (dipisahkan supaya bisa dites) ----------
function parseNominal(raw: string): number {
  let s = raw.trim().replace(/[.,]\d{2}$/, "").replace(/[.,]/g, "");
  return parseInt(s) || 0;
}

export function parseTesseractText(text: string): OcrFields {
  let nominal: number | null = null;
  let jam_transfer: string | null = null;

  const keywordPatterns = [
    /(?:nominal|jumlah|amount|total)\s*[:\s]*(?:rp\.?\s*)?([0-9][0-9.,]*)/gi,
    /(?:rp\.?\s*)([0-9]{1,3}(?:[.,][0-9]{3})+(?:[.,]\d{2})?)/gi,
    /IDR\s+([0-9][0-9.,]*)/gi,
  ];
  for (const p of keywordPatterns) {
    for (const m of text.matchAll(p)) {
      const n = parseNominal(m[1]);
      if (n >= 1 && n <= 100_000_000) { nominal = n; break; }
    }
    if (nominal) break;
  }
  if (!nominal) {
    const cands: number[] = [];
    for (const m of text.matchAll(/([0-9]{1,3}(?:[.,][0-9]{3})+(?:[.,]\d{2})?)/g)) {
      const n = parseNominal(m[1]);
      if (n >= 1 && n <= 100_000_000) cands.push(n);
    }
    if (cands.length) {
      const freq = new Map<number, number>();
      cands.forEach(n => freq.set(n, (freq.get(n) || 0) + 1));
      const maxF = Math.max(...freq.values());
      nominal = Math.min(...[...freq.entries()].filter(([, f]) => f === maxF).map(([n]) => n));
    }
  }

// Konversi jam 12-jam (AM/PM) ke 24-jam. Input: h (1-12), mi (0-59), period ("AM"|"PM")
function to24h(h: number, mi: number, period?: string): { h: number; mi: number } {
  if (!period) return { h, mi };
  const p = period.toUpperCase().replace(/\./g, "");
  if (p === "AM") {
    return { h: h === 12 ? 0 : h, mi };
  } else { // PM
    return { h: h === 12 ? 12 : h + 12, mi };
  }
}

  const timePatterns = [
    // Format 12-jam: "04:01 PM", "04:01PM", "4:01 AM"
    /(\d{1,2})[:.:](\d{2})(?::\d{2})?\s*(AM|PM|am|pm|A\.M\.|P\.M\.)/g,
    // Format dengan keyword waktu/jam
    /(?:waktu|jam|time|pukul)[:\s]*.*?(\d{1,2})[.:](\d{2})/gi,
    // Format 24-jam biasa
    /(\d{1,2}):(\d{2})(?::\d{2})?/g,
  ];
  for (const p of timePatterns) {
    for (const m of text.matchAll(p)) {
      let h: number, mi: number;
      if (m[3] !== undefined) {
        // Match format 12-jam dengan AM/PM (grup 1=jam, 2=menit, 3=period)
        h = parseInt(m[1]); mi = parseInt(m[2]);
        ({ h, mi } = to24h(h, mi, m[3]));
      } else if (m[2] !== undefined) {
        h = parseInt(m[1]); mi = parseInt(m[2]);
      } else {
        const [hh, mm] = m[1].replace(".", ":").split(":"); h = parseInt(hh); mi = parseInt(mm);
      }
      if (h >= 0 && h <= 23 && mi >= 0 && mi <= 59) {
        jam_transfer = `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
        break;
      }
    }
    if (jam_transfer) break;
  }
  return { nominal, jam_transfer, raw_text: text };
}

// ---------- Providers ----------
const tesseractProvider: OcrProvider = {
  name: "TESSERACT",
  async run({ imageUrl, imageBlob }) {
    const w = (window as any).Tesseract;
    if (!w) throw new Error("Tesseract not loaded");
    let blob = imageBlob;
    if (!blob) {
      const res = await fetch(imageUrl);
      blob = await res.blob();
    }
    const { data } = await w.recognize(blob, "ind+eng");
    const parsed = parseTesseractText(data.text || "");
    return { ...parsed, confidence: Math.round(Number(data.confidence) || 0) };
  },
};

const nineRouterProvider: OcrProvider = {
  name: "9ROUTER",
  async run({ imageUrl }) {
    const { data, error } = await supabase.functions.invoke("ocr-receipt-ai", {
      body: { image_url: imageUrl },
    });
    if (error) throw error;
    if (!data || data.error) throw new Error(data?.error || "ai_failed");
    return {
      nominal: data.nominal ?? null,
      jam_transfer: data.jam ?? null,
      // Gabungkan nama_penerima + keterangan supaya blocked-name check bisa deteksi
      keterangan: [data.nama_penerima, data.keterangan].filter(Boolean).join(" ") || null,
      confidence: typeof data.confidence === "number" ? data.confidence : null,
    };
  },
};

const lovableAiProvider = nineRouterProvider;

// Priority: 9Router directly
const FALLBACK_CHAIN: OcrProvider[] = [nineRouterProvider];

export async function runHybridOcr(imageUrl: string): Promise<OcrOutcome> {
  // 1) Direct to 9Router OCR
  try {
    const r = await nineRouterProvider.run({ imageUrl });
    if (fieldsAreValid(r)) {
      return {
        ...r,
        source: "9ROUTER",
        status: "OK",
      };
    }
  } catch (e) {
    // 9Router gagal, fallback lokal ke Tesseract jika tersedia
  }

  // 2) Optional fallback to Tesseract
  let tesseractResult: (OcrFields & { confidence: number | null }) | null = null;
  try {
    tesseractResult = await tesseractProvider.run({ imageUrl });
    if (fieldsAreValid(tesseractResult)) {
      return {
        ...tesseractResult,
        source: "TESSERACT",
        status: "OK",
      };
    }
  } catch (e) {
    // Tesseract juga gagal
  }

  // 3) All failed
  return {
    nominal: tesseractResult?.nominal ?? null,
    jam_transfer: tesseractResult?.jam_transfer ?? null,
    keterangan: null,
    raw_text: tesseractResult?.raw_text,
    confidence: tesseractResult?.confidence ?? null,
    source: null,
    status: "OCR_FAILED",
  };
}

// AI-only OCR (9Router directly). Use for receipts that already failed OCR.
export async function runAiOcr(imageUrl: string): Promise<OcrOutcome> {
  try {
    const r = await nineRouterProvider.run({ imageUrl });
    if (fieldsAreValid(r)) {
      return { ...r, source: "9ROUTER", status: "OK" };
    }
    return {
      nominal: r.nominal ?? null,
      jam_transfer: r.jam_transfer ?? null,
      keterangan: r.keterangan ?? null,
      confidence: r.confidence ?? null,
      source: "9ROUTER",
      status: "OCR_FAILED",
    };
  } catch (e) {
    return {
      nominal: null, jam_transfer: null, keterangan: null,
      confidence: null, source: null, status: "OCR_FAILED",
    };
  }
}
