import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Trash2, RefreshCw, HardDrive, Search, Menu, BarChart2, Image } from "lucide-react";
import AdminSidebar from "@/components/AdminSidebar";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

interface FileRow {
  name: string;
  size: number;
  created_at: string;
}

interface DailyFileStat {
  date: string;   // "2026-09-01"
  label: string;  // "1 Sep 2026"
  count: number;
  totalSize: number;
  names: string[];
}

const BUCKET = "receipts";
const PAGE_SIZE = 1000;

function parseName(name: string): { nomor: string; date: Date | null } {
  const m = name.match(/^wa_(\d+)_(\d+)\./);
  if (!m) return { nomor: "-", date: null };
  const ts = Number(m[2]);
  return { nomor: m[1], date: Number.isFinite(ts) ? new Date(ts) : null };
}

const fmtBytes = (n: number) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
};

const fmtDate = (d: Date) =>
  d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });

const StorageManager = () => {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [files, setFiles] = useState<FileRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deletingApproved, setDeletingApproved] = useState(false);
  const [search, setSearch] = useState("");
  const [approvedCount, setApprovedCount] = useState<number | null>(null);

  /* ── Fetch storage files ── */
  const fetchFiles = async () => {
    setLoading(true);
    const all: FileRow[] = [];
    let offset = 0;
    try {
      while (true) {
        const { data, error } = await supabase.storage.from(BUCKET).list("", {
          limit: PAGE_SIZE, offset,
          sortBy: { column: "created_at", order: "desc" },
        });
        if (error) throw error;
        const chunk = (data || []).filter((f: any) => f.name && !f.name.endsWith("/"));
        for (const f of chunk) {
          all.push({
            name: f.name,
            size: (f.metadata as any)?.size ?? 0,
            created_at: f.created_at ?? (f.metadata as any)?.lastModified ?? "",
          });
        }
        if (chunk.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
      }
      setFiles(all);
    } catch (e: any) {
      toast({ title: "Gagal memuat", description: e.message, variant: "destructive" });
    }
    setLoading(false);
  };

  /* ── Fetch approved count ── */
  const fetchApprovedCount = async () => {
    const { count } = await supabase
      .from("receipts")
      .select("id", { count: "exact", head: true })
      .eq("status", "Approved")
      .not("image_url", "is", null);
    setApprovedCount(count ?? 0);
  };

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) { navigate("/admin/login"); return; }
      fetchFiles();
      fetchApprovedCount();
    })();
    // eslint-disable-next-line
  }, []);

  /* ── Filtered list ── */
  const filtered = useMemo(() => {
    if (!search.trim()) return files;
    const q = search.toLowerCase();
    return files.filter((f) => {
      const { nomor } = parseName(f.name);
      return f.name.toLowerCase().includes(q) || nomor.includes(q);
    });
  }, [files, search]);

  /* ── Daily stats untuk panel kanan ── */
  const dailyStats = useMemo<DailyFileStat[]>(() => {
    const map = new Map<string, DailyFileStat>();
    for (const f of files) {
      const { date } = parseName(f.name);
      const dateKey = date
        ? date.toISOString().slice(0, 10)
        : (f.created_at ? f.created_at.slice(0, 10) : "unknown");
      if (!map.has(dateKey)) {
        const d = date || (f.created_at ? new Date(f.created_at) : new Date());
        map.set(dateKey, {
          date: dateKey,
          label: fmtDate(d),
          count: 0,
          totalSize: 0,
          names: [],
        });
      }
      const stat = map.get(dateKey)!;
      stat.count++;
      stat.totalSize += f.size;
      stat.names.push(f.name);
    }
    return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
  }, [files]);

  /* ── Delete helpers ── */
  const removePaths = async (names: string[], label: string) => {
    if (names.length === 0) return;
    setDeleting(true);
    try {
      let removed = 0;
      for (let i = 0; i < names.length; i += 100) {
        const { error } = await supabase.storage.from(BUCKET).remove(names.slice(i, i + 100));
        if (error) throw error;
        removed += Math.min(100, names.length - i);
      }
      toast({ title: `${removed} file ${label} dihapus 🗑️` });
      fetchFiles();
    } catch (e: any) {
      toast({ title: "Gagal hapus", description: e.message, variant: "destructive" });
    }
    setDeleting(false);
  };

  const deleteByDate = (stat: DailyFileStat) => removePaths(stat.names, `tanggal ${stat.label}`);

  const deleteApproved = async () => {
    setDeletingApproved(true);
    try {
      const { data: receipts, error } = await supabase
        .from("receipts")
        .select("id, image_url")
        .eq("status", "Approved")
        .not("image_url", "is", null);
      if (error) throw error;
      if (!receipts || receipts.length === 0) {
        toast({ title: "Tidak ada gambar Approved untuk dihapus" });
        setDeletingApproved(false);
        return;
      }
      const marker = "/storage/v1/object/public/receipts/";
      const paths = receipts
        .map((r) => { const idx = (r.image_url || "").indexOf(marker); return idx !== -1 ? r.image_url!.slice(idx + marker.length) : null; })
        .filter((p): p is string => !!p);
      let removed = 0;
      for (let i = 0; i < paths.length; i += 100) {
        const { error: sErr } = await supabase.storage.from(BUCKET).remove(paths.slice(i, i + 100));
        if (sErr) throw sErr;
        removed += Math.min(100, paths.length - i);
      }
      const ids = receipts.map((r) => r.id);
      for (let i = 0; i < ids.length; i += 500)
        await supabase.from("receipts").update({ image_url: null }).in("id", ids.slice(i, i + 500));
      toast({ title: `${removed} gambar Approved berhasil dihapus 🗑️` });
      fetchFiles();
      fetchApprovedCount();
    } catch (e: any) {
      toast({ title: "Gagal hapus", description: e.message, variant: "destructive" });
    }
    setDeletingApproved(false);
  };

  const totalSize = useMemo(() => files.reduce((s, f) => s + f.size, 0), [files]);

  return (
    <div className="min-h-screen bg-[#0a0e1a] flex overflow-x-hidden">
      <AdminSidebar variant="desktop" />

      <div className="flex-1 lg:ml-56 flex flex-col min-h-screen min-w-0 overflow-x-hidden">

        {/* Mobile header */}
        <header className="sticky top-0 z-20 bg-[#0a0e1a]/95 backdrop-blur border-b border-white/5 px-4 py-3 flex items-center justify-between lg:hidden">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="sm" className="text-gray-400 hover:text-white">
                <Menu className="w-5 h-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="p-0 w-56 bg-[#0f1424] border-white/5">
              <SheetTitle className="sr-only">Menu</SheetTitle>
              <AdminSidebar variant="drawer" />
            </SheetContent>
          </Sheet>
          <span className="text-sm font-semibold text-white">Storage</span>
          <Button variant="ghost" size="sm" onClick={fetchFiles} disabled={loading} className="text-gray-400 hover:text-white">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </header>

        <main className="flex-1 p-3 md:p-6 overflow-x-hidden">

          {/* Desktop header */}
          <div className="hidden lg:flex items-center gap-3 mb-4">
            <div className="w-9 h-9 rounded-xl bg-purple-500/10 flex items-center justify-center">
              <HardDrive className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">Storage</h1>
              <p className="text-xs text-gray-400">Kelola gambar resi di bucket Supabase</p>
            </div>
          </div>

          {/* 2-column layout */}
          <div className="flex flex-col xl:flex-row gap-4 items-start">

            {/* ── KIRI: Daftar File ── */}
            <div className="flex-1 min-w-0 space-y-3 order-last xl:order-first">

              {/* Stats + filter */}
              <Card className="bg-[#0f1424] border-white/5">
                <CardContent className="p-3 md:p-4 space-y-3">
                  {/* Stats chips */}
                  <div className="flex flex-wrap gap-2">
                    <span className="text-xs px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-gray-300">
                      Total: <span className="text-white font-semibold">{files.length}</span> file
                    </span>
                    <span className="text-xs px-2.5 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-300">
                      <span className="font-semibold">{fmtBytes(totalSize)}</span>
                    </span>
                    {approvedCount !== null && approvedCount > 0 && (
                      <span className="text-xs px-2.5 py-1 rounded-full bg-green-500/10 border border-green-500/20 text-green-300">
                        Approved: <span className="font-semibold">{approvedCount}</span>
                      </span>
                    )}
                  </div>

                  {/* Search */}
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
                    <Input
                      value={search} onChange={(e) => setSearch(e.target.value)}
                      placeholder="Cari nama / nomor HP..."
                      className="pl-8 h-9 text-xs bg-[#1a1f35] border-white/10 text-white placeholder:text-gray-600"
                    />
                  </div>

                  {/* Action buttons */}
                  <div className="flex flex-wrap gap-2">
                    <Button variant="ghost" size="sm" onClick={() => { fetchFiles(); fetchApprovedCount(); }} disabled={loading}
                      className="hidden lg:flex h-8 gap-1.5 text-xs text-gray-400 hover:text-white">
                      <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} /> Refresh
                    </Button>

                    {/* Hapus Approved */}
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" disabled={deletingApproved || approvedCount === 0}
                          className="h-8 gap-1.5 text-xs bg-green-700/80 hover:bg-green-700 text-white">
                          {deletingApproved ? <Loader2 className="w-3 h-3 animate-spin" /> : <Image className="w-3 h-3" />}
                          Hapus Gambar Approved ({approvedCount ?? "..."})
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="bg-[#1a1f35] border-white/10">
                        <AlertDialogHeader>
                          <AlertDialogTitle className="text-white">Hapus gambar Approved?</AlertDialogTitle>
                          <AlertDialogDescription className="text-gray-400">
                            Hanya gambar resi berstatus <b className="text-green-400">Approved</b> yang dihapus dari Storage.
                            Resi <b className="text-white">Pending</b> tidak tersentuh.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel className="bg-transparent border-white/20 text-gray-300 hover:bg-white/10">Batal</AlertDialogCancel>
                          <AlertDialogAction onClick={deleteApproved} className="bg-green-700 text-white hover:bg-green-800">Hapus</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>

                    {/* Hapus Semua */}
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" disabled={deleting || files.length === 0}
                          className="h-8 gap-1.5 text-xs bg-red-700/80 hover:bg-red-700 text-white ml-auto">
                          {deleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                          Hapus Semua ({files.length})
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="bg-[#1a1f35] border-white/10">
                        <AlertDialogHeader>
                          <AlertDialogTitle className="text-white">Hapus SEMUA {files.length} file?</AlertDialogTitle>
                          <AlertDialogDescription className="text-gray-400">
                            Semua gambar di bucket <b className="text-white">{BUCKET}</b> akan dihapus permanen.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel className="bg-transparent border-white/20 text-gray-300 hover:bg-white/10">Batal</AlertDialogCancel>
                          <AlertDialogAction onClick={() => removePaths(files.map(f => f.name), "semua")} className="bg-red-600 text-white hover:bg-red-700">Hapus Semua</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </CardContent>
              </Card>

              {/* File list */}
              <Card className="bg-[#0f1424] border-white/5 overflow-hidden">
                <div className="px-4 py-2.5 border-b border-white/5 flex items-center justify-between">
                  <span className="text-xs text-gray-400">
                    {loading ? "Memuat..." : <><span className="text-white font-semibold">{filtered.length}</span> file</>}
                  </span>
                </div>

                {loading ? (
                  <div className="flex items-center justify-center py-16">
                    <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="text-center py-16 text-gray-500 text-sm">Tidak ada file ditemukan</div>
                ) : (
                  <>
                    {/* Mobile list */}
                    <div className="lg:hidden divide-y divide-white/5">
                      {filtered.map((f) => {
                        const { nomor, date } = parseName(f.name);
                        return (
                          <div key={f.name} className="px-4 py-3 flex items-center gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-white text-sm font-medium truncate">{nomor === "-" ? f.name : nomor}</p>
                              <p className="text-gray-500 text-xs">{date ? fmtDate(date) : "—"}</p>
                            </div>
                            <span className="text-xs text-gray-500 shrink-0">{fmtBytes(f.size)}</span>
                          </div>
                        );
                      })}
                    </div>

                    {/* Desktop table */}
                    <div className="hidden lg:block overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-white/5">
                            {["Nomor HP", "Tanggal & Jam", "Ukuran"].map((h) => (
                              <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {filtered.map((f) => {
                            const { nomor, date } = parseName(f.name);
                            return (
                              <tr key={f.name} className="hover:bg-white/3 transition-colors">
                                <td className="px-4 py-2.5 text-white font-mono text-xs">{nomor}</td>
                                <td className="px-4 py-2.5 text-gray-400 text-xs">
                                  {date ? date.toLocaleString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                                </td>
                                <td className="px-4 py-2.5 text-gray-400 text-xs">{fmtBytes(f.size)}</td>
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

            {/* ── KANAN: Laporan Harian ── */}
            <div className="w-full xl:w-72 shrink-0 space-y-3 order-first xl:order-last">
              <Card className="bg-[#0f1424] border-white/5">
                <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-blue-500/10 flex items-center justify-center">
                      <BarChart2 className="w-4 h-4 text-blue-400" />
                    </div>
                    <span className="text-sm font-semibold text-white">Laporan Harian</span>
                  </div>
                  <button onClick={fetchFiles} disabled={loading}
                    className="text-gray-500 hover:text-white transition-colors disabled:opacity-40">
                    <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
                  </button>
                </div>

                {loading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                  </div>
                ) : dailyStats.length === 0 ? (
                  <div className="text-center py-8 text-gray-500 text-xs">Tidak ada data</div>
                ) : (
                  <div className="divide-y divide-white/5 max-h-[70vh] overflow-y-auto">
                    {dailyStats.map((stat) => (
                      <div key={stat.date} className="px-4 py-3 space-y-2">
                        {/* Date header */}
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                            <span className="text-blue-400">📁</span> {stat.label}
                          </span>
                          <span className="text-xs text-gray-500">{stat.count} file</span>
                        </div>

                        {/* Size */}
                        <p className="text-[11px] text-gray-500">{fmtBytes(stat.totalSize)}</p>

                        {/* Delete button */}
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <button disabled={deleting}
                              className="w-full text-[11px] py-1 rounded-lg border border-red-500/20 bg-red-500/5 text-red-400 hover:bg-red-500/10 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-40">
                              <Trash2 className="w-3 h-3" /> Hapus {stat.count} file tanggal ini
                            </button>
                          </AlertDialogTrigger>
                          <AlertDialogContent className="bg-[#1a1f35] border-white/10">
                            <AlertDialogHeader>
                              <AlertDialogTitle className="text-white">Hapus file {stat.label}?</AlertDialogTitle>
                              <AlertDialogDescription className="text-gray-400">
                                {stat.count} file ({fmtBytes(stat.totalSize)}) akan dihapus permanen dari Storage.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel className="bg-transparent border-white/20 text-gray-300 hover:bg-white/10">Batal</AlertDialogCancel>
                              <AlertDialogAction onClick={() => deleteByDate(stat)} className="bg-red-600 text-white hover:bg-red-700">Hapus</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>

          </div>
        </main>
      </div>
    </div>
  );
};

export default StorageManager;
