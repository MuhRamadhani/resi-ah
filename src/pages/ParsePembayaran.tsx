import { useState, useCallback } from "react";
import AdminSidebar from "@/components/AdminSidebar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ClipboardPaste, Trash2, CheckCircle2, AlertTriangle, Copy, Menu, X } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

// ─────────────────────────────────────────────────────────────
// Parser (port TypeScript dari parseBulkPembayaran.ts)
// ─────────────────────────────────────────────────────────────

interface ParsedEntry {
  kloter: string;
  tanggal: string;
  nominal: number;   // Total get (nilai bersih)
  adminBank: number; // Admin bank
  potget: number;    // Potget / potongan get
  bank: string;
  namaRek: string;
  noRek: string;
  tagRaw: string;
  tagPhone: string;
  note: string;
  raw: string;
  warnings: string[];
}

const BANK_ALIASES: Record<string, string> = {
  seabank: "SeaBank", "sea bank": "SeaBank", "bca digital": "BCA Digital",
  blu: "BLU", bca: "BCA", bni: "BNI", bri: "BRI", mandiri: "Mandiri",
  cimb: "CIMB Niaga", "cimb niaga": "CIMB Niaga", jago: "Jago", krom: "Krom",
  dana: "Dana", gopay: "GoPay", "go pay": "GoPay", gojek: "GoPay",
  ovo: "OVO", linkaja: "LinkAja", "link aja": "LinkAja",
  shopeepay: "ShopeePay", "shopee pay": "ShopeePay", shopepay: "ShopeePay",
  shoppepay: "ShopeePay", spay: "ShopeePay",
  jenius: "Jenius Pay", "jenius pay": "Jenius Pay",
  isaku: "iSaku", doku: "DOKU", sakuku: "Sakuku",
  "bpd kaltim": "BPD Kaltim", kaltim: "BPD Kaltim",
  "mandiri syariah": "Mandiri", bsi: "BNI", "bri syariah": "BRI",
};
const ALL_METHODS = [
  "BCA","BNI","BRI","Mandiri","CIMB Niaga","Danamon","Permata","BTN","OCBC NISP",
  "Maybank","Panin","BPD Kaltim","SeaBank","Jago","Jenius Pay","BLU","BCA Digital",
  "Krom","Allo Bank","Neo Bank",
  "Dana","GoPay","OVO","ShopeePay","LinkAja","iSaku","DOKU","Sakuku",
];
const EWALLET_SET = new Set(["dana","gopay","ovo","shopeepay","linkaja","isaku","doku","sakuku"]);
const MONTHS_ID: Record<string,number> = {
  januari:1,februari:2,maret:3,april:4,mei:5,juni:6,juli:7,agustus:8,
  september:9,oktober:10,november:11,desember:12,
  jan:1,feb:2,mar:3,apr:4,jun:6,jul:7,agu:8,agt:8,sep:9,okt:10,nov:11,des:12,
};

function parseTanggal(text: string): string | null {
  const m = text.match(/(\d{1,2})\s+([A-Za-z\u00C0-\u00FF]+)\s+(\d{4})/);
  if (!m) return null;
  const day = parseInt(m[1]);
  const month = MONTHS_ID[m[2].toLowerCase()];
  if (!month) return null;
  let year = parseInt(m[3]);
  const today = new Date();
  const diff = (today.getTime() - new Date(year, month-1, day).getTime()) / 86400000;
  if (diff > 60) {
    let best = year, bestDiff = Math.abs(diff);
    for (const y of [today.getFullYear()-1, today.getFullYear(), today.getFullYear()+1]) {
      const d = Math.abs((today.getTime() - new Date(y,month-1,day).getTime()) / 86400000);
      if (d < bestDiff) { bestDiff = d; best = y; }
    }
    year = best;
  }
  return `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
}
function parseKloter(text: string): string | null {
  const m = text.match(/K?\.?\s*(AH\s*\d+)/i);
  return m ? m[1].replace(/\s+/g,"").toUpperCase() : null;
}
function parseNominalRaw(s: string): number | null {
  const c = s.trim().toLowerCase().replace(/\s+/g,"");
  const jt = c.match(/^([\d,\.]+)jt$/);
  if (jt) return Math.round(parseFloat(jt[1].replace(",",".")) * 1_000_000);
  const k = c.match(/^([\d,\.]+)k$/);
  if (k) return Math.round(parseFloat(k[1].replace(",",".")) * 1_000);
  const d = c.replace(/[.,]/g,"");
  return /^\d+$/.test(d) ? parseInt(d) : null;
}
function parseNominal(text: string): number | null {
  // "Total get :" = nilai bersih, TIDAK tambah admin bank
  const tm = text.match(/total(?:\s*get)?\s*[:;]\s*([^\n\r]+)/i);
  if (tm) { const v = parseNominalRaw(tm[1]); if (v) return v; }
  // Fallback: header "500K/Day"
  const hm = text.match(/([\d,\.]+\s*(?:jt|k))\s*\/?\s*\d*\s*(?:day|minggu|week|bulan|hari)/i);
  if (hm) { const v = parseNominalRaw(hm[1]); if (v) return v; }
  return null;
}
function parseAdminBank(text: string): number {
  const m = text.match(/admin\s*bank\s*[:;]\s*([^\n\r]+)/i);
  if (!m) return 0;
  const raw = m[1].trim();
  if (!raw || raw === "-") return 0;
  return parseNominalRaw(raw) ?? 0;
}
function parsePotget(text: string): number {
  const m = text.match(/pot\s*get\s*[:;]\s*([^\n\r]+)/i);
  if (!m) return 0;
  const raw = m[1].trim();
  if (!raw || raw === "-") return 0;
  return parseNominalRaw(raw) ?? 0;
}
function resolveBank(raw: string): string | null {
  const c = raw.trim().toLowerCase().replace(/[^a-z0-9 ]/g,"").trim();
  if (!c) return null;
  if (BANK_ALIASES[c]) return BANK_ALIASES[c];
  const exact = ALL_METHODS.find(m => m.toLowerCase() === c);
  if (exact) return exact;
  const fw = c.split(/\s+/)[0];
  if (BANK_ALIASES[fw]) return BANK_ALIASES[fw];
  return null;
}
function parseBank(text: string): string | null {
  for (const lbl of ["jenis\\s*bank","bank","via","rek(?:ening)?"]) {
    const m = text.match(new RegExp(`(?:${lbl})\\s*[:;]\\s*([^\\n\\r]+)`,"i"));
    if (m) { const r = resolveBank(m[1]); if (r) return r; }
  }
  const lower = text.toLowerCase();
  for (const m of [...ALL_METHODS].sort((a,b) => b.length-a.length)) {
    if (new RegExp(`\\b${m.replace(/\s+/g,"\\s*")}\\b`,"i").test(lower)) return m;
  }
  return null;
}
function parseNamaRek(text: string): string {
  for (const ln of text.split(/\r?\n/)) {
    const m = ln.match(/^\s*nama\s*[:;]?\s*(.+?)\s*$/i);
    if (m) {
      let v = m[1].trim().replace(/^(rek(?:ening)?|penerima)\s*[:;]?\s*/i,"").replace(/^a\.?n\.?\s*/i,"").replace(/[,;:.]+$/,"").trim();
      if (v) return v.toLowerCase().split(/\s+/).map(w => w ? w[0].toUpperCase()+w.slice(1) : w).join(" ");
    }
  }
  return "";
}
function parseNoRek(text: string): string {
  for (const ln of text.split(/\r?\n/)) {
    // "Rekening :", "No. Rek :", "No Rek:", "NoRek:", "No. HP:", "Nomor :"
    const m = ln.match(/^\s*(?:no\.?\s*rek(?:ening)?|norek|rekening|no\.?\s*hp|nomor)\s*[:;]?\s*(.+?)\s*$/i);
    if (m) { const d = m[1].replace(/\D/g,""); if (d.length >= 6) return d; }
  }
  // Fallback inline
  for (const re of [/no\.?\s*rek\s*[:;]\s*([^\n\r]+)/i, /norek\s*[:;]\s*([^\n\r]+)/i, /rekening\s*[:;]\s*([^\n\r]+)/i]) {
    const m = text.match(re);
    if (m) { const d = m[1].replace(/\D/g,""); if (d.length >= 6) return d; }
  }
  return "";
}
function parseNote(text: string): string {
  const m = text.match(/note\s*[:;]\s*([^\n\r]+)/i);
  if (!m) return "";
  const v = m[1].trim();
  return /^[-–—⏰🆑CL]*$/.test(v) ? "" : v;
}
function parseTagRaw(block: string): string {
  const lines = block.split("\n").map(l => l.trim());
  // Cari baris @ yang bukan CC
  const tagLine = lines.find(l => l.startsWith("@") && !/cc\s*:/i.test(l));
  return tagLine ? tagLine.replace(/^@/,"").split(/[|\s]/)[0].trim() : "";
}
function tagRawToPhone(tagRaw: string, noRek: string, bank: string): string {
  // tagRaw biasanya nama (bukan JID) — tidak bisa konversi ke nomor HP tanpa JID
  // Fallback: kalau e-wallet, noRek = nomor HP
  if (noRek && bank && EWALLET_SET.has(bank.toLowerCase())) {
    const d = noRek.replace(/\D/g,"");
    if (d.startsWith("62")) return "0"+d.slice(2);
    if (d.startsWith("0")) return d;
  }
  return "";
}
function splitBlocks(text: string): string[] {
  const indices: number[] = [];
  const re = /(?:^|\n)\s*(?=\*?K?\.?\s*AH\s*\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    indices.push(m.index === 0 ? 0 : m.index+1);
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  if (indices.length >= 1) {
    return indices.map((s,i) => {
      const e = i+1 < indices.length ? indices[i+1] : text.length;
      return text.slice(s,e).trim();
    }).filter(Boolean);
  }
  return text.split(/\n\s*\n/).map(b=>b.trim()).filter(Boolean);
}

function parseBulkPayment(text: string): ParsedEntry[] {
  // Strip markdown + hapus kurung kotak WA [@mention] → @mention
  const cleaned = text.replace(/[*_~`]/g,"").replace(/\[(@[^\]]+)\]/g,"$1");
  const today = new Date().toISOString().split("T")[0];
  const results: ParsedEntry[] = [];
  for (const block of splitBlocks(cleaned)) {
    const firstLine = block.split("\n")[0].replace(/[*_~`]/g,"").trim();
    if (!/^K\.AH\d+/i.test(firstLine)) continue;
    const kloter = parseKloter(block);
    const tanggal = parseTanggal(block);
    const nominal = parseNominal(block);
    const adminBank = parseAdminBank(block);
    const potget = parsePotget(block);
    const bank = parseBank(block);
    const namaRek = parseNamaRek(block);
    const noRek = parseNoRek(block);
    const note = parseNote(block);
    const tagRaw = parseTagRaw(block);
    const tagPhone = tagRawToPhone(tagRaw, noRek, bank ?? "");
    const warnings: string[] = [];
    if (!kloter) warnings.push("Kloter tidak terdeteksi");
    if (!tanggal) warnings.push("Tanggal tidak terdeteksi");
    if (!nominal) warnings.push("Nominal tidak terdeteksi");
    if (!bank) warnings.push("Bank tidak terdeteksi");
    if (!noRek) warnings.push("No. rek tidak terdeteksi");
    if (!namaRek) warnings.push("Nama tidak terdeteksi");
    if (tagRaw && !tagPhone) warnings.push("Nomor HP @tag tidak terdeteksi (perlu JID dari WA)");
    if (!kloter && !tanggal && !nominal && !bank && !noRek && !namaRek) continue;
    results.push({ kloter:kloter??"", tanggal:tanggal??today, nominal:nominal??0, adminBank, potget, bank:bank??"", namaRek, noRek, tagRaw, tagPhone, note, raw:block, warnings });
  }
  return results;
}

function fmt(n: number) { return n.toLocaleString("id-ID"); }

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────
export default function ParsePembayaran() {
  const [input, setInput] = useState("");
  const [results, setResults] = useState<ParsedEntry[]>([]);
  const [parsed, setParsed] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const handleParse = useCallback(() => {
    const r = parseBulkPayment(input);
    setResults(r);
    setParsed(true);
  }, [input]);

  const handlePaste = async () => {
    try {
      const t = await navigator.clipboard.readText();
      setInput(t);
    } catch { /* user denied */ }
  };

  const copyRow = (entry: ParsedEntry, idx: number) => {
    const text = [
      `Kloter   : ${entry.kloter}`,
      `Tanggal  : ${entry.tanggal}`,
      `Nominal  : Rp ${fmt(entry.nominal)}`,
      entry.potget > 0 ? `Potget   : Rp ${fmt(entry.potget)}` : "",
      entry.adminBank > 0 ? `Admin Bk : Rp ${fmt(entry.adminBank)}` : "",
      `Bank     : ${entry.bank}`,
      `Nama     : ${entry.namaRek}`,
      `No. Rek  : ${entry.noRek}`,
      `Tag      : @${entry.tagRaw}${entry.tagPhone ? ` (${entry.tagPhone})` : ""}`,
      entry.note ? `Note     : ${entry.note}` : "",
    ].filter(Boolean).join("\n");
    navigator.clipboard.writeText(text);
    setCopied(idx);
    setTimeout(() => setCopied(null), 1500);
  };

  const totalNominal = results.reduce((s, r) => s + r.nominal, 0);
  const totalOk = results.filter(r => r.warnings.length === 0).length;

  return (
    <div className="flex h-screen bg-[#0a0e1a] text-white overflow-hidden">
      <AdminSidebar />

      <div className="flex-1 flex flex-col lg:ml-56 overflow-hidden">
        {/* Mobile header */}
        <div className="lg:hidden flex items-center gap-3 px-4 py-3 bg-[#0f1424] border-b border-white/5">
          <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="text-gray-400">
                {drawerOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="p-0 w-56 bg-[#0f1424] border-r border-white/5">
              <AdminSidebar variant="drawer" onNavigate={() => setDrawerOpen(false)} />
            </SheetContent>
          </Sheet>
          <span className="font-semibold text-sm">Parse Pembayaran</span>
        </div>

        <div className="flex-1 overflow-y-auto p-4 lg:p-6 space-y-4">
          <div>
            <h1 className="text-xl font-bold text-white">Parse Teks Pembayaran</h1>
            <p className="text-sm text-gray-400 mt-1">Paste teks pembayaran dari group admin, sistem akan mengekstrak data secara otomatis.</p>
          </div>

          {/* Input */}
          <div className="bg-[#0f1424] rounded-xl border border-white/5 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-300">Teks Input</span>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" className="text-gray-400 hover:text-white h-7 px-2 gap-1.5" onClick={handlePaste}>
                  <ClipboardPaste className="w-3.5 h-3.5" />
                  <span className="text-xs">Paste</span>
                </Button>
                <Button variant="ghost" size="sm" className="text-gray-400 hover:text-red-400 h-7 px-2 gap-1.5" onClick={() => { setInput(""); setResults([]); setParsed(false); }}>
                  <Trash2 className="w-3.5 h-3.5" />
                  <span className="text-xs">Hapus</span>
                </Button>
              </div>
            </div>
            <Textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder={"K.AH1212 500K/Day\n11 Oktober 2026\nGET KE 64/65:\n@[ ] - Siti\n\nAdmin bank : -\nPotget : 6.000\nTotal get : 494.000\nNote : Potlun CL\n\nNama : Siti Shakira\nRekening : 0895396179933\nJenis Bank : ShopeePay\n\nCC : @Tiqka Mutiah || Owner @Nur Ramadhani"}
              className="min-h-48 bg-[#080c18] border-white/10 text-white text-sm font-mono resize-none focus-visible:ring-purple-500/50"
            />
            <Button onClick={handleParse} disabled={!input.trim()} className="w-full bg-purple-600 hover:bg-purple-700 text-white font-medium">
              Parse Sekarang
            </Button>
          </div>

          {/* Summary bar */}
          {parsed && results.length > 0 && (
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Entri Ditemukan", value: results.length, color: "text-blue-400" },
                { label: "Data Lengkap", value: totalOk, color: "text-green-400" },
                { label: "Total Nominal", value: `Rp ${fmt(totalNominal)}`, color: "text-purple-400" },
              ].map(s => (
                <div key={s.label} className="bg-[#0f1424] border border-white/5 rounded-xl p-3 text-center">
                  <div className={`text-lg font-bold ${s.color}`}>{s.value}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{s.label}</div>
                </div>
              ))}
            </div>
          )}

          {/* No results */}
          {parsed && results.length === 0 && (
            <div className="bg-[#0f1424] border border-white/5 rounded-xl p-8 text-center">
              <AlertTriangle className="w-8 h-8 text-yellow-400 mx-auto mb-2" />
              <p className="text-sm text-gray-400">Tidak ada entri yang berhasil di-parse.<br/>Pastikan teks dimulai dengan <code className="text-purple-400">K.AHxxxx</code></p>
            </div>
          )}

          {/* Result cards */}
          <div className="space-y-3">
            {results.map((entry, idx) => (
              <div key={idx} className={`bg-[#0f1424] border rounded-xl p-4 space-y-3 ${entry.warnings.length > 0 ? "border-yellow-500/30" : "border-green-500/20"}`}>
                {/* Header */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-white">{entry.kloter || "?"}</span>
                    <Badge variant="outline" className="text-xs border-white/10 text-gray-400">{entry.tanggal}</Badge>
                    {entry.bank && (
                      <Badge className="text-xs bg-blue-500/10 text-blue-400 border border-blue-500/20">{entry.bank}</Badge>
                    )}
                    {entry.warnings.length === 0
                      ? <Badge className="text-xs bg-green-500/10 text-green-400 border border-green-500/20"><CheckCircle2 className="w-3 h-3 mr-1" />Lengkap</Badge>
                      : <Badge className="text-xs bg-yellow-500/10 text-yellow-400 border border-yellow-500/20"><AlertTriangle className="w-3 h-3 mr-1" />{entry.warnings.length} peringatan</Badge>
                    }
                  </div>
                  <Button variant="ghost" size="sm" className="text-gray-400 hover:text-white h-7 px-2 shrink-0" onClick={() => copyRow(entry, idx)}>
                    {copied === idx ? <CheckCircle2 className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </Button>
                </div>

                {/* Data grid */}
                <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                  <Field label="Nominal" value={entry.nominal ? `Rp ${fmt(entry.nominal)}` : "-"} highlight />
                  {entry.potget > 0 && <Field label="Potget" value={`Rp ${fmt(entry.potget)}`} />}
                  {entry.adminBank > 0 && <Field label="Admin Bank" value={`Rp ${fmt(entry.adminBank)}`} />}
                  <Field label="Nama" value={entry.namaRek || "-"} />
                  <Field label="No. Rekening" value={entry.noRek || "-"} mono />
                  <Field label="Bank / E-Wallet" value={entry.bank || "-"} />
                  {entry.note && <Field label="Note" value={entry.note} />}

                  {/* Tag member */}
                  <div className="col-span-2 pt-1 border-t border-white/5 mt-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-gray-500 w-20 shrink-0">Tag Member</span>
                      <span className="text-xs text-white font-medium">
                        @{entry.tagRaw || <span className="text-gray-500">-</span>}
                      </span>
                      {entry.tagPhone ? (
                        <Badge className="text-xs bg-green-500/10 text-green-400 border border-green-500/20">
                          📱 {entry.tagPhone}
                        </Badge>
                      ) : entry.tagRaw ? (
                        <Badge className="text-xs bg-orange-500/10 text-orange-400 border border-orange-500/20">
                          Nomor HP tidak terdeteksi
                        </Badge>
                      ) : null}
                    </div>
                    <p className="text-xs text-gray-600 mt-1 col-span-2">
                      Nomor HP tag otomatis terdeteksi hanya untuk e-wallet (norek = HP) atau via JID WhatsApp dari webhook.
                    </p>
                  </div>
                </div>

                {/* Warnings */}
                {entry.warnings.length > 0 && (
                  <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-lg px-3 py-2 space-y-0.5">
                    {entry.warnings.map((w, i) => (
                      <p key={i} className="text-xs text-yellow-400 flex items-center gap-1.5">
                        <AlertTriangle className="w-3 h-3 shrink-0" />{w}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, highlight, mono }: { label: string; value: string; highlight?: boolean; mono?: boolean }) {
  return (
    <div className="flex gap-2 min-w-0">
      <span className="text-xs text-gray-500 w-28 shrink-0">{label}</span>
      <span className={`text-xs truncate ${highlight ? "text-purple-300 font-semibold" : "text-white"} ${mono ? "font-mono" : ""}`}>
        {value}
      </span>
    </div>
  );
}
