import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { deleteReceiptFiles, getImageProxyUrl } from "@/lib/deleteStorage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Trash2, RefreshCw, HardDrive, Search, Menu, BarChart2, Eye, X } from "lucide-react";
import AdminSidebar from "@/components/AdminSidebar";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

interface FileRow {
  id: string;
  image_url: string;
  nomor_hp: string;
  status: string;
  created_at: string;
}

interface DailyFileStat {
  date: string;
  label: string;
  count: number;
  ids: string[];
  urls: string[];
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
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  /* ── Fetch dari DB (bukan Supabase Storage) ── */
  const fetchFiles = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("receipts")
        .select("id, image_url, nomor_hp, status, created_at")
        .not("image_url", "is", null)
        .neq("image_url", "")
        .order("created_at", { ascending: false });
      if (error) throw error;
      setFiles((data || []) as FileRow[]);
    } catch (e: any) {
      toast({ title: "Gagal memuat", description: e.message, variant: "destructive" });
    }
    setLoading(false);
  };

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) { navigate("/admin/login"); return; }
      fetchFiles();
    })();
    // eslint-disable-next-line
  }, []);

  /* ── Filter ── */
  const filtered = useMemo(() => {
    if (!search.trim()) return files;
    const q = search.toLowerCase();
    return files.filter((f) =>
      f.nomor_hp?.toLowerCase().includes(q) ||
      f.image_url?.toLowerCase().includes(q)
    );
  }, [files, search]);

  /* ── Stats ── */
  const approvedFiles = useMemo(() => files.filter(f => f.status === "Approved"), [files]);
  const pendingFiles  = useMemo(() => files.filter(f => f.status === "Pending"),  [files]);

  /* ── Daily stats ── */
  const dailyStats = useMemo<DailyFileStat[]>(() => {
    const map = new Map<string, DailyFileStat>();
    for (const f of files) {
      const dateKey = f.created_at ? f.created_at.slice(0, 10) : "unknown";
      if (!map.has(dateKey)) {
        const d = f.created_at ? new Date(f.created_at) : new Date();
        map.set(dateKey, { date: dateKey, label: fmtDate(d), count: 0, ids: [], urls: [] });
      }
      const stat = map.get(dateKey)!;
      stat.count++;
      stat.ids.push(f.id);
      stat.urls.push(f.image_url);
    }
    return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
  }, [files]);

  /* ── Delete helpers ── */
  const deleteFiles = async (ids: string[], urls: string[], label: string) => {
    if (urls.length === 0) return;
    setDeleting(true);
    try {
      // Hapus file dari R2
      for (let i = 0; i < urls.length; i += 20) {
        await deleteReceiptFiles(urls.slice(i, i + 20));
      }
      // Reset image_url di DB
      for (let i = 0; i < ids.length; i += 500) {
        await supabase.from("receipts").update({ image_url: "" }).in("id", ids.slice(i, i + 500));
      }
      toast({ title: `${urls.length} gambar ${label} dihapus 🗑️` });
      fetchFiles();
    } catch (e: any) {
      toast({ title: "Gagal hapus", description: e.message, variant: "destructive" });
    }
    setDeleting(false);
  };

  const deleteApproved = async () => {
    setDeletingApproved(true);
    const ids  = approvedFiles.map(f => f.id);
    const urls = approvedFiles.map(f => f.image_url);
    await deleteFiles(ids, urls, "Approved");
    setDeletingApproved(false);
  };

  const deleteByDate = (stat: DailyFileStat) =>
    deleteFiles(stat.ids, stat.urls, `tanggal ${stat.label}`);

  const deleteAll = () =>
    deleteFiles(files.map(f => f.id), files.map(f => f.image_url), "semua");

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
              <p className="text-xs text-gray-400">Kelola gambar resi di Cloudflare R2</p>
            </div>
          </div>

          <div className="flex flex-col xl:flex-row gap-4 items-start">

            {/* ── KIRI: Daftar File ── */}
            <div className="flex-1 min-w-0 space-y-3 order-last xl:order-first">

              <Card className="bg-[#0f1424] border-white/5">
                <CardContent className="p-3 md:p-4 space-y-3">
                  {/* Stats */}
                  <div className="flex flex-wrap gap-2">
                    <span className="text-xs px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-gray-300">
                      Total: <span className="text-white font-semibold">{files.length}</span> gambar
                    </span>
                    <span className="text-xs px-2.5 py-1 rounded-full bg-green-500/10 border border-green-500/20 text-green-300">
                      Approved: <span className="font-semibold">{approvedFiles.length}</span>
                    </span>
                    <span className="text-xs px-2.5 py-1 rounded-full bg-yellow-500/10 border border-yellow-500/20 text-yellow-300">
                      Pending: <span className="font-semibold">{pendingFiles.length}</span>
                    </span>
                  </div>

                  {/* Search */}
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
                    <Input
                      value={search} onChange={(e) => setSearch(e.target.value)}
                      placeholder="Cari nomor HP..."
                      className="pl-8 h-9 text-xs bg-[#1a1f35] border-white/10 text-white placeholder:text-gray-600"
                    />
                  </div>

                  {/* Action buttons */}
                  <div className="grid grid-cols-2 gap-2">
                    {/* Hapus Approved */}
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" disabled={deletingApproved || approvedFiles.length === 0}
                          className="h-9 gap-1.5 text-xs bg-green-700/80 hover:bg-green-700 text-white w-full">
                          {deletingApproved ? <Loader2 className="w-3 h-3 animate-spin shrink-0" /> : <Trash2 className="w-3 h-3 shrink-0" />}
                          <span className="truncate">Hapus Approved ({approvedFiles.length})</span>
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="bg-[#1a1f35] border-white/10">
                        <AlertDialogHeader>
                          <AlertDialogTitle className="text-white">Hapus gambar Approved?</AlertDialogTitle>
                          <AlertDialogDescription className="text-gray-400">
                            {approvedFiles.length} gambar resi berstatus <b className="text-green-400">Approved</b> akan dihapus dari R2.
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
                          className="h-9 gap-1.5 text-xs bg-red-700/80 hover:bg-red-700 text-white w-full">
                          {deleting ? <Loader2 className="w-3 h-3 animate-spin shrink-0" /> : <Trash2 className="w-3 h-3 shrink-0" />}
                          <span className="truncate">Hapus Semua ({files.length})</span>
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="bg-[#1a1f35] border-white/10">
                        <AlertDialogHeader>
                          <AlertDialogTitle className="text-white">Hapus SEMUA {files.length} gambar?</AlertDialogTitle>
                          <AlertDialogDescription className="text-gray-400">
                            Semua gambar di R2 akan dihapus permanen termasuk yang Pending.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel className="bg-transparent border-white/20 text-gray-300 hover:bg-white/10">Batal</AlertDialogCancel>
                          <AlertDialogAction onClick={deleteAll} className="bg-red-600 text-white hover:bg-red-700">Hapus Semua</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </CardContent>
              </Card>

              {/* File list */}
              <Card className="bg-[#0f1424] border-white/5 overflow-hidden">
                <div className="px-4 py-2.5 border-b border-white/5">
                  <span className="text-xs text-gray-400">
                    {loading ? "Memuat..." : <><span className="text-white font-semibold">{filtered.length}</span> gambar</>}
                  </span>
                </div>

                {loading ? (
                  <div className="flex items-center justify-center py-16">
                    <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="text-center py-16 text-gray-500 text-sm">Tidak ada gambar ditemukan</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-white/5">
                          {["Nomor HP", "Tanggal", "Status", ""].map((h) => (
                            <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {filtered.map((f) => (
                          <tr key={f.id} className="hover:bg-white/3 transition-colors">
                            <td className="px-4 py-2.5 text-white font-mono text-xs">{f.nomor_hp || "—"}</td>
                            <td className="px-4 py-2.5 text-gray-400 text-xs">
                              {f.created_at ? new Date(f.created_at).toLocaleString("id-ID", {
                                day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"
                              }) : "—"}
                            </td>
                            <td className="px-4 py-2.5">
                              <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                                f.status === "Approved"
                                  ? "bg-green-500/10 text-green-400"
                                  : "bg-yellow-500/10 text-yellow-400"
                              }`}>{f.status}</span>
                            </td>
                            <td className="px-4 py-2.5">
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => setPreviewUrl(getImageProxyUrl(f.image_url))}
                                  className="p-1.5 rounded bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
                                  title="Preview"
                                >
                                  <Eye className="w-3 h-3 text-gray-400" />
                                </button>
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <button
                                      className="p-1.5 rounded bg-red-500/5 hover:bg-red-500/10 border border-red-500/20 transition-colors"
                                      title="Hapus"
                                    >
                                      <Trash2 className="w-3 h-3 text-red-400" />
                                    </button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent className="bg-[#1a1f35] border-white/10">
                                    <AlertDialogHeader>
                                      <AlertDialogTitle className="text-white">Hapus gambar ini?</AlertDialogTitle>
                                      <AlertDialogDescription className="text-gray-400">
                                        Gambar resi {f.nomor_hp} akan dihapus permanen dari R2.
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel className="bg-transparent border-white/20 text-gray-300 hover:bg-white/10">Batal</AlertDialogCancel>
                                      <AlertDialogAction
                                        onClick={() => deleteFiles([f.id], [f.image_url], "")}
                                        className="bg-red-600 text-white hover:bg-red-700"
                                      >Hapus</AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
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
                    <span className="text-sm font-semibold text-white">Per Hari</span>
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
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                            <span className="text-blue-400">📁</span> {stat.label}
                          </span>
                          <span className="text-xs text-gray-500">{stat.count} file</span>
                        </div>
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
                                {stat.count} gambar akan dihapus permanen dari R2.
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

      {/* Preview Modal */}
      <Dialog open={!!previewUrl} onOpenChange={(open) => { if (!open) setPreviewUrl(null); }}>
        <DialogContent className="max-w-[95vw] sm:max-w-2xl p-0 overflow-hidden [&>button]:hidden bg-transparent border-none shadow-none">
          <DialogTitle className="sr-only">Preview Gambar</DialogTitle>
          <div className="relative bg-[#1a1f35] rounded-lg border-2 border-white/10 shadow-xl overflow-hidden">
            <button onClick={() => setPreviewUrl(null)} className="absolute right-2 top-2 z-50 rounded-full bg-white/90 text-[#0a0e1a] p-2 shadow-lg hover:bg-white transition-colors">
              <X className="h-5 w-5" />
            </button>
            {previewUrl && <img src={previewUrl} alt="Preview Resi" className="w-full max-h-[80vh] object-contain" />}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default StorageManager;
