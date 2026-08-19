import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Loader2, Trash2, RefreshCw, HardDrive, Search, Menu, CheckCircle } from "lucide-react";
import ThemeToggle from "@/components/ThemeToggle";
import AdminSidebar from "@/components/AdminSidebar";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

interface FileRow {
  name: string;
  size: number;
  created_at: string;
}

const BUCKET = "receipts";
const PAGE_SIZE = 1000;

// File format: wa_{nomor}_{timestampMs}.jpg
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

const StorageManager = () => {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  const fetchFiles = async () => {
    setLoading(true);
    setSelected(new Set());
    const all: FileRow[] = [];
    let offset = 0;
    try {
      while (true) {
        const { data, error } = await supabase.storage.from(BUCKET).list("", {
          limit: PAGE_SIZE,
          offset,
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

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) { navigate("/admin/login"); return; }
      fetchFiles();
    })();
    // eslint-disable-next-line
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return files;
    const q = search.toLowerCase();
    return files.filter((f) => {
      const { nomor } = parseName(f.name);
      return f.name.toLowerCase().includes(q) || nomor.includes(q);
    });
  }, [files, search]);

  const totalSize = useMemo(() => files.reduce((a, b) => a + b.size, 0), [files]);

  const toggleAllVisible = (checked: boolean) => {
    const next = new Set(selected);
    if (checked) filtered.forEach((f) => next.add(f.name));
    else filtered.forEach((f) => next.delete(f.name));
    setSelected(next);
  };

  const toggleOne = (name: string, checked: boolean) => {
    const next = new Set(selected);
    if (checked) next.add(name); else next.delete(name);
    setSelected(next);
  };

  const removeFiles = async (names: string[], label: string) => {
    if (names.length === 0) return;
    setDeleting(true);
    try {
      const CHUNK = 100;
      let removed = 0;
      for (let i = 0; i < names.length; i += CHUNK) {
        const chunk = names.slice(i, i + CHUNK);
        const { error } = await supabase.storage.from(BUCKET).remove(chunk);
        if (error) throw error;
        removed += chunk.length;
      }
      toast({ title: `${removed} file ${label} berhasil dihapus 🗑️` });
      fetchFiles();
    } catch (e: any) {
      toast({ title: "Gagal hapus", description: e.message, variant: "destructive" });
    }
    setDeleting(false);
  };

  const deleteSelected = () => removeFiles(Array.from(selected), "terpilih");
  const deleteAll = () => removeFiles(files.map((f) => f.name), "");

  const allVisibleSelected = filtered.length > 0 && filtered.every((f) => selected.has(f.name));

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
              <h1 className="text-sm md:text-xl font-bold text-white truncate">Storage Manager</h1>
              <p className="text-[11px] md:text-sm text-gray-400 mt-0.5 truncate">Kelola file gambar resi</p>
            </div>

            <div className="lg:hidden shrink-0">
              <ThemeToggle />
            </div>
          </div>
        </header>

        <main className="px-4 py-4 md:px-6 md:py-6 max-w-6xl mx-auto space-y-4 md:space-y-5">
          <div className="grid grid-cols-3 gap-2 md:gap-4">
            <Card className="bg-[#0f1424] border-2 border-blue-500/30 shadow-[0_0_15px_rgba(59,130,246,0.15)]">
              <CardContent className="p-3 md:py-4 text-center">
                <p className="text-xl md:text-3xl font-bold text-blue-400 tabular-nums">{files.length}</p>
                <p className="text-[10px] md:text-xs text-gray-400 mt-1">Total File</p>
              </CardContent>
            </Card>
            <Card className="bg-[#0f1424] border-2 border-green-500/30 shadow-[0_0_15px_rgba(34,197,94,0.15)]">
              <CardContent className="p-3 md:py-4 text-center">
                <p className="text-sm md:text-3xl font-bold text-green-400 tabular-nums">{fmtBytes(totalSize)}</p>
                <p className="text-[10px] md:text-xs text-gray-400 mt-1">Total Ukuran</p>
              </CardContent>
            </Card>
            <Card className="bg-[#0f1424] border-2 border-purple-500/30 shadow-[0_0_15px_rgba(168,85,247,0.15)]">
              <CardContent className="p-3 md:py-4 text-center">
                <p className="text-xl md:text-3xl font-bold text-purple-400 tabular-nums">{selected.size}</p>
                <p className="text-[10px] md:text-xs text-gray-400 mt-1">Terpilih</p>
              </CardContent>
            </Card>
          </div>

          <Card className="bg-[#0f1424] border-2 border-purple-500/30 shadow-[0_0_15px_rgba(168,85,247,0.15)]">
            <CardContent className="p-4 md:py-4 flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3">
              <div className="relative w-full sm:flex-1 sm:min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                <Input
                  placeholder="Cari nama / nomor HP..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 bg-[#1a1f35] border-white/10 text-white placeholder:text-gray-500 focus:border-purple-500/50 h-10"
                />
              </div>
              <div className="grid grid-cols-3 sm:flex sm:items-center gap-2 sm:gap-3">
              <Button variant="outline" onClick={fetchFiles} disabled={loading} className="bg-[#1a1f35] border-white/10 text-gray-300 hover:bg-white/10 h-10 text-[11px] md:text-sm px-2 md:px-4">
                {loading ? <Loader2 className="h-4 w-4 md:mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 md:mr-1" />}
                <span className="hidden md:inline">Refresh</span>
              </Button>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button className="bg-red-600 hover:bg-red-700 text-white h-10 text-[11px] md:text-sm px-2 md:px-4" disabled={deleting || selected.size === 0}>
                    <Trash2 className="h-4 w-4 md:mr-1 shrink-0" />
                    <span className="ml-1 md:ml-0 truncate"><span className="hidden md:inline">Hapus </span>Terpilih ({selected.size})</span>
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="bg-[#1a1f35] border-white/10">
                  <AlertDialogHeader>
                    <AlertDialogTitle className="text-white">Hapus {selected.size} file terpilih?</AlertDialogTitle>
                    <AlertDialogDescription className="text-gray-400">
                      File akan dihapus permanen dari Storage. Data resi di database tidak ikut terhapus.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="bg-transparent border-white/20 text-gray-300 hover:bg-white/10">Batal</AlertDialogCancel>
                    <AlertDialogAction onClick={deleteSelected} className="bg-red-600 text-white hover:bg-red-700">
                      Hapus
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button className="bg-red-600 hover:bg-red-700 text-white h-10 text-[11px] md:text-sm px-2 md:px-4" disabled={deleting || files.length === 0}>
                    {deleting ? <Loader2 className="h-4 w-4 md:mr-1 animate-spin shrink-0" /> : <Trash2 className="h-4 w-4 md:mr-1 shrink-0" />}
                    <span className="ml-1 md:ml-0 truncate"><span className="hidden md:inline">Hapus </span>Semua ({files.length})</span>
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="bg-[#1a1f35] border-white/10">
                  <AlertDialogHeader>
                    <AlertDialogTitle className="text-white">Hapus SEMUA {files.length} file?</AlertDialogTitle>
                    <AlertDialogDescription className="text-gray-400">
                      Semua gambar di bucket <b className="text-white">{BUCKET}</b> akan dihapus permanen.
                      Data resi di database TIDAK ikut dihapus.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="bg-transparent border-white/20 text-gray-300 hover:bg-white/10">Batal</AlertDialogCancel>
                    <AlertDialogAction onClick={deleteAll} className="bg-red-600 text-white hover:bg-red-700">
                      Hapus Semua
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-[#0f1424] border-white/5">
            <CardHeader className="p-4 pb-3 border-b border-white/5">
              <CardTitle className="text-sm md:text-base text-white">Daftar File ({filtered.length})</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="p-8 text-center text-gray-400">Memuat...</div>
              ) : filtered.length === 0 ? (
                <div className="p-8 text-center text-gray-400">Tidak ada file</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-[#1a1f35] hover:bg-[#1a1f35] border-b border-white/5">
                      <TableHead className="w-8 px-2">
                        <Checkbox checked={allVisibleSelected} onCheckedChange={(c) => toggleAllVisible(!!c)} aria-label="Pilih semua" className="border-white/20" />
                      </TableHead>
                      <TableHead className="text-gray-300 text-[10px] md:text-xs px-2 md:px-4">Nomor HP</TableHead>
                      <TableHead className="text-gray-300 text-[10px] md:text-xs px-2 md:px-4">Tanggal &amp; Jam</TableHead>
                      <TableHead className="text-right text-gray-300 text-[10px] md:text-xs px-2 md:px-4">Ukuran</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((f) => {
                      const { nomor, date } = parseName(f.name);
                      return (
                        <TableRow key={f.name} className="border-b border-white/5 hover:bg-white/5">
                          <TableCell className="px-2">
                            <Checkbox checked={selected.has(f.name)} onCheckedChange={(c) => toggleOne(f.name, !!c)} className="border-white/20" />
                          </TableCell>
                          <TableCell className="font-mono text-[11px] md:text-sm text-white px-2 md:px-4">{nomor}</TableCell>
                          <TableCell className="text-[10px] md:text-sm text-gray-300 px-2 md:px-4 whitespace-nowrap">
                            {date ? date.toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "-"}
                          </TableCell>
                          <TableCell className="text-right font-mono text-[10px] md:text-xs text-gray-300 px-2 md:px-4">{fmtBytes(f.size)}</TableCell>
                        </TableRow>
                      );
                    })}
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

export default StorageManager;
