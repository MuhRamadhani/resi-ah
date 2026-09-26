import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Menu, ShieldX, Trash2, Plus, Loader2, Phone, User, LogOut, MessageCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import AdminSidebar from "@/components/AdminSidebar";

type BlockedType = "name" | "phone" | "sender";

interface BlockedItem {
  id: string;
  type: BlockedType;
  value: string;
  note: string | null;
  created_at: string;
}

const BlockedList = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [items, setItems] = useState<BlockedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [type, setType] = useState<BlockedType>("name");
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchItems = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("blocked_identifiers")
      .select("*")
      .order("created_at", { ascending: false });
    if (!error && data) setItems(data as BlockedItem[]);
    setLoading(false);
  };

  useEffect(() => {
    fetchItems();
  }, []);

  const handleAdd = async () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setAdding(true);
    const { error } = await supabase.from("blocked_identifiers").insert({
      type,
      value: trimmed,
      note: note.trim() || null,
    });
    if (error) {
      toast({ title: "Gagal menambah", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Berhasil ditambah!", description: `"${trimmed}" masuk daftar blokir.` });
      setValue("");
      setNote("");
      await fetchItems();
    }
    setAdding(false);
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    const { error } = await supabase.from("blocked_identifiers").delete().eq("id", id);
    if (error) {
      toast({ title: "Gagal menghapus", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Dihapus", description: "Item berhasil dihapus dari daftar blokir." });
      setItems(prev => prev.filter(i => i.id !== id));
    }
    setDeletingId(null);
  };

  const logout = async () => {
    await supabase.auth.signOut();
    navigate("/admin/login");
  };

  const names = items.filter(i => i.type === "name");
  const phones = items.filter(i => i.type === "phone");
  const senders = items.filter(i => i.type === "sender");

  return (
    <div className="min-h-screen bg-[#0a0e1a] flex">
      <AdminSidebar variant="desktop" />

      {/* Main Content */}
      <div className="flex-1 lg:ml-56 flex flex-col min-h-screen">
        {/* Top bar mobile */}
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
          <span className="text-sm font-semibold text-white">Daftar Blokir</span>
          <Button variant="ghost" size="sm" className="text-gray-400 hover:text-red-400" onClick={logout}>
            <LogOut className="w-4 h-4" />
          </Button>
        </header>

        <main className="flex-1 p-4 md:p-6 space-y-6">
          {/* Header */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-red-500/10 flex items-center justify-center">
              <ShieldX className="w-5 h-5 text-red-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">Daftar Blokir</h1>
              <p className="text-xs text-gray-400">Nama / nomor HP yang resinya akan otomatis dihapus saat OCR</p>
            </div>
          </div>

          {/* Add Form */}
          <Card className="bg-[#0f1424] border-white/5">
            <CardHeader className="p-4 pb-3 border-b border-white/5">
              <CardTitle className="text-sm font-semibold text-white flex items-center gap-2">
                <Plus className="w-4 h-4 text-purple-400" />
                Tambah Blokir Baru
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <div className="flex flex-col sm:flex-row gap-3">
                {/* Type toggle */}
                <div className="flex rounded-lg border border-white/10 overflow-hidden shrink-0">
                  <button
                    onClick={() => setType("name")}
                    className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors ${
                      type === "name"
                        ? "bg-purple-500/20 text-purple-400"
                        : "text-gray-400 hover:text-white hover:bg-white/5"
                    }`}
                  >
                    <User className="w-3.5 h-3.5" />
                    Nama OCR
                  </button>
                  <button
                    onClick={() => setType("sender")}
                    className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors border-l border-white/10 ${
                      type === "sender"
                        ? "bg-green-500/20 text-green-400"
                        : "text-gray-400 hover:text-white hover:bg-white/5"
                    }`}
                  >
                    <MessageCircle className="w-3.5 h-3.5" />
                    Pengirim WA
                  </button>
                  <button
                    onClick={() => setType("phone")}
                    className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors border-l border-white/10 ${
                      type === "phone"
                        ? "bg-blue-500/20 text-blue-400"
                        : "text-gray-400 hover:text-white hover:bg-white/5"
                    }`}
                  >
                    <Phone className="w-3.5 h-3.5" />
                    No. HP
                  </button>
                </div>

                <Input
                  placeholder={
                    type === "name" ? "Contoh: Tiqka, Wahyu, Mutiah" :
                    type === "sender" ? "Contoh: Nur Ramadhani, Budi" :
                    "Contoh: 08123456789"
                  }
                  value={value}
                  onChange={e => setValue(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleAdd()}
                  className="bg-[#1a1f35] border-white/10 text-white placeholder:text-gray-500 text-sm"
                />
                <Input
                  placeholder="Catatan (opsional)"
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleAdd()}
                  className="bg-[#1a1f35] border-white/10 text-white placeholder:text-gray-500 text-sm"
                />
                <Button
                  onClick={handleAdd}
                  disabled={adding || !value.trim()}
                  className="bg-purple-600 hover:bg-purple-700 text-white shrink-0"
                >
                  {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  <span className="ml-1">Tambah</span>
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Lists */}
          <div className="grid md:grid-cols-2 gap-4">
            {/* Blocked Names (OCR) */}
            <Card className="bg-[#0f1424] border-white/5">
              <CardHeader className="p-4 pb-3 border-b border-white/5">
                <CardTitle className="text-sm font-semibold text-white flex items-center gap-2">
                  <User className="w-4 h-4 text-orange-400" />
                  Blokir Nama
                  <span className="ml-auto text-xs font-normal text-gray-400 bg-white/5 px-2 py-0.5 rounded-full">
                    {names.length}
                  </span>
                </CardTitle>
                <p className="text-xs text-gray-500 mt-1">Berdasarkan nama hasil OCR resi</p>
              </CardHeader>
              <CardContent className="p-0">
                {loading ? (
                  <div className="p-6 text-center text-gray-400 text-sm">Memuat...</div>
                ) : names.length === 0 ? (
                  <div className="p-6 text-center text-gray-500 text-sm">Belum ada nama yang diblokir</div>
                ) : (
                  <div className="divide-y divide-white/5">
                    {names.map(item => (
                      <div key={item.id} className="flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors">
                        <div className="w-7 h-7 rounded-full bg-orange-500/10 flex items-center justify-center shrink-0">
                          <User className="w-3.5 h-3.5 text-orange-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-white truncate">{item.value}</p>
                          {item.note && <p className="text-xs text-gray-500 truncate">{item.note}</p>}
                        </div>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-gray-500 hover:text-red-400 hover:bg-red-500/10 shrink-0"
                              disabled={deletingId === item.id}
                            >
                              {deletingId === item.id
                                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                : <Trash2 className="w-3.5 h-3.5" />}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Hapus blokir "{item.value}"?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Nama ini tidak akan lagi otomatis dihapus saat OCR.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel className="bg-transparent border-white/20 text-gray-300 hover:bg-white/10">Batal</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDelete(item.id)} className="bg-red-600 text-white hover:bg-red-700">Hapus</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Blocked Phones */}
            <Card className="bg-[#0f1424] border-white/5">
              <CardHeader className="p-4 pb-3 border-b border-white/5">
                <CardTitle className="text-sm font-semibold text-white flex items-center gap-2">
                  <Phone className="w-4 h-4 text-blue-400" />
                  Blokir No. HP
                  <span className="ml-auto text-xs font-normal text-gray-400 bg-white/5 px-2 py-0.5 rounded-full">
                    {phones.length}
                  </span>
                </CardTitle>
                <p className="text-xs text-gray-500 mt-1">Resi diabaikan sebelum upload</p>
              </CardHeader>
              <CardContent className="p-0">
                {loading ? (
                  <div className="p-6 text-center text-gray-400 text-sm">Memuat...</div>
                ) : phones.length === 0 ? (
                  <div className="p-6 text-center text-gray-500 text-sm">Belum ada nomor yang diblokir</div>
                ) : (
                  <div className="divide-y divide-white/5">
                    {phones.map(item => (
                      <div key={item.id} className="flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors">
                        <div className="w-7 h-7 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0">
                          <Phone className="w-3.5 h-3.5 text-blue-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-white truncate">{item.value}</p>
                          {item.note && <p className="text-xs text-gray-500 truncate">{item.note}</p>}
                        </div>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-gray-500 hover:text-red-400 hover:bg-red-500/10 shrink-0"
                              disabled={deletingId === item.id}
                            >
                              {deletingId === item.id
                                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                : <Trash2 className="w-3.5 h-3.5" />}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Hapus blokir "{item.value}"?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Nomor ini tidak akan lagi otomatis dihapus saat OCR.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel className="bg-transparent border-white/20 text-gray-300 hover:bg-white/10">Batal</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDelete(item.id)} className="bg-red-600 text-white hover:bg-red-700">Hapus</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Blocked Senders (WA pushName) */}
            <Card className="bg-[#0f1424] border-white/5 md:col-span-2">
              <CardHeader className="p-4 pb-3 border-b border-white/5">
                <CardTitle className="text-sm font-semibold text-white flex items-center gap-2">
                  <MessageCircle className="w-4 h-4 text-green-400" />
                  Blokir Pengirim WA
                  <span className="ml-auto text-xs font-normal text-gray-400 bg-white/5 px-2 py-0.5 rounded-full">
                    {senders.length}
                  </span>
                </CardTitle>
                <p className="text-xs text-gray-500 mt-1">Berdasarkan nama pengirim di WhatsApp — resi diabaikan sebelum upload</p>
              </CardHeader>
              <CardContent className="p-0">
                {loading ? (
                  <div className="p-6 text-center text-gray-400 text-sm">Memuat...</div>
                ) : senders.length === 0 ? (
                  <div className="p-6 text-center text-gray-500 text-sm">Belum ada pengirim WA yang diblokir</div>
                ) : (
                  <div className="divide-y divide-white/5">
                    {senders.map(item => (
                      <div key={item.id} className="flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors">
                        <div className="w-7 h-7 rounded-full bg-green-500/10 flex items-center justify-center shrink-0">
                          <MessageCircle className="w-3.5 h-3.5 text-green-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-white truncate">{item.value}</p>
                          {item.note && <p className="text-xs text-gray-500 truncate">{item.note}</p>}
                        </div>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-gray-500 hover:text-red-400 hover:bg-red-500/10 shrink-0"
                              disabled={deletingId === item.id}
                            >
                              {deletingId === item.id
                                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                : <Trash2 className="w-3.5 h-3.5" />}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Hapus blokir "{item.value}"?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Pengirim ini tidak akan lagi diblokir sebelum upload.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel className="bg-transparent border-white/20 text-gray-300 hover:bg-white/10">Batal</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDelete(item.id)} className="bg-red-600 text-white hover:bg-red-700">Hapus</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </main>
      </div>
    </div>
  );
};

export default BlockedList;
