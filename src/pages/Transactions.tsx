import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Menu, RefreshCw, Loader2, ArrowUpDown, ArrowUp, ArrowDown,
  CheckCircle2, Clock, AlertTriangle, XCircle, Search, ListFilter,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import AdminSidebar from "@/components/AdminSidebar";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

interface Transaction {
  id: string;
  nominal: number;
  transaction_date: string;
  transaction_time: string;
  kode_transaksi: string | null;
  video_id: string | null;
  status_match: string | null;
  source?: string | null;
  description?: string | null;
  app_name?: string | null;
  raw_text?: string | null;
}

type SortField = "transaction_time" | "nominal" | "transaction_date" | "source" | "status_match";
type SortDir = "asc" | "desc";

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  matched:   { label: "Matched",   color: "text-green-400 bg-green-500/10 border-green-500/20",  icon: CheckCircle2 },
  unmatched: { label: "Unmatched", color: "text-red-400 bg-red-500/10 border-red-500/20",        icon: XCircle },
  review:    { label: "Review",    color: "text-orange-400 bg-orange-500/10 border-orange-500/20", icon: AlertTriangle },
  null:      { label: "Baru",      color: "text-gray-400 bg-white/5 border-white/10",             icon: Clock },
};

const formatCurrency = (v: number) => `Rp ${Number(v || 0).toLocaleString("id-ID")}`;

const Transactions = () => {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);

  // Filter & sort
  const [search, setSearch] = useState("");
  const [filterSource, setFilterSource] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [sortField, setSortField] = useState<SortField>("transaction_time");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Unique sources dari data
  const [sources, setSources] = useState<string[]>([]);

  const fetchTransactions = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("transactions")
        .select("*")
        .eq("transaction_date", date)
        .order("transaction_time", { ascending: true })
        .limit(500);

      if (error) throw error;

      const rows = (data || []) as Transaction[];
      setTransactions(rows);

      // Kumpulkan unique sources
      const srcSet = new Set<string>();
      for (const r of rows) {
        const src = r.source || r.app_name || r.description || null;
        if (src) {
          // Ambil kata pertama sebagai kategori (misal "DANA", "QRIS", "Livin")
          const kategori = src.split(/[\s:–-]/)[0].trim();
          if (kategori) srcSet.add(kategori);
        }
      }
      setSources(Array.from(srcSet).sort());
    } catch (e: any) {
      toast({ title: "Gagal load transaksi", description: e?.message || "Error", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [date, toast]);

  useEffect(() => { fetchTransactions(); }, [fetchTransactions]);

  // Helper — ambil label source dari row
  const getSource = (tx: Transaction) => {
    const raw = tx.source || tx.app_name || tx.description || tx.raw_text || null;
    if (!raw) return null;
    return raw.split(/[\s:–-]/)[0].trim();
  };

  // Filter + sort
  const filtered = transactions
    .filter((tx) => {
      if (filterStatus !== "all") {
        const s = tx.status_match ?? "null";
        if (s !== filterStatus) return false;
      }
      if (filterSource !== "all") {
        const src = getSource(tx);
        if (src !== filterSource) return false;
      }
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          formatCurrency(tx.nominal).toLowerCase().includes(q) ||
          (tx.kode_transaksi || "").toLowerCase().includes(q) ||
          (tx.transaction_time || "").includes(q) ||
          (getSource(tx) || "").toLowerCase().includes(q)
        );
      }
      return true;
    })
    .sort((a, b) => {
      let va: any, vb: any;
      if (sortField === "nominal") { va = a.nominal; vb = b.nominal; }
      else if (sortField === "transaction_time") { va = a.transaction_time; vb = b.transaction_time; }
      else if (sortField === "source") { va = getSource(a) || ""; vb = getSource(b) || ""; }
      else if (sortField === "status_match") { va = a.status_match || ""; vb = b.status_match || ""; }
      else { va = a.transaction_date; vb = b.transaction_date; }
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("asc"); }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 opacity-40" />;
    return sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />;
  };

  // Statistik
  const stats = {
    total: filtered.length,
    matched: filtered.filter(t => t.status_match === "matched").length,
    unmatched: filtered.filter(t => !t.status_match || t.status_match === "unmatched").length,
    review: filtered.filter(t => t.status_match === "review").length,
  };

  return (
    <div className="min-h-screen bg-[#0a0e1a] flex">
      <AdminSidebar variant="desktop" />

      <div className="flex-1 lg:ml-56 flex flex-col min-h-screen">
        {/* Mobile header */}
        <header className="sticky top-0 z-20 bg-[#0a0e1a]/95 backdrop-blur border-b border-white/5 px-4 py-3 flex items-center justify-between lg:hidden">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="sm" className="text-gray-400 hover:text-white">
                <Menu className="w-5 h-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="p-0 w-56 bg-[#0f1424] border-white/5">
              <SheetTitle className="sr-only">Menu Navigasi</SheetTitle>
              <AdminSidebar variant="drawer" />
            </SheetContent>
          </Sheet>
          <span className="text-sm font-semibold text-white">Transaksi Masuk</span>
          <div className="w-9" />
        </header>

        <main className="flex-1 p-4 md:p-6 space-y-4 max-w-6xl mx-auto w-full">
          {/* Header */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-500/10 flex items-center justify-center">
              <ListFilter className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">Transaksi Masuk</h1>
              <p className="text-xs text-gray-400">Data dari webhook notifikasi HP</p>
            </div>
          </div>

          {/* Filter bar */}
          <Card className="bg-[#0f1424] border-white/5">
            <CardContent className="p-4 space-y-3">
              <div className="flex flex-wrap gap-3 items-end">
                {/* Tanggal */}
                <div className="flex-1 min-w-[160px]">
                  <label className="text-xs text-gray-400 block mb-1.5">Tanggal</label>
                  <Input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="h-9 text-xs bg-[#1a1f35] border-white/10 text-white [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:opacity-70"
                  />
                </div>

                {/* Source / Kategori */}
                <div className="flex-1 min-w-[130px]">
                  <label className="text-xs text-gray-400 block mb-1.5">Sumber</label>
                  <select
                    value={filterSource}
                    onChange={(e) => setFilterSource(e.target.value)}
                    className="h-9 w-full text-xs rounded-md bg-[#1a1f35] border border-white/10 text-white px-2 focus:outline-none focus:border-blue-500/50"
                  >
                    <option value="all">Semua Sumber</option>
                    {sources.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>

                {/* Status */}
                <div className="flex-1 min-w-[130px]">
                  <label className="text-xs text-gray-400 block mb-1.5">Status Match</label>
                  <select
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value)}
                    className="h-9 w-full text-xs rounded-md bg-[#1a1f35] border border-white/10 text-white px-2 focus:outline-none focus:border-blue-500/50"
                  >
                    <option value="all">Semua Status</option>
                    <option value="matched">Matched</option>
                    <option value="unmatched">Unmatched</option>
                    <option value="review">Review</option>
                    <option value="null">Baru (NULL)</option>
                  </select>
                </div>

                {/* Search */}
                <div className="flex-1 min-w-[160px]">
                  <label className="text-xs text-gray-400 block mb-1.5">Cari</label>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
                    <Input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Nominal, kode, jam..."
                      className="h-9 pl-8 text-xs bg-[#1a1f35] border-white/10 text-white placeholder:text-gray-600"
                    />
                  </div>
                </div>

                <Button
                  onClick={fetchTransactions}
                  disabled={loading}
                  variant="outline"
                  size="sm"
                  className="h-9 border-white/10 text-gray-300 hover:bg-white/5 gap-1.5 self-end"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
                  Refresh
                </Button>
              </div>

              {/* Stats chips */}
              <div className="flex flex-wrap gap-2">
                <span className="text-xs px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-gray-400">
                  Total: <span className="text-white font-semibold">{stats.total}</span>
                </span>
                <span className="text-xs px-2.5 py-1 rounded-full bg-green-500/10 border border-green-500/20 text-green-400">
                  Matched: <span className="font-semibold">{stats.matched}</span>
                </span>
                <span className="text-xs px-2.5 py-1 rounded-full bg-red-500/10 border border-red-500/20 text-red-400">
                  Unmatched: <span className="font-semibold">{stats.unmatched}</span>
                </span>
                {stats.review > 0 && (
                  <span className="text-xs px-2.5 py-1 rounded-full bg-orange-500/10 border border-orange-500/20 text-orange-400">
                    Review: <span className="font-semibold">{stats.review}</span>
                  </span>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Tabel */}
          <Card className="bg-[#0f1424] border-white/5 overflow-hidden">
            <CardHeader className="p-4 pb-0 border-b border-white/5">
              <CardTitle className="text-sm text-white">
                {loading ? "Memuat..." : `${filtered.length} transaksi`}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                </div>
              ) : filtered.length === 0 ? (
                <div className="text-center py-16 text-gray-500 text-sm">
                  Tidak ada transaksi ditemukan
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/5">
                        {[
                          { label: "Jam", field: "transaction_time" as SortField },
                          { label: "Nominal", field: "nominal" as SortField },
                          { label: "Sumber", field: "source" as SortField },
                          { label: "Kode Transaksi", field: null },
                          { label: "Status", field: "status_match" as SortField },
                        ].map(({ label, field }) => (
                          <th
                            key={label}
                            className={`px-4 py-3 text-left text-xs font-medium text-gray-500 whitespace-nowrap ${field ? "cursor-pointer hover:text-gray-300 select-none" : ""}`}
                            onClick={() => field && toggleSort(field)}
                          >
                            <div className="flex items-center gap-1">
                              {label}
                              {field && <SortIcon field={field} />}
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {filtered.map((tx) => {
                        const src = getSource(tx);
                        const statusKey = tx.status_match ?? "null";
                        const cfg = STATUS_CONFIG[statusKey] || STATUS_CONFIG["null"];
                        const StatusIcon = cfg.icon;
                        return (
                          <tr key={tx.id} className="hover:bg-white/[0.02] transition-colors">
                            <td className="px-4 py-3 text-gray-300 font-mono text-xs whitespace-nowrap">
                              {tx.transaction_time
                                ? tx.transaction_time.slice(0, 5)
                                : "—"}
                            </td>
                            <td className="px-4 py-3 text-white font-semibold whitespace-nowrap">
                              {formatCurrency(tx.nominal)}
                            </td>
                            <td className="px-4 py-3">
                              {src ? (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-300">
                                  {src}
                                </span>
                              ) : (
                                <span className="text-gray-600 text-xs">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-gray-400 text-xs font-mono max-w-[160px] truncate">
                              {tx.kode_transaksi || "—"}
                            </td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${cfg.color}`}>
                                <StatusIcon className="w-3 h-3" />
                                {cfg.label}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
};

export default Transactions;
