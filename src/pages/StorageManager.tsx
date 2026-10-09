import { useEffect, useMemo, useState, useCallback } from "react";
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
import { Loader2, Trash2, RefreshCw, HardDrive, Search, Menu, BarChart2, Eye, X, Database, Cloud } from "lucide-react";
import AdminSidebar from "@/components/AdminSidebar";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

/** File dari DB (receipts table) */
interface FileRow {
  id: string;
  image_url: string;
  nomor_hp: string;
  status: string;
  created_at: string;
}

/** File dari R2 langsung (orphan + semua) */
interface R2FileRow {
  name: string;
  size: number;
  lastModified: string;
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

type Tab = "db" | "r2";

const StorageManager = () => {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [tab, setTab] = useState<Tab>("r2");

  // ── DB tab state ──
  const [files, setFiles] = useState<FileRow[]>([]);
  const [loadingDb, setLoadingDb] = useState(false);
  const [deletingDb, setDeletingDb] = useState(false);
  const [search, setSearch] = useState("");

  // ── R2 tab state ──
  const [r2Files, setR2Files] = useState<R2FileRow[]>([]);
  const [loadingR2, setLoadingR2] = useState(false);
  const [deletingR2, setDeletingR2] = useState(false);
  const [r2Search, setR2Search] = useState("");
  const [selectedR2, setSelectedR2] = useState<Set<string>>(new Set());

  // ── Preview ──
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  /* ── Auth ── */
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) { navigate("/admin/login"); return; }
      fetchR2Files();
      fetchDbFiles();
    })();
    // eslint-disable-next-line
  }, []);

  /* ── Fetch DB ── */
  const fetchDbFiles = async () => {
    setLoadingDb(true);
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
      toast({ title: "Gagal memuat DB", description: e.message, variant: "destructive" });
    }
    setLoadingDb(false);
  };

  /* ── Fetch R2 langsung ── */
  const fetchR2Files = async () => {
    setLoadingR2(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const SUPABASE_URL = (supabase as any).supabaseUrl as string;
      const res = await fetch(`${SUPABASE_URL}/functions/v1/r2-list`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setR2Files(json.files || []);
    } catch (e: any) {
      toast({ title: "Gagal memuat R2", description: e.message, variant: "destructive" });
    }
    setLoadingR2(false);
  };

  /* ── DB stats ── */
  const approvedFiles = useMemo(() => files.filter(f => f.status === "Approved"), [files]);
  const pendingFiles  = useMemo(() => files.filter(f => f.status === "Pending"),  [files]);
  const filteredDb    = useMemo(() => {
    if (!search.trim()) return files;
    const q = search.toLowerCase();
    return files.filter(f =>
      f.nomor_hp?.toLowerCase().includes(q) ||
      f.image_url?.toLowerCase().includes(q)
    );
  }, [files, search]);

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

  /* ── R2 stats ── */
  const filteredR2 = useMemo(() => {
    if (!r2Search.trim()) return r2Files;
    const q = r2Search.toLowerCase();
    return r2Files.filter(f => f.name.toLowerCase().includes(q));
  }, [r2Files, r2Search]);

  const totalR2Size = useMemo(() => r2Files.reduce((s, f) => s + f.size, 0), [r2Files]);

  // Set nama file yang ada di DB (untuk highlight orphan)
  const dbFileNames = useMemo(() => {
    const s = new Set<string>();
    for (const f of files) {
      if (!f.image_url) continue;
      try {
        const u = new URL(f.image_url);
        const name = u.pathname.replace(/^\/+/, "").split("/").pop() || "";
        if (name) s.add(name);
      } catch {
        // ignore
      }
    }
    return s;
  }, [files]);

  /* ── DB Delete helpers ── */
  const deleteDbFiles = async (ids: string[], urls: string[], label: string) => {
    if (urls.length === 0) return;
    setDeletingDb(true);
    try {
      for (let i = 0; i < urls.length; i += 20) {
        await deleteReceiptFiles(urls.slice(i, i + 20));
      }
      for (let i = 0; i < ids.length; i += 500) {
        await supabase.from("receipts").update({ image_url: "" }).in("id", ids.slice(i, i + 500));
      }
      toast({ title: `${urls.length} gambar ${label} dihapus 🗑️` });
      fetchDbFiles();
      fetchR2Files();
    } catch (e: any) {
      toast({ title: "Gagal hapus", description: e.message, variant: "destructive" });
    }
    setDeletingDb(false);
  };

  /* ── R2 Delete helpers ── */
  const deleteR2ByNames = async (names: string[], label: string) => {
    if (names.length === 0) return;
    setDeletingR2(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const SUPABASE_URL = (supabase as any).supabaseUrl as string;
      const res = await fetch(`${SUPABASE_URL}/functions/v1/r2-list`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ names }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      toast({ title: `${json.deleted} file R2 ${label} dihapus 🗑️` });
      setSelectedR2(new Set());
      fetchR2Files();
    } catch (e: any) {
      toast({ title: "Gagal hapus R2", description: e.message, variant: "destructive" });
    }
    setDeletingR2(false);
  };

  const toggleSelectR2 = useCallback((name: string) => {
    setSelectedR2(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }, []);

  const selectAllFilteredR2 = () => {
    setSelectedR2(new Set(filteredR2.map(f => f.name)));
  };

  const clearSelectionR2 = () => setSelectedR2(new Set());

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
          <Button variant="ghost" size="sm"
            onClick={() => { fetchR2Files(); fetchDbFiles(); }}
            disabled={loadingR2 || loadingDb}
            className="text-gray-400 hover:text-white">
            <RefreshCw className={`w-4 h-4 ${(loadingR2 || loadingDb) ? "animate-spin" : ""}`} />
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
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="ghost"
                onClick={() => { fetchR2Files(); fetchDbFiles(); }}
                disabled={loadingR2 || loadingDb}
                className="h-8 text-gray-400 hover:text-white gap-1.5">
                <RefreshCw className={`w-3.5 h-3.5 ${(loadingR2 || loadingDb) ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mb-4 bg-[#0f1424] p-1 rounded-xl border border-white/5 w-fit">
            <button
              onClick={() => setTab("r2")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                tab === "r2"
                  ? "bg-purple-600 text-white shadow"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              <Cloud className="w-3.5 h-3.5" />
              R2 Files <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${tab === "r2" ? "bg-white/20" : "bg-white/5"}`}>{r2Files.length}</span>
            </button>
            <button
              onClick={() => setTab("db")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                tab === "db"
                  ? "bg-blue-600 text-white shadow"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              <Database className="w-3.5 h-3.5" />
              DB Records <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${tab === "db" ? "bg-white/20" : "bg-white/5"}`}>{files.length}</span>
            </button>
          </div>

          {/* ══════════════ TAB R2 ══════════════ */}
          {tab === "r2" && (
            <div className="flex flex-col xl:flex-row gap-4 items-start">

              {/* KIRI: File list R2 */}
              <div className="flex-1 min-w-0 space-y-3 order-last xl:order-first">

                <Card className="bg-[#0f1424] border-white/5">
                  <CardContent className="p-3 md:p-4 space-y-3">
                    {/* Stats */}
                    <div className="flex flex-wrap gap-2">
                      <span className="text-xs px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-gray-300">
                        Total R2: <span className="text-white font-semibold">{r2Files.length}</span> file
                      </span>
                      <span className="text-xs px-2.5 py-1 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-300">
                        Ukuran: <span className="font-semibold">{fmtBytes(totalR2Size)}</span>
                      </span>
                      {selectedR2.size > 0 && (
                        <span className="text-xs px-2.5 py-1 rounded-full bg-orange-500/10 border border-orange-500/20 text-orange-300">
                          Dipilih: <span className="font-semibold">{selectedR2.size}</span>
                        </span>
                      )}
                    </div>

                    {/* Search + select tools */}
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
                        <Input
                          value={r2Search} onChange={(e) => setR2Search(e.target.value)}
                          placeholder="Cari nama file..."
                          className="pl-8 h-9 text-xs bg-[#1a1f35] border-white/10 text-white placeholder:text-gray-600"
                        />
                      </div>
                      <Button size="sm" variant="ghost"
                        onClick={selectedR2.size > 0 ? clearSelectionR2 : selectAllFilteredR2}
                        className="h-9 text-xs text-gray-400 hover:text-white border border-white/10 px-3">
                        {selectedR2.size > 0 ? "Batal Pilih" : "Pilih Semua"}
                      </Button>
                    </div>

                    {/* Action buttons */}
                    <div className="grid grid-cols-2 gap-2">
                      {/* Hapus Terpilih */}
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" disabled={deletingR2 || selectedR2.size === 0}
                            className="h-9 gap-1.5 text-xs bg-orange-700/80 hover:bg-orange-700 text-white w-full">
                            {deletingR2 ? <Loader2 className="w-3 h-3 animate-spin shrink-0" /> : <Trash2 className="w-3 h-3 shrink-0" />}
                            <span className="truncate">Hapus Terpilih ({selectedR2.size})</span>
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent className="bg-[#1a1f35] border-white/10">
                          <AlertDialogHeader>
                            <AlertDialogTitle className="text-white">Hapus {selectedR2.size} file terpilih?</AlertDialogTitle>
                            <AlertDialogDescription className="text-gray-400">
                              File akan dihapus permanen dari R2. Tindakan ini tidak bisa dibatalkan.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel className="bg-transparent border-white/20 text-gray-300 hover:bg-white/10">Batal</AlertDialogCancel>
                            <AlertDialogAction onClick={() => deleteR2ByNames([...selectedR2], "terpilih")} className="bg-orange-600 text-white hover:bg-orange-700">Hapus</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>

                      {/* Hapus Semua R2 */}
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" disabled={deletingR2 || r2Files.length === 0}
                            className="h-9 gap-1.5 text-xs bg-red-700/80 hover:bg-red-700 text-white w-full">
                            {deletingR2 ? <Loader2 className="w-3 h-3 animate-spin shrink-0" /> : <Trash2 className="w-3 h-3 shrink-0" />}
                            <span className="truncate">Hapus Semua ({r2Files.length})</span>
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent className="bg-[#1a1f35] border-white/10">
                          <AlertDialogHeader>
                            <AlertDialogTitle className="text-white">Hapus SEMUA {r2Files.length} file R2?</AlertDialogTitle>
                            <AlertDialogDescription className="text-gray-400">
                              Semua gambar di R2 akan dihapus permanen. Tindakan ini tidak bisa dibatalkan.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel className="bg-transparent border-white/20 text-gray-300 hover:bg-white/10">Batal</AlertDialogCancel>
                            <AlertDialogAction onClick={() => deleteR2ByNames(r2Files.map(f => f.name), "semua")} className="bg-red-600 text-white hover:bg-red-700">Hapus Semua</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </CardContent>
                </Card>

                {/* File list R2 */}
                <Card className="bg-[#0f1424] border-white/5 overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-white/5 flex items-center justify-between">
                    <span className="text-xs text-gray-400">
                      {loadingR2 ? "Memuat..." : <><span className="text-white font-semibold">{filteredR2.length}</span> file</>}
                    </span>
                    <span className="text-[10px] text-gray-600">Centang = pilih untuk hapus</span>
                  </div>

                  {loadingR2 ? (
                    <div className="flex items-center justify-center py-16">
                      <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                    </div>
                  ) : filteredR2.length === 0 ? (
                    <div className="text-center py-16 text-gray-500 text-sm">Tidak ada file ditemukan</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-white/5">
                            <th className="px-3 py-3 w-8"></th>
                            {["Nama File", "Ukuran", "Terakhir Diubah", ""].map((h) => (
                              <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {filteredR2.map((f) => {
                            const isOrphan = !dbFileNames.has(f.name);
                            const isSelected = selectedR2.has(f.name);
                            return (
                              <tr
                                key={f.name}
                                className={`hover:bg-white/3 transition-colors cursor-pointer ${isSelected ? "bg-orange-500/5" : ""}`}
                                onClick={() => toggleSelectR2(f.name)}
                              >
                                <td className="px-3 py-2.5">
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => {}}
                                    className="w-3.5 h-3.5 accent-orange-500"
                                    onClick={e => e.stopPropagation()}
                                  />
                                </td>
                                <td className="px-4 py-2.5 max-w-[200px]">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-white font-mono text-xs truncate">{f.name}</span>
                                    {isOrphan && (
                                      <span className="shrink-0 text-[9px] px-1 py-0.5 rounded bg-red-500/10 border border-red-500/20 text-red-400">orphan</span>
                                    )}
                                  </div>
                                </td>
                                <td className="px-4 py-2.5 text-gray-400 text-xs whitespace-nowrap">{fmtBytes(f.size)}</td>
                                <td className="px-4 py-2.5 text-gray-400 text-xs whitespace-nowrap">
                                  {f.lastModified ? new Date(f.lastModified).toLocaleString("id-ID", {
                                    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"
                                  }) : "—"}
                                </td>
                                <td className="px-4 py-2.5" onClick={e => e.stopPropagation()}>
                                  <div className="flex items-center gap-2">
                                    <button
                                      onClick={() => setPreviewUrl(
                                        `${(supabase as any).supabaseUrl}/functions/v1/r2-image?file=${encodeURIComponent(f.name)}`
                                      )}
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
                                          <AlertDialogTitle className="text-white">Hapus file ini?</AlertDialogTitle>
                                          <AlertDialogDescription className="text-gray-400">
                                            <span className="font-mono text-xs text-white">{f.name}</span> akan dihapus permanen dari R2.
                                          </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                          <AlertDialogCancel className="bg-transparent border-white/20 text-gray-300 hover:bg-white/10">Batal</AlertDialogCancel>
                                          <AlertDialogAction
                                            onClick={() => deleteR2ByNames([f.name], "")}
                                            className="bg-red-600 text-white hover:bg-red-700"
                                          >Hapus</AlertDialogAction>
                                        </AlertDialogFooter>
                                      </AlertDialogContent>
                                    </AlertDialog>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
              </div>

              {/* KANAN: Summary R2 */}
              <div className="w-full xl:w-72 shrink-0 space-y-3 order-first xl:order-last">
                <Card className="bg-[#0f1424] border-white/5">
                  <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-purple-500/10 flex items-center justify-center">
                        <Cloud className="w-4 h-4 text-purple-400" />
                      </div>
                      <span className="text-sm font-semibold text-white">R2 Summary</span>
                    </div>
                    <button onClick={fetchR2Files} disabled={loadingR2}
                      className="text-gray-500 hover:text-white transition-colors disabled:opacity-40">
                      <RefreshCw className={`w-3.5 h-3.5 ${loadingR2 ? "animate-spin" : ""}`} />
                    </button>
                  </div>

                  <div className="p-4 space-y-3">
                    {[
                      { label: "Total File", value: r2Files.length, color: "text-white" },
                      { label: "Total Ukuran", value: fmtBytes(totalR2Size), color: "text-purple-300" },
                      { label: "Ada di DB", value: r2Files.filter(f => dbFileNames.has(f.name)).length, color: "text-green-300" },
                      { label: "Orphan (tidak di DB)", value: r2Files.filter(f => !dbFileNames.has(f.name)).length, color: "text-red-300" },
                    ].map(({ label, value, color }) => (
                      <div key={label} className="flex items-center justify-between">
                        <span className="text-xs text-gray-500">{label}</span>
                        <span className={`text-xs font-semibold ${color}`}>{value}</span>
                      </div>
                    ))}
                  </div>

                  {/* Hapus semua orphan */}
                  {r2Files.filter(f => !dbFileNames.has(f.name)).length > 0 && (
                    <div className="px-4 pb-4">
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" disabled={deletingR2}
                            className="w-full h-9 gap-1.5 text-xs bg-red-700/60 hover:bg-red-700 text-white">
                            <Trash2 className="w-3 h-3" />
                            Hapus {r2Files.filter(f => !dbFileNames.has(f.name)).length} Orphan
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent className="bg-[#1a1f35] border-white/10">
                          <AlertDialogHeader>
                            <AlertDialogTitle className="text-white">Hapus semua file orphan?</AlertDialogTitle>
                            <AlertDialogDescription className="text-gray-400">
                              {r2Files.filter(f => !dbFileNames.has(f.name)).length} file R2 yang tidak terhubung ke DB akan dihapus permanen.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel className="bg-transparent border-white/20 text-gray-300 hover:bg-white/10">Batal</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deleteR2ByNames(
                                r2Files.filter(f => !dbFileNames.has(f.name)).map(f => f.name),
                                "orphan"
                              )}
                              className="bg-red-600 text-white hover:bg-red-700"
                            >Hapus Orphan</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  )}
                </Card>
              </div>
            </div>
          )}

          {/* ══════════════ TAB DB ══════════════ */}
          {tab === "db" && (
            <div className="flex flex-col xl:flex-row gap-4 items-start">

              {/* KIRI: Daftar dari DB */}
              <div className="flex-1 min-w-0 space-y-3 order-last xl:order-first">

                <Card className="bg-[#0f1424] border-white/5">
                  <CardContent className="p-3 md:p-4 space-y-3">
                    {/* Stats */}
                    <div className="flex flex-wrap gap-2">
                      <span className="text-xs px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-gray-300">
                        Total DB: <span className="text-white font-semibold">{files.length}</span> resi
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
                          <Button size="sm" disabled={deletingDb || approvedFiles.length === 0}
                            className="h-9 gap-1.5 text-xs bg-green-700/80 hover:bg-green-700 text-white w-full">
                            {deletingDb ? <Loader2 className="w-3 h-3 animate-spin shrink-0" /> : <Trash2 className="w-3 h-3 shrink-0" />}
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
                            <AlertDialogAction
                              onClick={() => deleteDbFiles(approvedFiles.map(f => f.id), approvedFiles.map(f => f.image_url), "Approved")}
                              className="bg-green-700 text-white hover:bg-green-800"
                            >Hapus</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>

                      {/* Hapus Semua */}
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" disabled={deletingDb || files.length === 0}
                            className="h-9 gap-1.5 text-xs bg-red-700/80 hover:bg-red-700 text-white w-full">
                            {deletingDb ? <Loader2 className="w-3 h-3 animate-spin shrink-0" /> : <Trash2 className="w-3 h-3 shrink-0" />}
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
                            <AlertDialogAction
                              onClick={() => deleteDbFiles(files.map(f => f.id), files.map(f => f.image_url), "semua")}
                              className="bg-red-600 text-white hover:bg-red-700"
                            >Hapus Semua</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </CardContent>
                </Card>

                {/* File list DB */}
                <Card className="bg-[#0f1424] border-white/5 overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-white/5">
                    <span className="text-xs text-gray-400">
                      {loadingDb ? "Memuat..." : <><span className="text-white font-semibold">{filteredDb.length}</span> resi dengan gambar</>}
                    </span>
                  </div>

                  {loadingDb ? (
                    <div className="flex items-center justify-center py-16">
                      <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                    </div>
                  ) : filteredDb.length === 0 ? (
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
                          {filteredDb.map((f) => (
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
                                          onClick={() => deleteDbFiles([f.id], [f.image_url], "")}
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

              {/* KANAN: Laporan Harian */}
              <div className="w-full xl:w-72 shrink-0 space-y-3 order-first xl:order-last">
                <Card className="bg-[#0f1424] border-white/5">
                  <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-blue-500/10 flex items-center justify-center">
                        <BarChart2 className="w-4 h-4 text-blue-400" />
                      </div>
                      <span className="text-sm font-semibold text-white">Per Hari</span>
                    </div>
                    <button onClick={fetchDbFiles} disabled={loadingDb}
                      className="text-gray-500 hover:text-white transition-colors disabled:opacity-40">
                      <RefreshCw className={`w-3.5 h-3.5 ${loadingDb ? "animate-spin" : ""}`} />
                    </button>
                  </div>

                  {loadingDb ? (
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
                              <button disabled={deletingDb}
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
                                <AlertDialogAction onClick={() => deleteDbFiles(stat.ids, stat.urls, `tanggal ${stat.label}`)} className="bg-red-600 text-white hover:bg-red-700">Hapus</AlertDialogAction>
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
          )}

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
