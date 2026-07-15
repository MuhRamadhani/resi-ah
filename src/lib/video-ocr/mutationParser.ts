// Parse OCR line output from a Livin' Merchant mutation list
export interface ParsedMutation {
  nominal: number;
  transaction_time: string; // HH:mm
  kode_transaksi?: string;
  raw: string;
  confidence: number;
}

function normalizeNominal(s: string): number {
  const cleaned = s.replace(/[Rr][Pp]\.?\s*/g, "").replace(/[^\d.,]/g, "");
  // Indonesian: '.' is thousand sep, ',' can be decimal. Strip both.
  const digits = cleaned.replace(/[.,]/g, "");
  const n = parseInt(digits, 10);
  return isNaN(n) ? 0 : n;
}

function findTime(text: string): string {
  // Try 24h HH:mm or 12h HH:mm AM/PM
  const m24 = /(\b[012]?\d):([0-5]\d)(?::[0-5]\d)?\b/.exec(text);
  const m12 = /(\d{1,2}):([0-5]\d)\s*([AaPp][Mm])/.exec(text);
  if (m12) {
    let hh = parseInt(m12[1], 10) % 12;
    if (m12[3].toLowerCase() === "pm") hh += 12;
    return `${String(hh).padStart(2, "0")}:${m12[2]}`;
  }
  if (m24) return `${m24[1].padStart(2, "0")}:${m24[2]}`;
  return "";
}

function findCode(text: string): string | undefined {
  const m = /\b([A-Z0-9]{8,})\b/.exec(text.toUpperCase());
  return m ? m[1] : undefined;
}

function findNominal(text: string): number {
  // Look for Rp <number>
  const m = /Rp\.?\s*([\d.,]+)/i.exec(text);
  if (m) return normalizeNominal(m[1]);
  // Fallback: largest number
  const nums = (text.match(/[\d.,]{4,}/g) || [])
    .map((s) => normalizeNominal(s))
    .filter((n) => n >= 100);
  if (nums.length === 0) return 0;
  return Math.max(...nums);
}

export function parseMutationsFromLines(
  lines: Array<{ text: string; confidence: number }>,
): ParsedMutation[] {
  const out: ParsedMutation[] = [];
  // A "mutation" is usually 1-2 consecutive lines: name/desc line + amount/time line
  for (let i = 0; i < lines.length; i++) {
    const combined = (lines[i].text + " " + (lines[i + 1]?.text || "")).replace(/\s+/g, " ");
    const nominal = findNominal(combined);
    const time = findTime(combined);
    if (nominal > 0 && time) {
      out.push({
        nominal,
        transaction_time: time,
        kode_transaksi: findCode(combined),
        raw: combined.trim().slice(0, 300),
        confidence: Math.round((lines[i].confidence + (lines[i + 1]?.confidence || lines[i].confidence)) / 2),
      });
      i++; // consume next
    }
  }
  return out;
}

export function dedupMutations(items: ParsedMutation[]): ParsedMutation[] {
  const map = new Map<string, ParsedMutation>();
  for (const it of items) {
    const key = `${it.nominal}|${it.transaction_time}|${it.kode_transaksi || ""}`;
    const existing = map.get(key);
    if (!existing || it.confidence > existing.confidence) {
      map.set(key, it);
    }
  }
  return Array.from(map.values()).sort((a, b) =>
    a.transaction_time.localeCompare(b.transaction_time),
  );
}
