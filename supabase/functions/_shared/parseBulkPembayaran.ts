// Deno-compatible port dari parseBulkPembayaran (tanpa React import)

export interface ParsedEntry {
  kloter: string;    // e.g. "AH1226"
  tanggal: string;   // "YYYY-MM-DD"
  nominal: number;   // total get (nilai bersih)
  adminBank: number; // admin bank (biasanya 0 atau sudah masuk ke nominal)
  potget: number;    // potongan get (Potget :)
  bank: string;
  namaRek: string;
  noRek: string;
  tagRaw: string;    // nama di belakang @ (dari teks)
  tagJid: string;    // JID mentah dari WA
  tagPhone: string;  // nomor HP hasil konversi JID (08xxx)
  note: string;
  raw: string;
  warnings: string[];
}

const BANK_LIST = [
  "BCA","BNI","BRI","Mandiri","CIMB Niaga","Danamon","Permata","BTN","OCBC NISP",
  "Maybank","Panin","BPD Kaltim","SeaBank","Jago","Jenius Pay","BLU","BCA Digital",
  "Krom","Allo Bank","Neo Bank",
];
const EWALLET_LIST = [
  "Dana","GoPay","OVO","ShopeePay","LinkAja","iSaku","DOKU","Sakuku",
];

const ALL_METHODS = [...BANK_LIST, ...EWALLET_LIST];

const BANK_ALIASES: Record<string, string> = {
  "seabank": "SeaBank", "sea bank": "SeaBank", "sea-bank": "SeaBank",
  "seabank indonesia": "SeaBank",
  "bca digital": "BCA Digital", "blu": "BLU", "bca": "BCA",
  "bni": "BNI", "bri": "BRI", "mandiri": "Mandiri",
  "cimb": "CIMB Niaga", "cimb niaga": "CIMB Niaga",
  "jago": "Jago", "krom": "Krom",
  "bpd kaltim": "BPD Kaltim", "kaltim": "BPD Kaltim",
  "bpd kalimantan timur": "BPD Kaltim",
  "dana": "Dana", "gopay": "GoPay", "go pay": "GoPay", "go-pay": "GoPay",
  "gojek": "GoPay",
  "ovo": "OVO", "linkaja": "LinkAja", "link aja": "LinkAja", "link": "LinkAja",
  "shopeepay": "ShopeePay", "shopee pay": "ShopeePay", "shopepay": "ShopeePay",
  "shoppepay": "ShopeePay", "spay": "ShopeePay",
  "mandiri syariah": "Mandiri", "bsi": "BNI",
  "bri syariah": "BRI", "bca syariah": "BCA",
  "isaku": "iSaku", "doku": "DOKU", "sakuku": "Sakuku",
  "jenius": "Jenius Pay", "jenius pay": "Jenius Pay",
};

const MONTHS_ID: Record<string, number> = {
  januari: 1, februari: 2, maret: 3, april: 4, mei: 5, juni: 6,
  juli: 7, agustus: 8, september: 9, oktober: 10, november: 11, desember: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, agu: 8, agt: 8,
  sep: 9, okt: 10, nov: 11, des: 12,
};

function parseTanggal(text: string): string | null {
  const m = text.match(/(\d{1,2})\s+([A-Za-z\u00C0-\u00FF]+)\s+(\d{4})/);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const monthName = m[2].toLowerCase();
  let year = parseInt(m[3], 10);
  const month = MONTHS_ID[monthName];
  if (!month) return null;
  const today = new Date();
  const candidate = new Date(year, month - 1, day);
  const diffDays = (today.getTime() - candidate.getTime()) / 86400000;
  if (diffDays > 60) {
    const candidates = [today.getFullYear() - 1, today.getFullYear(), today.getFullYear() + 1];
    let bestYear = year;
    let bestDiff = Math.abs(diffDays);
    for (const y of candidates) {
      const d = new Date(y, month - 1, day);
      const diff = Math.abs((today.getTime() - d.getTime()) / 86400000);
      if (diff < bestDiff) { bestDiff = diff; bestYear = y; }
    }
    year = bestYear;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseKloter(text: string): string | null {
  const m = text.match(/K?\.?\s*(AH\s*\d+)/i);
  if (!m) return null;
  return m[1].replace(/\s+/g, "").toUpperCase();
}

function parseNominalFromAmount(s: string): number | null {
  const cleaned = s.trim().toLowerCase().replace(/\s+/g, "");
  const jtMatch = cleaned.match(/^([\d,\.]+)jt$/);
  if (jtMatch) {
    const num = parseFloat(jtMatch[1].replace(",", "."));
    if (!isNaN(num)) return Math.round(num * 1_000_000);
  }
  const kMatch = cleaned.match(/^([\d,\.]+)k$/);
  if (kMatch) {
    const num = parseFloat(kMatch[1].replace(",", "."));
    if (!isNaN(num)) return Math.round(num * 1_000);
  }
  const digits = cleaned.replace(/[\.,]/g, "");
  if (/^\d+$/.test(digits)) return parseInt(digits, 10);
  return null;
}

function parseAdminBank(text: string): number {
  // Coba "Admin bank :" dulu, fallback ke "-" = 0
  const m = text.match(/admin\s*bank\s*[:;]\s*([^\n\r]+)/i);
  if (m) {
    const raw = m[1].trim();
    if (!raw || raw === "-") return 0;
    return parseNominalFromAmount(raw) ?? 0;
  }
  return 0;
}

/** Potget / potongan get — field terpisah dari admin bank */
function parsePotget(text: string): number {
  const m = text.match(/pot\s*get\s*[:;]\s*([^\n\r]+)/i);
  if (!m) return 0;
  const raw = m[1].trim();
  if (!raw || raw === "-") return 0;
  return parseNominalFromAmount(raw) ?? 0;
}

function parseNominal(text: string): number | null {
  // "Total get :" = nilai bersih yang sudah dipotong, TIDAK perlu tambah adminBank lagi
  const totalMatch = text.match(/total(?:\s*get)?\s*[:;]\s*([^\n\r]+)/i);
  if (totalMatch) {
    const v = parseNominalFromAmount(totalMatch[1]);
    if (v) return v;
  }
  // Fallback: ambil dari header misal "500K/Day"
  const headerMatch = text.match(/(\d[\d,\.]*\s*(?:jt|k))\s*\/?\s*\d*\s*(?:day|minggu|week|bulan|hari)/i);
  if (headerMatch) {
    const v = parseNominalFromAmount(headerMatch[1]);
    if (v) return v;
  }
  return null;
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 2) return 99;
  const dp: number[] = Array(n + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]; dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[n];
}

function resolveBankName(raw: string): string | null {
  const candidate = raw.trim().toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
  if (!candidate) return null;
  if (BANK_ALIASES[candidate]) return BANK_ALIASES[candidate];
  const exact = ALL_METHODS.find((m) => m.toLowerCase() === candidate);
  if (exact) return exact;
  const first2 = candidate.split(/\s+/).slice(0, 2).join(" ");
  if (BANK_ALIASES[first2]) return BANK_ALIASES[first2];
  const firstWord = candidate.split(/\s+/)[0];
  if (BANK_ALIASES[firstWord]) return BANK_ALIASES[firstWord];
  return null;
}

function parseBank(text: string): string | null {
  const labels = ["jenis\\s*bank", "bank", "via", "pakai", "payment", "pembayaran", "rek(?:ening)?", "no\\.?\\s*rek", "norek"];
  for (const lbl of labels) {
    const re = new RegExp(`(?:${lbl})\\s*[:;]\\s*([^\\n\\r]+)`, "i");
    const m = text.match(re);
    if (m) {
      const resolved = resolveBankName(m[1]);
      if (resolved) return resolved;
    }
  }
  const lower = text.toLowerCase();
  const sorted = [...ALL_METHODS].sort((a, b) => b.length - a.length);
  for (const m of sorted) {
    const re = new RegExp(`\\b${m.replace(/\s+/g, "\\s*")}\\b`, "i");
    if (re.test(lower)) return m;
  }
  const aliases = Object.entries(BANK_ALIASES).sort((a, b) => b[0].length - a[0].length);
  for (const [alias, canonical] of aliases) {
    const re = new RegExp(`\\b${alias.replace(/\s+/g, "\\s*")}\\b`, "i");
    if (re.test(lower)) return canonical;
  }
  const words = lower.split(/[^a-z]+/).filter((w) => w.length >= 3);
  const candidates: { name: string; canonical: string }[] = [
    ...ALL_METHODS.map((n) => ({ name: n.toLowerCase(), canonical: n })),
    ...Object.entries(BANK_ALIASES).map(([a, c]) => ({ name: a, canonical: c })),
  ];
  for (const w of words) {
    for (const c of candidates) {
      if (c.name.includes(" ")) continue;
      if (Math.abs(c.name.length - w.length) > 1) continue;
      if (levenshtein(w, c.name) <= 1) return c.canonical;
    }
  }
  return null;
}

function splitBlocks(text: string): string[] {
  const kloterHeader = /(?:^|\n)\s*(?=\*?K?\.?\s*AH\s*\d+)/g;
  const indices: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = kloterHeader.exec(text)) !== null) {
    indices.push(m.index === 0 ? 0 : m.index + 1);
    if (m.index === kloterHeader.lastIndex) kloterHeader.lastIndex++;
  }
  if (indices.length >= 1) {
    const parts: string[] = [];
    for (let i = 0; i < indices.length; i++) {
      const start = indices[i];
      const end = i + 1 < indices.length ? indices[i + 1] : text.length;
      const slice = text.slice(start, end).trim();
      if (slice) parts.push(slice);
    }
    return parts;
  }
  return text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
}

function preprocessInput(text: string): string {
  // Hapus markdown formatting, dan hapus kurung kotak [] yang dipakai WA untuk @mention
  return text.replace(/[*_~`]/g, "").replace(/\[(@[^\]]+)\]/g, "$1");
}

function cleanName(s: string): string {
  return s.replace(/^a\.?\s*n\.?\s*/i, "").replace(/[,;:\.\*]+$/g, "").trim();
}

function parseNamaRek(text: string): string {
  const lines = text.split(/\r?\n/);
  for (const ln of lines) {
    const m = ln.match(/^\s*nama\s*[:;]?\s*(.+?)\s*$/i);
    if (!m) continue;
    let val = m[1].trim();
    if (!val) continue;
    val = val.replace(/^(rek(?:ening)?|penerima)\s*[:;]?\s*/i, "");
    val = cleanName(val);
    if (val) return val;
  }
  return "";
}

function parseNoRek(text: string): string {
  const lines = text.split(/\r?\n/);
  // Label yang umum dipakai: "Rekening :", "No. Rek :", "No Rek:", "NoRek:", "No. HP:", dll.
  const labelRe = /^\s*(?:no\.?\s*rek(?:ening)?|norek|rekening|no\.?\s*hp|no|nomor)\s*[:;]?\s*(.+?)\s*$/i;
  for (const ln of lines) {
    const m = ln.match(labelRe);
    if (!m) continue;
    const digits = m[1].replace(/\D/g, "");
    if (digits.length >= 6) return digits;
  }
  // Fallback inline regex
  const labels = [
    /no\.?\s*rek\s*[:;]\s*([^\n\r]+)/i,
    /norek\s*[:;]\s*([^\n\r]+)/i,
    /rekening\s*[:;]\s*([^\n\r]+)/i,
  ];
  for (const re of labels) {
    const m = text.match(re);
    if (!m) continue;
    const digits = m[1].replace(/\D/g, "");
    if (digits.length >= 6) return digits;
  }
  return "";
}

function parseNote(text: string): string {
  const m = text.match(/note\s*[:;]\s*([^\n\r]+)/i);
  if (!m) return "";
  const val = m[1].trim();
  return /^[-–—⏰🆑]*$/.test(val) ? "" : val;
}

function titleCase(s: string): string {
  return s.toLowerCase().split(/\s+/).map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
}

const EWALLET_NAMES = new Set(EWALLET_LIST.map((e) => e.toLowerCase()));

function isEwallet(bank: string): boolean {
  return EWALLET_NAMES.has(bank.toLowerCase());
}

/** Konversi JID (62xxx@s.whatsapp.net) ke nomor HP lokal (08xxx) */
export function jidToPhone(jid: string): string {
  if (!jid) return "";
  const digits = jid.replace(/@.+$/, "").replace(/[^0-9]/g, "");
  if (digits.startsWith("62")) return "0" + digits.slice(2);
  return digits;
}

/** Ambil semua mentionedJid dari berbagai lokasi struktur pesan Evolution.
 *  Juga coba ambil versi @s.whatsapp.net dari participantAlt jika ada. */
export function collectMentionedJids(message: any): string[] {
  if (!message) return [];
  const out: string[] = [];
  const push = (arr: unknown) => {
    if (Array.isArray(arr)) for (const v of arr) if (typeof v === "string") out.push(v);
  };
  push(message.contextInfo?.mentionedJid);
  push(message.extendedTextMessage?.contextInfo?.mentionedJid);
  push(message.imageMessage?.contextInfo?.mentionedJid);
  push(message.videoMessage?.contextInfo?.mentionedJid);
  // nested wrappers
  const wrapped = message.ephemeralMessage?.message || message.viewOnceMessage?.message || null;
  if (wrapped) out.push(...collectMentionedJids(wrapped));
  return out;
}

export function parseBulkPayment(text: string, mentionedJids: string[] = []): ParsedEntry[] {
  const cleaned = preprocessInput(text);
  const today = new Date().toISOString().split("T")[0];
  const results: ParsedEntry[] = [];

  const blocks = splitBlocks(cleaned);

  // Track jumlah @ yang sudah dilewati untuk mapping ke mentionedJids
  let globalAtCount = 0;

  for (const block of blocks) {
    // Skip blok yang tidak dimulai dengan K.AHxxxx di baris pertama
    const firstLine = block.split("\n")[0].replace(/[*_~`]/g, "").trim();
    if (!/^K\.AH\d+/i.test(firstLine)) continue;

    // ── Filter ketat: format valid WAJIB punya Total get + Nama + Rekening ──
    // Tanpa ketiganya ini bukan payment list, bisa jadi pesan random yang kebetulan ada K.AH
    const hasTotalGet  = /total\s*get\s*[:;]/i.test(block);
    const hasNama      = /\bnama\s*[:;]/i.test(block);
    const hasRekening  = /(?:rekening|no\.?\s*rek|norek)\s*[:;]/i.test(block);
    if (!hasTotalGet || !hasNama || !hasRekening) continue;

    const kloter = parseKloter(block);
    const tanggal = parseTanggal(block);
    const nominal = parseNominal(block);
    const adminBank = parseAdminBank(block);
    const potget = parsePotget(block);
    let bank = parseBank(block);
    let namaRek = parseNamaRek(block);
    let noRek = parseNoRek(block);
    const note = parseNote(block);

    // Tag member: strip baris CC terlebih dahulu, lalu cari baris yang dimulai @
    const lines = block.split("\n").map((l) => l.trim());
    // Filter baris CC dari pencarian tagLine (CC : @xxx @yyy)
    const nonCcLines = lines.filter((l) => !/^\s*cc\s*:/i.test(l));
    const tagLineIdx = nonCcLines.findIndex((l) => l.startsWith("@"));
    const tagLine = tagLineIdx >= 0 ? nonCcLines[tagLineIdx] : undefined;
    const tagRaw = tagLine ? tagLine.replace(/^@/, "").trim() : "";

    // tagJid: karena mentionedJids dari WA tidak reliable (bisa berisi riwayat mention),
    // kita tidak bisa mapping by index. Simpan tagJid kosong — resolve di webhook via LID API
    // dengan cara berbeda (resolve semua LID, cocokkan dengan tagRaw digits).
    const tagJid = "";

    // Hitung semua @ di blok ini untuk update counter (tetap track untuk kompatibilitas)
    const atCount = (block.match(/@/g) || []).length;
    globalAtCount += atCount;

    if (!kloter && !tanggal && !nominal && !bank && !noRek && !namaRek) continue;

    // Minimal harus ada nominal DAN (nama ATAU noRek) agar layak disimpan
    if (!nominal && !namaRek && !noRek) continue;

    const warnings: string[] = [];
    if (!kloter) warnings.push("Kloter tidak terdeteksi");
    if (!tanggal) warnings.push("Tanggal tidak terdeteksi");
    if (!nominal) warnings.push("Nominal tidak terdeteksi");
    if (!bank) warnings.push("Bank tidak terdeteksi");
    if (!noRek) warnings.push("No rek tidak terdeteksi");
    if (!namaRek) warnings.push("Nama tidak terdeteksi");

    if (namaRek) namaRek = titleCase(namaRek);

    // Resolusi tagPhone:
    // 1. Coba dari JID dulu (jika bukan @lid format)
    // 2. Fallback: jika bank e-wallet (Dana/GoPay/dll), noRek IS nomor HP
    let tagPhone = "";
    if (tagJid && !tagJid.includes("@lid")) {
      tagPhone = jidToPhone(tagJid);
    }
    if (!tagPhone && noRek && bank && isEwallet(bank)) {
      // noRek e-wallet = nomor HP, normalisasi ke 08xxx
      const digits = noRek.replace(/\D/g, "");
      tagPhone = digits.startsWith("62") ? "0" + digits.slice(2) : digits.startsWith("0") ? digits : "";
    }

    results.push({
      kloter: kloter ?? "",
      tanggal: tanggal ?? today,
      nominal: nominal ?? 0,
      adminBank,
      potget,
      bank: bank ?? "",
      namaRek,
      noRek,
      tagRaw,
      tagJid,
      tagPhone,
      note,
      raw: block,
      warnings,
    });
  }

  return results;
}
