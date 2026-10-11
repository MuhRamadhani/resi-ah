import { useState, useEffect, useCallback } from "react";
import AdminSidebar from "@/components/AdminSidebar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  AlertTriangle, RefreshCw, Search, Menu, X,
  Trash2, ChevronDown, ChevronUp,
} from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";

// ─── Types ───────────────────────────────────────────────────
interface PaymentEntry {
  id: string;
  kode: string;
  tag_raw: string | null;
  tag_phone: string | null;
  tag_jid: string | null;
  nama: string | null;
  norek: string | null;
  bank: string | null;
  total_get: number | null;
  potget: number | null;
  note: string | null;
  raw_text: string | null;
  group_id: string | null;
  sender_jid: string | null;
  created_at: string;
}

function fmt(n: number) {
  return n.toLocaleString("id-ID");
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("id-ID", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function groupName(groupId: string | null) {
  if (!groupId) return "-";
  return groupId.replace("@g.us", "").replace("@s.whatsapp.net", "");
}

// ─── Component ───────────────────────────────────────────────
export default function ParsePembayaran() {
  const [entries, setEntries] = useState<PaymentEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("payment_entries")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (!error && data) setEntries(data as PaymentEntry[]);
    setLoading(false);
  }, []);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel("payment_entries_realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_entries" }, () => {
        fetchEntries();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchEntries]);

  const filtered = entries.filter(e => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      e.kode?.toLowerCase().includes(q) ||
      e.nama?.toLowerCase().includes(q) ||
      e.tag_raw?.toLowerCase().includes(q) ||
      e.tag_phone?.includes(q) ||
      e.norek?.includes(q) ||
      e.bank?.toLowerCase().includes(q)
    );
  });

  const handleDelete = async (id: string) => {
    setDeleting(id);
    await supabase.from("payment_entries").delete().eq("id", id);
    setEntries(prev => prev.filter(e => e.id !== id));
    setDeleting(null);
  };

  const totalNominal = filtered.reduce((s, e) => s + (e.total_get ?? 0), 0);
  const ewallet = ["dana","gopay","ovo","shopeepay","linkaja","isaku","doku","sakuku"];
  const isEwallet = (b: string | null) => !!b && ewallet.includes(b.toLowerCase());

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
          <span className="font-semibold text-sm">Payment</span>
        </div>

        <div className="flex-1 overflow-y-auto p-4 lg:p-6 space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold text-white">Payment</h1>
              <p className="text-sm text-gray-400 mt-0.5">
                Data pembayaran yang dikirim admin via WhatsApp, di-parse otomatis.
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="text-gray-400 hover:text-white gap-1.5"
              onClick={fetchEntries}
              disabled={loading}
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>

          {/* Summary bar */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Total Entri", value: filtered.length, color: "text-blue-400" },
              { label: "Dengan No. HP", value: filtered.filter(e => e.tag_phone).length, color: "text-green-400" },
              { label: "Total Nominal", value: `Rp ${fmt(totalNominal)}`, color: "text-purple-400" },
            ].map(s => (
              <div key={s.label} className="bg-[#0f1424] border border-white/5 rounded-xl p-3 text-center">
                <div className={`text-lg font-bold ${s.color}`}>{s.value}</div>
                <div className="text-xs text-gray-500 mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Cari kode, nama, bank, no. rek..."
              className="pl-9 bg-[#0f1424] border-white/10 text-white placeholder:text-gray-600 focus-visible:ring-purple-500/50"
            />
          </div>

          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center py-16">
              <RefreshCw className="w-6 h-6 text-purple-400 animate-spin" />
            </div>
          )}

          {/* Empty */}
          {!loading && filtered.length === 0 && (
            <div className="bg-[#0f1424] border border-white/5 rounded-xl p-10 text-center">
              <AlertTriangle className="w-8 h-8 text-yellow-400 mx-auto mb-3" />
              <p className="text-sm text-gray-400">
                {search ? "Tidak ada entri yang cocok dengan pencarian." : "Belum ada data payment. Data akan muncul otomatis saat admin kirim via WA."}
              </p>
            </div>
          )}

          {/* Entry cards */}
          {!loading && (
            <div className="space-y-2">
              {filtered.map(entry => {
                const hasPhone = !!entry.tag_phone;
                const isOpen = expanded === entry.id;
                const phoneResolved = hasPhone || isEwallet(entry.bank);
                const resolvedPhone = entry.tag_phone ||
                  (isEwallet(entry.bank) && entry.norek ? entry.norek : null);

                return (
                  <div
                    key={entry.id}
                    className={`bg-[#0f1424] border rounded-xl overflow-hidden transition-colors ${
                      hasPhone ? "border-green-500/20" : "border-white/5"
                    }`}
                  >
                    {/* Row (collapsed) */}
                    <div
                      className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-white/5 transition-colors"
                      onClick={() => setExpanded(isOpen ? null : entry.id)}
                    >
                      {/* Kode */}
                      <span className="text-sm font-bold text-white w-20 shrink-0">{entry.kode || "—"}</span>

                      {/* Bank badge */}
                      {entry.bank ? (
                        <Badge className="text-xs bg-blue-500/10 text-blue-400 border border-blue-500/20 shrink-0">
                          {entry.bank}
                        </Badge>
                      ) : (
                        <span className="w-16" />
                      )}

                      {/* Nama */}
                      <span className="text-sm text-gray-300 flex-1 truncate min-w-0">
                        {entry.nama || <span className="text-gray-600">—</span>}
                      </span>

                      {/* Nominal */}
                      {entry.total_get ? (
                        <span className="text-sm font-semibold text-purple-300 shrink-0">
                          Rp {fmt(entry.total_get)}
                        </span>
                      ) : (
                        <span className="text-sm text-gray-600 shrink-0">—</span>
                      )}

                      {/* Phone badge */}
                      {phoneResolved ? (
                        <Badge className="text-xs bg-green-500/10 text-green-400 border border-green-500/20 shrink-0">
                          📱 {resolvedPhone}
                        </Badge>
                      ) : entry.tag_raw ? (
                        <Badge className="text-xs bg-orange-500/10 text-orange-400 border border-orange-500/20 shrink-0">
                          @{entry.tag_raw}
                        </Badge>
                      ) : null}

                      {/* Chevron */}
                      {isOpen
                        ? <ChevronUp className="w-4 h-4 text-gray-500 shrink-0" />
                        : <ChevronDown className="w-4 h-4 text-gray-500 shrink-0" />
                      }
                    </div>

                    {/* Expanded detail */}
                    {isOpen && (
                      <div className="px-4 pb-4 border-t border-white/5 pt-3 space-y-3">
                        <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
                          <Field label="Kode" value={entry.kode} />
                          <Field label="Tanggal" value={fmtDate(entry.created_at)} />
                          <Field label="Nama" value={entry.nama} />
                          <Field label="No. Rekening" value={entry.norek} mono />
                          <Field label="Bank / E-Wallet" value={entry.bank} />
                          <Field label="Total Get" value={entry.total_get ? `Rp ${fmt(entry.total_get)}` : null} highlight />
                          {(entry.potget ?? 0) > 0 && (
                            <Field label="Potget" value={`Rp ${fmt(entry.potget!)}`} />
                          )}
                          {entry.note && <Field label="Note" value={entry.note} />}
                          <Field label="Tag Member" value={entry.tag_raw ? `@${entry.tag_raw}` : null} />
                          {resolvedPhone && <Field label="No. HP Member" value={resolvedPhone} mono />}
                          <Field label="Dari Group" value={groupName(entry.group_id)} />
                        </div>

                        {/* Raw text */}
                        {entry.raw_text && (
                          <details className="group">
                            <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-300 select-none">
                              Lihat teks asli
                            </summary>
                            <pre className="mt-2 text-xs text-gray-400 bg-black/30 rounded-lg p-3 whitespace-pre-wrap font-mono leading-relaxed">
                              {entry.raw_text}
                            </pre>
                          </details>
                        )}

                        {/* Delete */}
                        <div className="flex justify-end pt-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-gray-500 hover:text-red-400 h-7 px-2 gap-1.5 text-xs"
                            onClick={() => handleDelete(entry.id)}
                            disabled={deleting === entry.id}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            {deleting === entry.id ? "Menghapus..." : "Hapus"}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, highlight, mono }: {
  label: string; value: string | null | undefined;
  highlight?: boolean; mono?: boolean;
}) {
  return (
    <div className="flex gap-2 min-w-0">
      <span className="text-xs text-gray-500 w-28 shrink-0">{label}</span>
      <span className={`text-xs truncate ${highlight ? "text-purple-300 font-semibold" : "text-white"} ${mono ? "font-mono" : ""}`}>
        {value || <span className="text-gray-600">—</span>}
      </span>
    </div>
  );
}
