// Parse OCR line output for a Livin' Merchant mutation list.
// Layout per mutation (usually 3 lines after threshold+upscale):
//   line A: "<icon> QRIS Statis Rp23.000"
//   line B: "260716 040094286 07:09"
//   line C: "Sudah Cair"

export interface ParsedMutation {
  nominal: number;
  transaction_time: string; // "HH:mm"
  kode_transaksi?: string;
  raw: string;
  confidence: number;
}

function normalizeNominal(s: string): number {
  const cleaned = s.replace(/[Rr][Pp]\.?\s*/g, "").replace(/[^\d.,]/g, "");
  const digits = cleaned.replace(/[.,]/g, "");
  const n = parseInt(digits, 10);
  return isNaN(n) ? 0 : n;
}

function extractNominal(text: string): number {
  const m = /R\s*[pP]\.?\s*([\d.,]{3,})/.exec(text);
  if (m) return normalizeNominal(m[1]);
  return 0;
}

function extractTime(text: string): string {
  // Livin' shows HH:mm (24h). Sometimes the colon is misread as '.' or space.
  const patterns = [
    /\b([01]?\d|2[0-3])[:.\s]([0-5]\d)\b(?!\d)/,
  ];
  for (const p of patterns) {
    const m = p.exec(text);
    if (m) {
      const hh = String(parseInt(m[1], 10)).padStart(2, "0");
      return `${hh}:${m[2]}`;
    }
  }
  return "";
}

function extractCode(text: string): string | undefined {
  // "260716 040094286" style — 6+ digits with optional space groups
  const m = /\b(\d{5,}(?:\s+\d{2,}){0,3})\b/.exec(text);
  if (m) {
    const digits = m[1].replace(/\s+/g, "");
    if (digits.length >= 10) return digits;
  }
  return undefined;
}

export function parseMutationsFromLines(
  lines: Array<{ text: string; confidence: number }>,
): ParsedMutation[] {
  const out: ParsedMutation[] = [];
  for (let i = 0; i < lines.length; i++) {
    const nominal = extractNominal(lines[i].text);
    if (nominal < 100) continue;

    // Look at up to next 3 lines for time & code
    let time = "";
    let code: string | undefined;
    let confSum = lines[i].confidence;
    let confCount = 1;
    let rawParts: string[] = [lines[i].text];

    for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
      const t = lines[j].text;
      // Stop if we hit the next nominal line
      if (extractNominal(t) >= 100 && j !== i) break;
      rawParts.push(t);
      confSum += lines[j].confidence;
      confCount++;
      if (!time) time = extractTime(t);
      if (!code) code = extractCode(t);
      if (time && code) break;
    }

    // Also allow time on same line (rare)
    if (!time) time = extractTime(lines[i].text);

    if (nominal > 0 && time) {
      out.push({
        nominal,
        transaction_time: time,
        kode_transaksi: code,
        raw: rawParts.join(" | ").slice(0, 300),
        confidence: Math.round(confSum / confCount),
      });
    }
  }
  return out;
}

export function dedupMutations(items: ParsedMutation[]): ParsedMutation[] {
  const map = new Map<string, ParsedMutation>();
  for (const it of items) {
    const key = it.kode_transaksi
      ? `code:${it.kode_transaksi}`
      : `${it.nominal}|${it.transaction_time}`;
    const existing = map.get(key);
    if (!existing || it.confidence > existing.confidence) {
      map.set(key, it);
    }
  }
  return Array.from(map.values()).sort((a, b) =>
    a.transaction_time.localeCompare(b.transaction_time),
  );
}

// Shift "HH:mm" by an integer number of hours (signed). Wraps at 24h.
export function shiftTimeHours(hhmm: string, hours: number): string {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  let h = parseInt(m[1], 10) + hours;
  h = ((h % 24) + 24) % 24;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}
