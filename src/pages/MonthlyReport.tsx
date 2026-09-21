import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Loader2, Trash2, CalendarDays, Menu, CheckCircle } from "lucide-react";
import ThemeToggle from "@/components/ThemeToggle";
import AdminSidebar from "@/components/AdminSidebar";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

interface Row {
  date: string;
  approved: number;
  rejected: number;
  pending: number;
  nominal: number;
}

const MonthlyReport = () => {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deletingDate, setDeletingDate] = useState<string | null>(null);

  const range = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    const start = new Date(Date.UTC(y, m - 1, 1));
    const end = new Date(Date.UTC(y, m, 1));
    return { start: start.toISOString(), end: end.toISOString() };
  }, [month]);

  const fetchData = async () => {
    setLoading(true);
    // Paginate to bypass 1000-row default
    const PAGE = 1000;
    let from = 0;
    const all: any[] = [];
    while (true) {
      const { data, error } = await supabase
        .from("receipts")
        .select("created_at,status,nominal")
        .gte("created_at", range.start)
        .lt("created_at", range.end)
        .order("created_at", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) {
        toast({ title: "Gagal memuat", description: error.message, variant: "destructive" });
        setLoading(false);
        return;
      }
      const chunk = data || [];
      all.push(...chunk);
      if (chunk.length < PAGE) break;
      from += PAGE;
    }
    const map = new Map<string, Row>();
    for (const r of all as any[]) {
      const d = new Date(r.created_at).toISOString().slice(0, 10);
      const row = map.get(d) || { date: d, approved: 0, rejected: 0, pending: 0, nominal: 0 };
      if (r.status === "Approved") { row.approved++; row.nominal += Number(r.nominal || 0); }
      else if (r.status === "Rejected") row.rejected++;
      else row.pending++;
      map.set(d, row);
    }
    const arr = Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
    setRows(arr);
    setLoading(false);
  };

  useEffect(() => { fetchData(); /* eslint-disable-next-line */ }, [month]);

  const totals = rows.reduce(
    (acc, r) => ({
      approved: acc.approved + r.approved,
      rejected: acc.rejected + r.rejected,
      pending: acc.pending + r.pending,
      nominal: acc.nominal + r.nominal,
    }),
    { approved: 0, rejected: 0, pending: 0, nominal: 0 },
  );

  const formatRp = (n: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(n);
  const formatDate = (d: string) => new Date(d).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });

  const deleteAllMonth = async () => {
    setDeleting(true);
    try {
      const PAGE = 1000;
      let from = 0;
      const list: any[] = [];
      while (true) {
        const { data, error: listErr } = await supabase
          .from("receipts")
          .select("id,image_url")
          .gte("created_at", range.start)
          .lt("created_at", range.end)
          .order("created_at", { ascending: true })
          .range(from, from + PAGE - 1);
        if (listErr) throw listErr;
        const chunk = data || [];
        list.push(...chunk);
        if (chunk.length < PAGE) break;
        from += PAGE;
      }
      const ids = (list || []).map((r: any) => r.id);
      if (ids.length === 0) {
        toast({ title: "Tidak ada data" });
        setDeleting(false);
        return;
      }
      const filePaths = (list || []).flatMap((r: any) => {
        try {
          const url = new URL(r.image_url);
          const parts = url.pathname.split("/storage/v1/object/public/receipts/");
          if (!parts[1]) return [];
          const originalFile = parts[1];
          const thumbFile = originalFile.replace('.jpg', '_thumb.jpg');
          return [originalFile, thumbFile];
        } catch { return []; }
      }).filter(Boolean) as string[];

      // Chunked storage removal (Supabase storage limit ~1000)
      const STORAGE_CHUNK = 100;
      for (let i = 0; i < filePaths.length; i += STORAGE_CHUNK) {
        const chunk = filePaths.slice(i, i + STORAGE_CHUNK);
        const { error: rmErr } = await supabase.storage.from("receipts").remove(chunk);
        if (rmErr) console.warn("Storage chunk error:", rmErr.message);
      }

      // Chunked DB deletes (URL/payload size limit)
      const DB_CHUNK = 200;
      for (let i = 0; i < ids.length; i += DB_CHUNK) {
        const chunk = ids.slice(i, i + DB_CHUNK);
        const { error: waErr } = await supabase.from("receipt_wa_messages").delete().in("receipt_id", chunk);
        if (waErr) console.warn("WA delete chunk error:", waErr.message);
        const { error: rErr } = await supabase.from("receipts").delete().in("id", chunk);
        if (rErr) throw rErr;
      }

      toast({ title: `${ids.length} resi bulan ${month} dihapus 🗑️` });
      fetchData();
    } catch (e: any) {
      toast({ title: "Gagal hapus", description: e.message, variant: "destructive" });
    }
    setDeleting(false);
  };

  const deleteDate = async (date: string) => {
    setDeletingDate(date);
    try {
      // Filter tanggal pakai timezone WIB (+07:00)
      const startDate = `${date}T00:00:00+07:00`;
      const endDate = `${date}T23:59:59.999+07:00`;

      const PAGE = 1000;
      let from = 0;
      const list: any[] = [];
      while (true) {
        const { data, error: listErr } = await supabase
          .from("receipts")
          .select("id,image_url")
          .gte("created_at", startDate)
          .lte("created_at", endDate)
          .order("created_at", { ascending: true })
          .range(from, from + PAGE - 1);
        if (listErr) throw listErr;
        const chunk = data || [];
        list.push(...chunk);
        if (chunk.length < PAGE) break;
        from += PAGE;
      }

      const ids = list.map((r: any) => r.id);
      if (ids.length === 0) {
        toast({ title: "Tidak ada data untuk tanggal ini" });
        setDeletingDate(null);
        return;
      }

      const filePaths = list.flatMap((r: any) => {
        try {
          const url = new URL(r.image_url);
          const parts = url.pathname.split("/storage/v1/object/public/receipts/");
          if (!parts[1]) return [];
          const originalFile = parts[1];
          const thumbFile = originalFile.replace('.jpg', '_thumb.jpg');
          return [originalFile, thumbFile];
        } catch { return []; }
      }).filter(Boolean) as string[];

      // Hapus gambar dari storage
      const STORAGE_CHUNK = 100;
      for (let i = 0; i < filePaths.length; i += STORAGE_CHUNK) {
        const chunk = filePaths.slice(i, i + STORAGE_CHUNK);
        await supabase.storage.from("receipts").remove(chunk);
      }

      // Hapus relasi WA messages + resi dari DB
      const DB_CHUNK = 200;
      for (let i = 0; i < ids.length; i += DB_CHUNK) {
        const chunk = ids.slice(i, i + DB_CHUNK);
        await supabase.from("receipt_wa_messages").delete().in("receipt_id", chunk);
        const { error: rErr } = await supabase.from("receipts").delete().in("id", chunk);
        if (rErr) throw rErr;
      }

      toast({ title: `${ids.length} resi tanggal ${formatDate(date)} dihapus 🗑️` });
      fetchData();
    } catch (e: any) {
      toast({ title: "Gagal hapus", description: e.message, variant: "destructive" });
    }
    setDeletingDate(null);
  };

  return (
    <div className="min-h-screen bg-[#0a0e1a] flex overflow-x-hidden">
      <AdminSidebar />

      {/* Main Content */}
      <div className="flex-1 min-w-0 lg:ml-56">
        <header className="bg-[#0f1424] border-b border-white/5 sticky top-0 z-10">
          <div className="px-4 py-3 md:px-6 md:py-4 flex items-center gap-2 md:gap-3">
            {/* Hamburger (mobile) */}
            <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
              <SheetTrigger asChild>
                <button className="lg:hidden shrink-0 flex items-center justify-center w-9 h-9 rounded-lg border border-white/10 bg-white/5 text-gray-300 hover:bg-white/10 transition-colors" aria-label="Menu">
                  <Menu className="w-5 h-5" />
                </button>
              </SheetTrigger>
              <SheetContent side="left" className="w-64 p-0 bg-[#0f1424] border-white/10">
                <SheetTitle className="sr-only">Menu Navigasi</SheetTitle>
                <AdminSidebar variant="drawer" onNavigate={() => setMobileNavOpen(false)} />
              </SheetContent>
            </Sheet>

            {/* Logo tile (mobile) */}
            <div className="lg:hidden shrink-0 w-9 h-9 rounded-lg bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center">
              <CheckCircle className="w-5 h-5 text-white" />
            </div>

            <Button variant="ghost" size="icon" className="lg:hidden shrink-0 w-8 h-8 text-gray-400 hover:text-white hover:bg-white/10" onClick={() => navigate("/admin/dashboard")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>

            <div className="flex-1 min-w-0">
              <h1 className="text-sm md:text-xl font-bold text-white truncate">Laporan Bulanan</h1>
              <p className="text-[11px] md:text-sm text-gray-400 mt-0.5 truncate">Ringkasan dan statistik bulanan</p>
            </div>

            <div className="lg:hidden shrink-0">
              <ThemeToggle />
            </div>
          </div>
        </header>

        <main className="px-4 py-4 md:px-6 md:py-6 max-w-5xl mx-auto space-y-4 md:space-y-5">
          <Card className="bg-[#0f1424] border-2 border-purple-500/30 shadow-[0_0_15px_rgba(168,85,247,0.15)]">
            <CardContent className="p-4 md:py-4 flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-3">
              <div className="space-y-2 flex-1 sm:min-w-[200px]">
                <label className="text-xs text-gray-400 font-medium">Pilih Bulan</label>
                <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="bg-[#1a1f35] border-white/10 text-white focus:border-purple-500/50 h-10 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:opacity-70 [&::-webkit-calendar-picker-indicator]:cursor-pointer" />
              </div>
              <div className="sm:ml-auto">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button className="bg-red-600 hover:bg-red-700 text-white w-full sm:w-auto h-10 text-xs md:text-sm" disabled={deleting || rows.length === 0}>
                      {deleting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1" />}
                      Hapus Semua Bulan Ini
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="bg-[#1a1f35] border-white/10">
                    <AlertDialogHeader>
                      <AlertDialogTitle className="text-white">Hapus semua resi bulan {month}?</AlertDialogTitle>
                      <AlertDialogDescription className="text-gray-400">
                        Semua resi (Approved, Rejected, Pending) beserta gambarnya akan dihapus permanen.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel className="bg-transparent border-white/20 text-gray-300 hover:bg-white/10">Batal</AlertDialogCancel>
                      <AlertDialogAction onClick={deleteAllMonth} className="bg-red-600 text-white hover:bg-red-700">Hapus Semua</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-3 md:grid-cols-4 gap-2 md:gap-4">
            <Card className="bg-[#0f1424] border-2 border-orange-500/30 shadow-[0_0_15px_rgba(249,115,22,0.15)]">
              <CardContent className="p-3 md:py-4 text-center">
                <p className="text-xl md:text-3xl font-bold text-orange-400 tabular-nums">{totals.pending}</p>
                <p className="text-[10px] md:text-xs text-gray-400 mt-1">Pending</p>
              </CardContent>
            </Card>
            <Card className="bg-[#0f1424] border-2 border-green-500/30 shadow-[0_0_15px_rgba(34,197,94,0.15)]">
              <CardContent className="p-3 md:py-4 text-center">
                <p className="text-xl md:text-3xl font-bold text-green-400 tabular-nums">{totals.approved}</p>
                <p className="text-[10px] md:text-xs text-gray-400 mt-1">Approved</p>
              </CardContent>
            </Card>
            <Card className="bg-[#0f1424] border-2 border-red-500/30 shadow-[0_0_15px_rgba(239,68,68,0.15)]">
              <CardContent className="p-3 md:py-4 text-center">
                <p className="text-xl md:text-3xl font-bold text-red-400 tabular-nums">{totals.rejected}</p>
                <p className="text-[10px] md:text-xs text-gray-400 mt-1">Rejected</p>
              </CardContent>
            </Card>
            <Card className="col-span-3 md:col-span-1 bg-[#0f1424] border-2 border-blue-500/30 shadow-[0_0_15px_rgba(59,130,246,0.15)]">
              <CardContent className="p-3 md:py-4 text-center">
                <p className="text-base md:text-lg font-bold text-blue-400 tabular-nums">{formatRp(totals.nominal)}</p>
                <p className="text-[10px] md:text-xs text-gray-400 mt-1">Total Approved</p>
              </CardContent>
            </Card>
          </div>

          <Card className="bg-[#0f1424] border-white/5">
            <CardHeader className="p-4 pb-3 border-b border-white/5">
              <CardTitle className="text-sm md:text-base text-white">Rincian per Tanggal</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="p-8 text-center text-gray-400">Memuat...</div>
              ) : rows.length === 0 ? (
                <div className="p-8 text-center text-gray-400">Tidak ada data bulan ini</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-[#1a1f35] hover:bg-[#1a1f35] border-b border-white/5">
                      <TableHead className="text-gray-300 text-[10px] md:text-xs px-2 md:px-4">Tanggal</TableHead>
                      <TableHead className="text-center text-gray-300 text-[10px] md:text-xs px-1 md:px-4">
                        <span className="md:hidden">Pend</span><span className="hidden md:inline">Pending</span>
                      </TableHead>
                      <TableHead className="text-center text-gray-300 text-[10px] md:text-xs px-1 md:px-4">
                        <span className="md:hidden">Appr</span><span className="hidden md:inline">Approved</span>
                      </TableHead>
                      <TableHead className="text-center text-gray-300 text-[10px] md:text-xs px-1 md:px-4">
                        <span className="md:hidden">Rej</span><span className="hidden md:inline">Rejected</span>
                      </TableHead>
                      <TableHead className="text-right text-gray-300 text-[10px] md:text-xs px-2 md:px-4">
                        <span className="md:hidden">Nominal</span><span className="hidden md:inline">Nominal Approved</span>
                      </TableHead>
                      <TableHead className="text-center text-gray-300 text-[10px] md:text-xs px-2 md:px-4">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.date} className="border-b border-white/5 hover:bg-white/5">
                        <TableCell className="font-medium text-white text-[11px] md:text-sm px-2 md:px-4 whitespace-nowrap">{formatDate(r.date)}</TableCell>
                        <TableCell className="text-center text-orange-400 text-[11px] md:text-sm px-1 md:px-4">{r.pending}</TableCell>
                        <TableCell className="text-center text-green-400 text-[11px] md:text-sm px-1 md:px-4">{r.approved}</TableCell>
                        <TableCell className="text-center text-red-400 text-[11px] md:text-sm px-1 md:px-4">{r.rejected}</TableCell>
                        <TableCell className="text-right font-mono text-white text-[10px] md:text-sm px-2 md:px-4">{formatRp(r.nominal)}</TableCell>
                        <TableCell className="text-center px-2 md:px-4">
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={deletingDate === r.date}
                                className="h-7 px-2 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                              >
                                {deletingDate === r.date ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Trash2 className="h-3.5 w-3.5" />
                                )}
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent className="bg-[#1a1f35] border-white/10">
                              <AlertDialogHeader>
                                <AlertDialogTitle className="text-white">Hapus semua resi tanggal {formatDate(r.date)}?</AlertDialogTitle>
                                <AlertDialogDescription className="text-gray-400">
                                  Semua {r.pending + r.approved + r.rejected} resi (Pending, Approved, Rejected) beserta gambarnya akan dihapus permanen.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel className="bg-transparent border-white/20 text-gray-300 hover:bg-white/10">Batal</AlertDialogCancel>
                                <AlertDialogAction onClick={() => deleteDate(r.date)} className="bg-red-600 text-white hover:bg-red-700">Hapus</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
};

export default MonthlyReport;
