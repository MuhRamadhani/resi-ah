import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
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
}

type SortField = "transaction_time" | "nominal" | "status_match";
type SortDir = "asc" | "desc";

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  matched:   { label: "Matched",   color: "text-green-400 bg-green-500/10 border-green-500/20",  icon: CheckCircle2 },
  unmatched: { label: "Unmatched", color: "text-red-400 bg-red-500/10 border-red-500/20",        icon: XCircle },
  review:    { label: "Review",    color: "text-orange-400 bg-orange-500/10 border-orange-500/20", icon: AlertTriangle },
  null:      { label: "Baru",      color: "text-gray-400 bg-white/5 border-white/10",             icon: Clock },
};

const formatCurrency = (v: number) => `Rp ${Number(v || 0).toLocaleString("id-ID")}`;

const Transactions = () => {
  const { toast } = useToast();

  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [sortField, setSortField] = useState<SortField>("transaction_time");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

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
      setTransactions((data || []) as Transaction[]);
    } catch (e: any) {
      toast({ title: "Gagal load transaksi", description: e?.message || "Error", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [date, toast]);

  useEffect(() => { fetchTransactions(); }, [fetchTransactions]);

  const filtered = transactions
    .filter((tx) => {
      if (filterStatus !== "all") {
        const s = tx.status_match ?? "null";
        if (s !== filterStatus) return false;
      }
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          formatCurrency(tx.nominal).toLowerCase().includes(q) ||
          (tx.kode_transaksi || "").toLowerCase().includes(q) ||
          (tx.transaction_time || "").includes(q)
        );
      }
      return true;
    })
    .sort((a, b) => {
      let va: any, vb: any;
      if (sortField === "nominal") { va = a.nominal; vb = b.nominal; }
      else if (sortField === "transaction_time") { va = a.transaction_time; vb = b.transaction_time; }
      else { va = a.status_match || ""; vb = b.status_match || ""; }
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

  const stats = {
    total: filtered.length,
    matched: filtered.filter(t => t.status_match === "matched").length,
    unmatched: filtered.filter(t => !t.status_match || t.status_match === "unmatched").length,
    review: filtered.filter(t => t.status_match === "review").length,
  };

  return (
    <div className="min-h-screen bg-[#0a0e1a] flex">
      <AdminSidebar variant="desktop" />

      <div className="flex-1 lg:ml-56 flex flex-col min-h-screen min-w-0">

        {/* Mobile header */}
        <header className="sticky top-0 z-20 bg-[#0a0e1a]/95 backdrop-blur border-b border-white/5 px-4 py-3 flex items-center gap-3 lg:hidden">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="shrink-0 w-9 h-9 text-gray-400 hover:text-white">
                <Menu className="w-5 h-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="p-0 w-56 bg-[#0f1424] border-white/5">
              <SheetTitle className="sr-only">Menu Navigasi</SheetTitle>
              <AdminSidebar variant="drawer" />
            </SheetContent>
          </Sheet>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-purple-500/10 flex items-center justify-center shrink-0">
              <ListFilter className="w-4 h-4 text-purple-400" />
            </div>
            <span className="text-sm font-semibold text-white truncate">Transaksi Masuk</span>
          </div>
          <Button
            variant="ghost" size="icon"
            onClick={fetchTransactions} disabled={loading}
            className="shrink-0 w-9 h-9 text-gray-400 hover:text-white"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </header>

        <main className="flex-1 p-3 md:p-6 space-y-3 md:space-y-4 w-full max-w-5xl mx-auto">

          {/* Desktop header */}
          <div className="hidden lg:flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-purple-500/10 flex items-center justify-center">
              <ListFilter className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">Transaksi Masuk</h1>
              <p className="text-xs text-gray-400">Data dari webhook notifikasi HP</p>
            </div>
          </div>

          {/* Filter card */}
          <Card className="bg-[#0f1424] border-white/5">
            <CardContent className="p-3 md:p-4 space-y-3">

              {/* Row 1: Tanggal + Status */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Tanggal</label>
                  <Input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="h-9 text-xs bg-[#1a1f35] border-white/10 text-white [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:opacity-70"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Status</label>
                  <select
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value)}
                    className="h-9 w-full text-xs rounded-md bg-[#1a1f35] border border-white/10 text-white px-2 focus:outline-none"
                  >
                    <option value="all">Semua</option>
                    <option value="matched">Matched</option>
                    <option value="unmatched">Unmatched</option>
                    <option value="review">Review</option>
                    <option value="null">Baru</option>
                  </select>
                </div>
              </div>

              {/* Row 2: Search */}
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Cari nominal, kode, jam..."
                  className="h-9 pl-8 text-xs bg-[#1a1f35] border-white/10 text-white placeholder:text-gray-600"
                />
              </div>

              {/* Stats chips */}
              <div className="flex flex-wrap gap-1.5">
                <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-gray-400">
                  Total: <span className="text-white font-semibold">{stats.total}</span>
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/10 border border-green-500/20 text-green-400">
                  Matched: <span className="font-semibold">{stats.matched}</span>
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/10 border border-red-500/20 text-red-400">
                  Unmatched: <span className="font-semibold">{stats.unmatched}</span>
                </span>
                {stats.review > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-orange-500/10 border border-orange-500/20 text-orange-400">
                    Review: <span className="font-semibold">{stats.review}</span>
                  </span>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Tabel */}
          <Card className="bg-[#0f1424] border-white/5 overflow-hidden">
            {/* Table count + desktop refresh */}
            <div className="px-4 py-2.5 border-b border-white/5 flex items-center justify-between">
              <span className="text-xs text-gray-400">
                {loading ? "Memuat..." : <><span className="text-white font-semibold">{filtered.length}</span> transaksi</>}
              </span>
              <Button
                variant="ghost" size="sm"
                onClick={fetchTransactions} disabled={loading}
                className="hidden lg:flex h-7 gap-1.5 text-xs text-gray-400 hover:text-white"
              >
                <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-16 text-gray-500 text-sm">
                Tidak ada transaksi ditemukan
              </div>
            ) : (
              /* Mobile: card list | Desktop: table */
              <>
                {/* Mobile card list */}
                <div className="lg:hidden divide-y divide-white/5">
                  {filtered.map((tx) => {
                    const statusKey = tx.status_match ?? "null";
                    const cfg = STATUS_CONFIG[statusKey] || STATUS_CONFIG["null"];
                    const StatusIcon = cfg.icon;
                    return (
                      <div key={tx.id} className="px-4 py-3 flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-2">
                            <span className="text-white font-semibold text-sm">{formatCurrency(tx.nominal)}</span>
                            <span className="text-gray-500 font-mono text-xs">
                              {tx.transaction_time ? tx.transaction_time.slice(0, 5) : "—"}
                            </span>
                          </div>
                          {tx.kode_transaksi && (
                            <p className="text-gray-500 font-mono text-xs mt-0.5 truncate">{tx.kode_transaksi}</p>
                          )}
                        </div>
                        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border shrink-0 ${cfg.color}`}>
                          <StatusIcon className="w-3 h-3" />
                          {cfg.label}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Desktop table */}
                <div className="hidden lg:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/5">
                        {([
                          { label: "Jam",            field: "transaction_time" as SortField },
                          { label: "Nominal",        field: "nominal" as SortField },
                          { label: "Kode Transaksi", field: null },
                          { label: "Status",         field: "status_match" as SortField },
                        ] as { label: string; field: SortField | null }[]).map(({ label, field }) => (
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
                        const statusKey = tx.status_match ?? "null";
                        const cfg = STATUS_CONFIG[statusKey] || STATUS_CONFIG["null"];
                        const StatusIcon = cfg.icon;
                        return (
                          <tr key={tx.id} className="hover:bg-white/[0.02] transition-colors">
                            <td className="px-4 py-3 text-gray-300 font-mono text-xs whitespace-nowrap">
                              {tx.transaction_time ? tx.transaction_time.slice(0, 5) : "—"}
                            </td>
                            <td className="px-4 py-3 text-white font-semibold whitespace-nowrap">
                              {formatCurrency(tx.nominal)}
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
              </>
            )}
          </Card>
        </main>
      </div>
    </div>
  );
};

export default Transactions;
