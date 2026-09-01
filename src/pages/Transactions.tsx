import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Menu, RefreshCw, Loader2, ArrowUpDown, ArrowUp, ArrowDown,
  CheckCircle2, Clock, AlertTriangle, XCircle, Search, ListFilter,
  Trash2, ChevronDown, BarChart2, TrendingUp,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import AdminSidebar from "@/components/AdminSidebar";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Transaction {
  id: string;
  nominal: number;
  transaction_date: string;
  transaction_time: string;
  kode_transaksi: string | null;
  video_id: string | null;
  status_match: string | null;
}

interface MonthlyStats {
  month: string; // "2026-08"
  label: string; // "Agustus 2026"
  matched: number;
  unmatched: number;
  total: number;
}

type SortField = "transaction_time" | "nominal" | "status_match";
type SortDir = "asc" | "desc";

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  matched:   { label: "Matched",   color: "text-green-400 bg-green-500/10 border-green-500/20",   icon: CheckCircle2 },
  unmatched: { label: "Unmatched", color: "text-red-400 bg-red-500/10 border-red-500/20",         icon: XCircle },
  review:    { label: "Review",    color: "text-orange-400 bg-orange-500/10 border-orange-500/20", icon: AlertTriangle },
  null:      { label: "Baru",      color: "text-gray-400 bg-white/5 border-white/10",              icon: Clock },
};

const MONTHS_ID = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];

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

  // Monthly stats
  const [monthlyStats, setMonthlyStats] = useState<MonthlyStats[]>([]);
  const [monthlyLoading, setMonthlyLoading] = useState(false);

  // Delete state
  const [deleting, setDeleting] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    description: string;
    onConfirm: () => void;
  }>({ open: false, title: "", description: "", onConfirm: () => {} });

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

  const fetchMonthlyStats = useCallback(async () => {
    setMonthlyLoading(true);
    try {
      // Ambil semua transaksi 6 bulan terakhir, group by bulan
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
      sixMonthsAgo.setDate(1);
      const fromDate = sixMonthsAgo.toISOString().slice(0, 10);

      const { data, error } = await supabase
        .from("transactions")
        .select("transaction_date, status_match")
        .gte("transaction_date", fromDate)
        .limit(10000);

      if (error) throw error;

      // Group by bulan
      const map: Record<string, { matched: number; unmatched: number; total: number }> = {};
      (data || []).forEach((tx: any) => {
        const month = tx.transaction_date?.slice(0, 7); // "2026-08"
        if (!month) return;
        if (!map[month]) map[month] = { matched: 0, unmatched: 0, total: 0 };
        map[month].total++;
        if (tx.status_match === "matched") map[month].matched++;
        else map[month].unmatched++;
      });

      const stats: MonthlyStats[] = Object.entries(map)
        .sort(([a], [b]) => b.localeCompare(a)) // newest first
        .map(([month, s]) => {
          const [year, m] = month.split("-");
          return {
            month,
            label: `${MONTHS_ID[parseInt(m) - 1]} ${year}`,
            ...s,
          };
        });

      setMonthlyStats(stats);
    } catch (e: any) {
      console.error("Failed to load monthly stats:", e?.message);
    } finally {
      setMonthlyLoading(false);
    }
  }, []);

  useEffect(() => { fetchTransactions(); }, [fetchTransactions]);
  useEffect(() => { fetchMonthlyStats(); }, [fetchMonthlyStats]);

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

  // ── Delete helpers ──────────────────────────────────────────────
  const showConfirm = (title: string, description: string, onConfirm: () => void) => {
    setConfirmDialog({ open: true, title, description, onConfirm });
  };

  const deleteIds = async (ids: string[]) => {
    if (ids.length === 0) return;
    setDeleting(true);
    try {
      const { error } = await supabase.from("transactions").delete().in("id", ids);
      if (error) throw error;
      setTransactions(prev => prev.filter(tx => !ids.includes(tx.id)));
      toast({ title: `${ids.length} transaksi dihapus`, description: "Data berhasil dihapus." });
      fetchMonthlyStats();
    } catch (e: any) {
      toast({ title: "Gagal hapus", description: e?.message || "Error", variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteOne = (tx: Transaction) => {
    showConfirm(
      "Hapus Transaksi",
      `Hapus transaksi ${formatCurrency(tx.nominal)} jam ${tx.transaction_time?.slice(0, 5) ?? "—"}?`,
      () => deleteIds([tx.id])
    );
  };

  const handleDeleteFiltered = () => {
    const ids = filtered.map(tx => tx.id);
    const label = filterStatus === "all" ? "semua" : STATUS_CONFIG[filterStatus]?.label ?? filterStatus;
    showConfirm(
      "Hapus Semua Terlihat",
      `Hapus ${ids.length} transaksi (${label}) pada tanggal ${date}? Tindakan ini tidak bisa dibatalkan.`,
      () => deleteIds(ids)
    );
  };

  const deleteByMonth = async (month: string, statusMatch: string | null) => {
    setDeleting(true);
    try {
      const fromDate = `${month}-01`;
      // Hitung akhir bulan
      const [y, m] = month.split("-").map(Number);
      const lastDay = new Date(y, m, 0).getDate();
      const toDate = `${month}-${String(lastDay).padStart(2, "0")}`;

      let query = supabase
        .from("transactions")
        .delete()
        .gte("transaction_date", fromDate)
        .lte("transaction_date", toDate);

      if (statusMatch !== null) {
        query = query.eq("status_match", statusMatch);
      }

      const { error } = await query;
      if (error) throw error;

      const label = statusMatch ? `matched bulan ${month}` : `bulan ${month}`;
      toast({ title: `Transaksi ${label} dihapus`, description: "Data berhasil dihapus." });
      fetchMonthlyStats();
      // Refresh tabel harian jika bulan yang dihapus = bulan tanggal aktif
      if (date.startsWith(month)) fetchTransactions();
    } catch (e: any) {
      toast({ title: "Gagal hapus", description: e?.message || "Error", variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteByStatus = (status: string) => {
    const ids = transactions
      .filter(tx => (tx.status_match ?? "null") === status)
      .map(tx => tx.id);
    if (ids.length === 0) {
      toast({ title: "Tidak ada data", description: `Tidak ada transaksi dengan status ${STATUS_CONFIG[status]?.label ?? status}.` });
      return;
    }
    showConfirm(
      `Hapus Semua ${STATUS_CONFIG[status]?.label ?? status}`,
      `Hapus ${ids.length} transaksi berstatus "${STATUS_CONFIG[status]?.label ?? status}" pada tanggal ${date}?`,
      () => deleteIds(ids)
    );
  };

  // ── Render ───────────────────────────────────────────────────────
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

        <main className="flex-1 p-3 md:p-6 w-full">

          {/* Desktop header */}
          <div className="hidden lg:flex items-center gap-3 mb-4">
            <div className="w-9 h-9 rounded-xl bg-purple-500/10 flex items-center justify-center">
              <ListFilter className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">Transaksi Masuk</h1>
              <p className="text-xs text-gray-400">Data dari webhook notifikasi HP</p>
            </div>
          </div>

          {/* 2-column layout: kiri = tabel harian, kanan = laporan bulanan */}
          <div className="flex flex-col xl:flex-row gap-4 items-start">

            {/* ── KIRI: Tabel Harian ── */}
            <div className="flex-1 min-w-0 space-y-3">

              {/* Filter card */}
              <Card className="bg-[#0f1424] border-white/5">
                <CardContent className="p-3 md:p-4 space-y-3">
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
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
                    <Input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Cari nominal, kode, jam..."
                      className="h-9 pl-8 text-xs bg-[#1a1f35] border-white/10 text-white placeholder:text-gray-600"
                    />
                  </div>
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
                <div className="px-4 py-2.5 border-b border-white/5 flex items-center justify-between gap-2">
                  <span className="text-xs text-gray-400">
                    {loading ? "Memuat..." : <><span className="text-white font-semibold">{filtered.length}</span> transaksi</>}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost" size="sm"
                      onClick={fetchTransactions} disabled={loading}
                      className="hidden lg:flex h-7 gap-1.5 text-xs text-gray-400 hover:text-white"
                    >
                      <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
                      Refresh
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost" size="sm"
                          disabled={deleting || filtered.length === 0}
                          className="h-7 gap-1.5 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10"
                        >
                          {deleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                          Hapus
                          <ChevronDown className="w-3 h-3" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="bg-[#1a1f35] border-white/10 text-white min-w-[210px]">
                        <DropdownMenuItem
                          className="text-xs text-red-400 hover:text-red-300 focus:text-red-300 focus:bg-red-500/10 cursor-pointer"
                          onClick={handleDeleteFiltered}
                        >
                          <Trash2 className="w-3.5 h-3.5 mr-2" />
                          Hapus yang Terlihat ({filtered.length})
                        </DropdownMenuItem>
                        <DropdownMenuSeparator className="bg-white/10" />
                        <DropdownMenuItem
                          className="text-xs text-green-400 hover:text-green-300 focus:text-green-300 focus:bg-green-500/10 cursor-pointer"
                          onClick={() => handleDeleteByStatus("matched")}
                        >
                          <CheckCircle2 className="w-3.5 h-3.5 mr-2" />
                          Hapus Semua Matched
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-xs text-red-400 hover:text-red-300 focus:text-red-300 focus:bg-red-500/10 cursor-pointer"
                          onClick={() => handleDeleteByStatus("unmatched")}
                        >
                          <XCircle className="w-3.5 h-3.5 mr-2" />
                          Hapus Semua Unmatched
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-xs text-orange-400 hover:text-orange-300 focus:text-orange-300 focus:bg-orange-500/10 cursor-pointer"
                          onClick={() => handleDeleteByStatus("review")}
                        >
                          <AlertTriangle className="w-3.5 h-3.5 mr-2" />
                          Hapus Semua Review
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-xs text-gray-400 hover:text-gray-300 focus:text-gray-300 focus:bg-white/5 cursor-pointer"
                          onClick={() => handleDeleteByStatus("null")}
                        >
                          <Clock className="w-3.5 h-3.5 mr-2" />
                          Hapus Semua Baru
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
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
                            <button
                              onClick={() => handleDeleteOne(tx)}
                              disabled={deleting}
                              className="shrink-0 w-7 h-7 flex items-center justify-center rounded-md text-gray-600 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
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
                              { label: "",               field: null },
                            ] as { label: string; field: SortField | null }[]).map(({ label, field }, i) => (
                              <th
                                key={i}
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
                              <tr key={tx.id} className="hover:bg-white/[0.02] transition-colors group">
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
                                <td className="px-4 py-3 w-10">
                                  <button
                                    onClick={() => handleDeleteOne(tx)}
                                    disabled={deleting}
                                    className="w-7 h-7 flex items-center justify-center rounded-md text-transparent group-hover:text-gray-600 hover:!text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
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
            </div>

            {/* ── KANAN: Laporan Bulanan ── */}
            <div className="w-full xl:w-72 shrink-0 space-y-3">
              <Card className="bg-[#0f1424] border-white/5">
                <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-blue-500/10 flex items-center justify-center">
                      <BarChart2 className="w-4 h-4 text-blue-400" />
                    </div>
                    <span className="text-sm font-semibold text-white">Laporan Bulanan</span>
                  </div>
                  <button
                    onClick={fetchMonthlyStats}
                    disabled={monthlyLoading}
                    className="w-7 h-7 flex items-center justify-center rounded-md text-gray-500 hover:text-white hover:bg-white/5 transition-colors"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${monthlyLoading ? "animate-spin" : ""}`} />
                  </button>
                </div>
                <CardContent className="p-0">
                  {monthlyLoading ? (
                    <div className="flex items-center justify-center py-10">
                      <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                    </div>
                  ) : monthlyStats.length === 0 ? (
                    <div className="text-center py-10 text-gray-500 text-xs">Belum ada data</div>
                  ) : (
                    <div className="divide-y divide-white/5">
                      {monthlyStats.map((s) => {
                        const matchPct = s.total > 0 ? Math.round((s.matched / s.total) * 100) : 0;
                        return (
                          <div key={s.month} className="px-4 py-3 space-y-2">
                            {/* Bulan + total */}
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5">
                                <TrendingUp className="w-3.5 h-3.5 text-blue-400" />
                                <span className="text-xs font-semibold text-white">{s.label}</span>
                              </div>
                              <span className="text-xs text-gray-500">{s.total} total</span>
                            </div>
                            {/* Progress bar */}
                            <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                              <div
                                className="h-full rounded-full bg-green-500 transition-all"
                                style={{ width: `${matchPct}%` }}
                              />
                            </div>
                            {/* Matched / Unmatched chips */}
                            <div className="flex items-center gap-2">
                              <span className="flex-1 flex items-center gap-1 text-xs text-green-400 bg-green-500/10 border border-green-500/20 rounded-full px-2 py-0.5">
                                <CheckCircle2 className="w-3 h-3 shrink-0" />
                                <span className="font-semibold">{s.matched}</span>
                                <span className="text-green-500/70">matched</span>
                              </span>
                              <span className="flex-1 flex items-center gap-1 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-full px-2 py-0.5">
                                <XCircle className="w-3 h-3 shrink-0" />
                                <span className="font-semibold">{s.unmatched}</span>
                                <span className="text-red-500/70">unmatched</span>
                              </span>
                            </div>
                            {/* Match rate */}
                            <div className="text-right">
                              <span className="text-[10px] text-gray-500">Match rate: </span>
                              <span className={`text-[10px] font-semibold ${matchPct >= 80 ? "text-green-400" : matchPct >= 50 ? "text-orange-400" : "text-red-400"}`}>
                                {matchPct}%
                              </span>
                            </div>
                            {/* Delete buttons */}
                            <div className="flex items-center gap-1.5 pt-0.5">
                              <button
                                onClick={() => showConfirm(
                                  `Hapus Semua — ${s.label}`,
                                  `Hapus ${s.total} transaksi bulan ${s.label}? Tindakan ini tidak bisa dibatalkan.`,
                                  () => deleteByMonth(s.month, null)
                                )}
                                disabled={deleting || s.total === 0}
                                className="flex-1 flex items-center justify-center gap-1 h-6 rounded text-[10px] text-red-400 border border-red-500/20 bg-red-500/5 hover:bg-red-500/15 transition-colors disabled:opacity-40"
                              >
                                <Trash2 className="w-3 h-3" />
                                Hapus Bulan Ini
                              </button>
                              <button
                                onClick={() => showConfirm(
                                  `Hapus Matched — ${s.label}`,
                                  `Hapus ${s.matched} transaksi matched bulan ${s.label}? Tindakan ini tidak bisa dibatalkan.`,
                                  () => deleteByMonth(s.month, "matched")
                                )}
                                disabled={deleting || s.matched === 0}
                                className="flex-1 flex items-center justify-center gap-1 h-6 rounded text-[10px] text-orange-400 border border-orange-500/20 bg-orange-500/5 hover:bg-orange-500/15 transition-colors disabled:opacity-40"
                              >
                                <Trash2 className="w-3 h-3" />
                                Hapus Matched
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

          </div>
        </main>
      </div>

      {/* Confirm Dialog */}
      <AlertDialog open={confirmDialog.open} onOpenChange={(open) => setConfirmDialog(prev => ({ ...prev, open }))}>
        <AlertDialogContent className="bg-[#0f1424] border-white/10 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">{confirmDialog.title}</AlertDialogTitle>
            <AlertDialogDescription className="text-gray-400">
              {confirmDialog.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-white/5 border-white/10 text-gray-300 hover:bg-white/10 hover:text-white">
              Batal
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white border-0"
              onClick={() => {
                setConfirmDialog(prev => ({ ...prev, open: false }));
                confirmDialog.onConfirm();
              }}
            >
              Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Transactions;
