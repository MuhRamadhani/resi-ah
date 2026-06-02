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
import { ArrowLeft, Loader2, Trash2, RefreshCw, HardDrive, Search } from "lucide-react";
import ThemeToggle from "@/components/ThemeToggle";

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
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card sticky top-0 z-10">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/admin/dashboard")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-2">
              <HardDrive className="h-5 w-5 text-primary" />
              <h1 className="text-lg font-semibold">Storage Manager</h1>
            </div>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 max-w-5xl space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Card><CardContent className="py-3 text-center">
            <p className="text-2xl font-bold">{files.length}</p>
            <p className="text-xs text-muted-foreground">Total File</p>
          </CardContent></Card>
          <Card><CardContent className="py-3 text-center">
            <p className="text-2xl font-bold">{fmtBytes(totalSize)}</p>
            <p className="text-xs text-muted-foreground">Total Ukuran</p>
          </CardContent></Card>
          <Card className="col-span-2 md:col-span-1"><CardContent className="py-3 text-center">
            <p className="text-2xl font-bold text-primary">{selected.size}</p>
            <p className="text-xs text-muted-foreground">Terpilih</p>
          </CardContent></Card>
        </div>

        <Card>
          <CardContent className="py-4 flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Cari nama / nomor HP..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8"
              />
            </div>
            <Button variant="outline" onClick={fetchFiles} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
              Refresh
            </Button>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={deleting || selected.size === 0}>
                  <Trash2 className="h-4 w-4 mr-1" />
                  Hapus Terpilih ({selected.size})
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Hapus {selected.size} file terpilih?</AlertDialogTitle>
                  <AlertDialogDescription>
                    File akan dihapus permanen dari Storage. Data resi di database tidak ikut terhapus.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Batal</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={deleteSelected}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Hapus
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={deleting || files.length === 0}>
                  {deleting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1" />}
                  Hapus Semua ({files.length})
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Hapus SEMUA {files.length} file?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Semua gambar di bucket <b>{BUCKET}</b> akan dihapus permanen.
                    Data resi di database TIDAK ikut dihapus.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Batal</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={deleteAll}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Hapus Semua
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Daftar File ({filtered.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-8 text-center text-muted-foreground">Memuat...</div>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">Tidak ada file</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          checked={allVisibleSelected}
                          onCheckedChange={(c) => toggleAllVisible(!!c)}
                          aria-label="Pilih semua"
                        />
                      </TableHead>
                      <TableHead>Nomor HP</TableHead>
                      <TableHead>Tanggal & Jam</TableHead>
                      <TableHead className="text-right">Ukuran</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((f) => {
                      const { nomor, date } = parseName(f.name);
                      return (
                        <TableRow key={f.name}>
                          <TableCell>
                            <Checkbox
                              checked={selected.has(f.name)}
                              onCheckedChange={(c) => toggleOne(f.name, !!c)}
                            />
                          </TableCell>
                          <TableCell className="font-mono text-sm">{nomor}</TableCell>
                          <TableCell className="text-sm">
                            {date
                              ? date.toLocaleString("id-ID", {
                                  day: "2-digit", month: "short", year: "numeric",
                                  hour: "2-digit", minute: "2-digit",
                                })
                              : "-"}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">{fmtBytes(f.size)}</TableCell>
                        </TableRow>
                      );
                    })}
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

export default StorageManager;
