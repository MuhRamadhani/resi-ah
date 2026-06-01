import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Upload, CheckCircle2, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

type Receipt = Tables<"receipts">;

declare global {
  interface Window { Tesseract: any; }
}

interface ParsedEntry { nominal: number; jam: string; raw?: string; }
interface MatchPair { receipt: Receipt; entry: ParsedEntry; diffHours: number; }

const formatRupiah = (n: number) => "Rp " + n.toLocaleString("id-ID");

// Convert a time-of-day string into HH:MM (24h). Handles "06:11 PM", "18.11", "19:38".
function normalizeTime(raw: string, ampm?: string): string | null {
  const cleaned = raw.replace(".", ":").trim();
  const m = cleaned.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  let h = parseInt(m[1]);
  const mm = parseInt(m[2]);
  if (mm < 0 || mm > 59) return null;
  if (ampm) {
    const ap = ampm.toUpperCase();
    if (h < 1 || h > 12) return null;
    if (ap === "PM" && h !== 12) h += 12;
    if (ap === "AM" && h === 12) h = 0;
  } else {
    if (h < 0 || h > 23) return null;
  }
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

// Extract list of {nominal, jam} from OCR text of laporan transaksi screenshot.
function extractEntries(text: string): ParsedEntry[] {
  const out: ParsedEntry[] = [];
  const lines = text.split(/\r?\n/);
  // Try line-by-line first: line containing Rp + time
  const rxAmount = /Rp\s*\.?\s*([0-9]{1,3}(?:[.,][0-9]{3})+|\d{4,9})/i;
  const rxTime = /\b(\d{1,2}[:.]\d{2})\s*(AM|PM)?\b/i;

  for (const line of lines) {
    const a = line.match(rxAmount);
    const t = line.match(rxTime);
    if (a && t) {
      const num = parseInt(a[1].replace(/[.,]/g, ""));
      const jam = normalizeTime(t[1], t[2]);
      if (num >= 1000 && num <= 100000000 && jam) {
        out.push({ nominal: num, jam, raw: line.trim() });
      }
    }
  }

  // Fallback: walk full text — pair each Rp amount with the next time on/after same window
  if (out.length === 0) {
    const tokens = [...text.matchAll(/Rp\s*\.?\s*([0-9]{1,3}(?:[.,][0-9]{3})+|\d{4,9})|(\d{1,2}[:.]\d{2})\s*(AM|PM)?/gi)];
    let pendingNum: number | null = null;
    for (const tok of tokens) {
      if (tok[1]) {
        pendingNum = parseInt(tok[1].replace(/[.,]/g, ""));
      } else if (tok[2] && pendingNum !== null) {
        const jam = normalizeTime(tok[2], tok[3]);
        if (jam && pendingNum >= 1000 && pendingNum <= 100000000) {
          out.push({ nominal: pendingNum, jam });
        }
        pendingNum = null;
      }
    }
  }

  // Dedup
  const seen = new Set<string>();
  return out.filter(e => {
    const k = `${e.nominal}|${e.jam}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  pendingReceipts: Receipt[];
  userId: string | null;
  onApproved: () => void;
}

export default function LaporanMatchDialog({ open, onOpenChange, pendingReceipts, userId, onApproved }: Props) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [entries, setEntries] = useState<ParsedEntry[]>([]);
  const [matches, setMatches] = useState<MatchPair[]>([]);
  const [unmatched, setUnmatched] = useState<ParsedEntry[]>([]);
  const [approving, setApproving] = useState(false);

  const reset = () => { setEntries([]); setMatches([]); setUnmatched([]); };

  const computeMatches = (parsed: ParsedEntry[]) => {
    const used = new Set<string>();
    const m: MatchPair[] = [];
    const um: ParsedEntry[] = [];
    for (const e of parsed) {
      // candidates: same nominal, status pending, jam diff in {0, 60} minutes
      let best: MatchPair | null = null;
      for (const r of pendingReceipts) {
        if (used.has(r.id)) continue;
        if (Number(r.nominal) !== e.nominal) continue;
        const rJam = String(r.jam_transfer || "").slice(0, 5);
        if (!/^\d{2}:\d{2}$/.test(rJam)) continue;
        const diffMin = Math.abs(timeToMinutes(rJam) - timeToMinutes(e.jam));
        // Allow 0 or 60 minutes (timezone). Reject any other diff including 1-min skew.
        if (diffMin === 0 || diffMin === 60) {
          const candidate: MatchPair = { receipt: r, entry: e, diffHours: diffMin / 60 };
          if (!best || candidate.diffHours < best.diffHours) best = candidate;
        }
      }
      if (best) { used.add(best.receipt.id); m.push(best); }
      else um.push(e);
    }
    setMatches(m);
    setUnmatched(um);
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    if (!window.Tesseract) {
      toast({ title: "OCR engine belum siap", variant: "destructive" });
      return;
    }
    setOcrLoading(true);
    reset();
    try {
      const all: ParsedEntry[] = [];
      for (const f of Array.from(files)) {
        const { data: { text } } = await window.Tesseract.recognize(f, "ind+eng");
        const parsed = extractEntries(text);
        all.push(...parsed);
      }
      // Dedup overall
      const seen = new Set<string>();
      const merged = all.filter(e => {
        const k = `${e.nominal}|${e.jam}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      setEntries(merged);
      computeMatches(merged);
      if (merged.length === 0) toast({ title: "Tidak ada transaksi terdeteksi", variant: "destructive" });
    } catch (err: any) {
      toast({ title: "OCR gagal", description: err?.message, variant: "destructive" });
    } finally {
      setOcrLoading(false);
    }
  };

  const approveAll = async () => {
    if (matches.length === 0) return;
    setApproving(true);
    const ids = matches.map(m => m.receipt.id);
    const { error } = await supabase.from("receipts").update({
      status: "Approved", approved_by: userId, approved_at: new Date().toISOString(),
    }).in("id", ids);
    if (error) {
      toast({ title: "Gagal approve", description: error.message, variant: "destructive" });
    } else {
      toast({ title: `${ids.length} resi berhasil di-approve ✅` });
      supabase.functions.invoke("send-wa-notification", { body: { status: "Approved", receipt_ids: ids } })
        .then(({ error: waError }) => { if (waError) console.warn("WA notif failed", waError); });
      onApproved();
      onOpenChange(false);
      reset();
    }
    setApproving(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Cocokkan Laporan Transaksi</DialogTitle>
          <DialogDescription>
            Upload screenshot laporan transaksi. Sistem akan otomatis cocokkan nominal &amp; jam dengan resi pending hari ini.
            Toleransi waktu: tepat sama atau beda 1 jam (zona waktu).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="border-2 border-dashed border-border rounded-lg p-6 text-center">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => handleFiles(e.target.files)}
            />
            <Button onClick={() => fileRef.current?.click()} disabled={ocrLoading}>
              {ocrLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
              {ocrLoading ? "Membaca screenshot..." : "Pilih Screenshot Laporan"}
            </Button>
            <p className="text-xs text-muted-foreground mt-2">Bisa pilih beberapa gambar sekaligus</p>
          </div>

          {entries.length > 0 && (
            <div className="grid grid-cols-3 gap-2 text-center text-sm">
              <div className="rounded border p-2"><p className="text-xs text-muted-foreground">Terdeteksi</p><p className="font-bold">{entries.length}</p></div>
              <div className="rounded border p-2 bg-success/10"><p className="text-xs text-muted-foreground">Cocok</p><p className="font-bold text-success">{matches.length}</p></div>
              <div className="rounded border p-2 bg-warning/10"><p className="text-xs text-muted-foreground">Tidak Cocok</p><p className="font-bold text-warning">{unmatched.length}</p></div>
            </div>
          )}

          {matches.length > 0 && (
            <div>
              <p className="text-sm font-semibold mb-2 flex items-center gap-1"><CheckCircle2 className="w-4 h-4 text-success" /> Akan di-Approve</p>
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {matches.map((m) => (
                  <div key={m.receipt.id} className="flex items-center justify-between text-sm border rounded p-2">
                    <div>
                      <p className="font-medium">{m.receipt.nomor_hp} — {formatRupiah(Number(m.receipt.nominal))}</p>
                      <p className="text-xs text-muted-foreground">
                        Resi {String(m.receipt.jam_transfer).slice(0,5)} ↔ Laporan {m.entry.jam}
                        {m.diffHours === 1 && <Badge variant="outline" className="ml-2">±1 jam</Badge>}
                      </p>
                    </div>
                    <CheckCircle2 className="w-4 h-4 text-success" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {unmatched.length > 0 && (
            <div>
              <p className="text-sm font-semibold mb-2 flex items-center gap-1"><X className="w-4 h-4 text-warning" /> Tidak ada resi cocok</p>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {unmatched.map((e, i) => (
                  <div key={i} className="text-sm border rounded p-2">
                    {formatRupiah(e.nominal)} — jam {e.jam}
                  </div>
                ))}
              </div>
            </div>
          )}

          {matches.length > 0 && (
            <Button className="w-full" onClick={approveAll} disabled={approving}>
              {approving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
              Approve Semua ({matches.length})
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
