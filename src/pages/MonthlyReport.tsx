import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Loader2, Trash2, CalendarDays } from "lucide-react";
import ThemeToggle from "@/components/ThemeToggle";

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
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
      const filePaths = (list || []).map((r: any) => {
        try {
          const url = new URL(r.image_url);
          const parts = url.pathname.split("/storage/v1/object/public/receipts/");
          return parts[1] || null;
        } catch { return null; }
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

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card sticky top-0 z-10">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/admin/dashboard")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-primary" />
              <h1 className="text-lg font-semibold">Laporan Bulanan</h1>
            </div>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 max-w-4xl space-y-4">
        <Card>
          <CardContent className="py-4 flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Pilih Bulan</label>
              <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            </div>
            <div className="ml-auto">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" disabled={deleting || rows.length === 0}>
                    {deleting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1" />}
                    Hapus Semua Bulan Ini
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Hapus semua resi bulan {month}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Semua resi (Approved, Rejected, Pending) beserta gambarnya akan dihapus permanen.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Batal</AlertDialogCancel>
                    <AlertDialogAction onClick={deleteAllMonth} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Hapus Semua</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card><CardContent className="py-3 text-center"><p className="text-2xl font-bold text-warning">{totals.pending}</p><p className="text-xs text-muted-foreground">Pending</p></CardContent></Card>
          <Card><CardContent className="py-3 text-center"><p className="text-2xl font-bold text-success">{totals.approved}</p><p className="text-xs text-muted-foreground">Approved</p></CardContent></Card>
          <Card><CardContent className="py-3 text-center"><p className="text-2xl font-bold text-destructive">{totals.rejected}</p><p className="text-xs text-muted-foreground">Rejected</p></CardContent></Card>
          <Card><CardContent className="py-3 text-center"><p className="text-lg font-bold">{formatRp(totals.nominal)}</p><p className="text-xs text-muted-foreground">Total Approved</p></CardContent></Card>
        </div>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Rincian per Tanggal</CardTitle></CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-8 text-center text-muted-foreground">Memuat...</div>
            ) : rows.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">Tidak ada data bulan ini</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tanggal</TableHead>
                      <TableHead className="text-center">Pending</TableHead>
                      <TableHead className="text-center">Approved</TableHead>
                      <TableHead className="text-center">Rejected</TableHead>
                      <TableHead className="text-right">Nominal Approved</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.date}>
                        <TableCell className="font-medium">{formatDate(r.date)}</TableCell>
                        <TableCell className="text-center text-warning">{r.pending}</TableCell>
                        <TableCell className="text-center text-success">{r.approved}</TableCell>
                        <TableCell className="text-center text-destructive">{r.rejected}</TableCell>
                        <TableCell className="text-right font-mono">{formatRp(r.nominal)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default MonthlyReport;
