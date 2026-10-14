import { useState, useEffect, useCallback, useRef } from "react";
import AdminSidebar from "@/components/AdminSidebar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  AlertTriangle, RefreshCw, Search, Menu, X,
  Trash2, Plus, ShieldCheck, Smartphone, Copy, Check, ChevronDown, ChevronUp, SendHorizonal,
  Clock, CheckCircle2, Pencil, ArrowDownWideNarrow, ArrowUpNarrowWide, ClipboardList,
  ImageUp, ImageOff,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";

// ─── Types ───────────────────────────────────────────────────
interface WhitelistEntry {
  id: string;
  phone: string;
  label: string | null;
  created_at: string;
}

interface PaymentEntry {
  id: string;
  kode: string | null;
  tag_raw: string | null;
  tag_phone: string | null;
  tag_jid: string | null;
  nama: string | null;
  norek: string | null;
  bank: string | null;
  total_get: number | null;
  potget: number | null;
  note: string | null;
  raw_text: string | null;
  group_id: string | null;
  group_name: string | null;
  sender_jid: string | null;
  created_at: string;
  approved_at: string | null;
  image_sent_at: string | null;
}

function toNum(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return v;
  return parseInt(String(v).replace(/\D/g, ""), 10) || 0;
}

function fmt(n: number) {
  return n.toLocaleString("id-ID");
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("id-ID", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function fmtDateShort(iso: string) {
  return new Date(iso).toLocaleDateString("id-ID", {
    day: "2-digit", month: "short",
  });
}

function groupName(entry: PaymentEntry) {
  const raw = entry.group_name
    || entry.group_id?.replace("@g.us", "").replace("@s.whatsapp.net", "")
    || "";
  if (!raw) return "-";
  // Ambil hanya kode K.AHxxxx, buang sisa nama group (nominal, durasi, tanggal, emoji).
  const code = raw.match(/K\.?\s*AH\s*\d+/i);
  if (!code) return raw;
  return code[0].replace(/\s+/g, "").replace(/^k\.?ah/i, "K.AH");
}

function displayTagMember(entry: PaymentEntry) {
  if (entry.tag_phone) return entry.tag_phone;
  const raw = entry.tag_raw || "";
  const digits = raw.replace(/^@/, "");
  if (/^\d{8,}$/.test(digits)) return "";
  return raw;
}

// ─── Component ───────────────────────────────────────────────
export default function ParsePembayaran() {
  const { toast } = useToast();
  const [entries, setEntries] = useState<PaymentEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [dbCount, setDbCount] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [approving, setApproving] = useState<string | null>(null);
  const [copiedPhone, setCopiedPhone] = useState<string | null>(null);
  const [copiedGroup, setCopiedGroup] = useState<string | null>(null);
  const [mobileExpanded, setMobileExpanded] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  // Upload gambar ucapan: id entri yang sedang diproses + input file tersembunyi.
  // Satu input dipakai bergantian untuk semua kartu — id target disimpan di ref
  // supaya onChange tahu entri mana yang sedang diupload.
  const [sendingImage, setSendingImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadTargetRef = useRef<string | null>(null);
  // Sort berdasarkan total_get. null = urutan default (terbaru dulu).
  const [sortTotal, setSortTotal] = useState<"desc" | "asc" | null>(null);
  const [copiedBulk, setCopiedBulk] = useState(false);
  // Konfirmasi hapus: { ids, label } — null berarti dialog tertutup
  const [confirmDel, setConfirmDel] = useState<{ ids: string[]; label: string } | null>(null);

  // Whitelist state
  const [whitelist, setWhitelist] = useState<WhitelistEntry[]>([]);
  const [wlLoading, setWlLoading] = useState(false);

  // Note whitelist toggle state
  const NOTE_KEYWORDS = ["Potlun", "Opslun", "🆑"] as const;
  type NoteKeyword = typeof NOTE_KEYWORDS[number];
  const [noteWl, setNoteWl] = useState<Record<NoteKeyword, boolean>>({ Potlun: false, Opslun: false, "🆑": false });
  const [noteWlLoading, setNoteWlLoading] = useState(false);
  const [wlPhone, setWlPhone] = useState("");
  const [wlLabel, setWlLabel] = useState("");
  const [wlAdding, setWlAdding] = useState(false);
  const [wlDeleting, setWlDeleting] = useState<string | null>(null);
  // Edit inline whitelist: id yang sedang diedit + draft nilainya.
  const [wlEditId, setWlEditId] = useState<string | null>(null);
  const [wlEditPhone, setWlEditPhone] = useState("");
  const [wlEditLabel, setWlEditLabel] = useState("");
  const [wlSaving, setWlSaving] = useState(false);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    const { data, error, count } = await supabase
      .from("payment_entries")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      setFetchError(`${error.code}: ${error.message}${error.hint ? ` — ${error.hint}` : ""}`);
    } else {
      setEntries((data ?? []) as PaymentEntry[]);
      setDbCount(count ?? 0);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  const fetchWhitelist = useCallback(async () => {
    setWlLoading(true);
    const { data } = await supabase
      .from("payment_whitelist")
      .select("*")
      .order("label", { ascending: true, nullsFirst: false });
    // Urut abjad nama (A-Z). Yang tanpa label ditaruh paling bawah,
    // diurut pakai nomornya biar tetap konsisten.
    const sorted = ((data ?? []) as WhitelistEntry[]).sort((a, b) => {
      const la = (a.label || "").trim();
      const lb = (b.label || "").trim();
      if (!la && !lb) return a.phone.localeCompare(b.phone);
      if (!la) return 1;
      if (!lb) return -1;
      return la.localeCompare(lb, "id", { sensitivity: "base" });
    });
    setWhitelist(sorted);
    setWlLoading(false);
  }, []);

  useEffect(() => { fetchWhitelist(); }, [fetchWhitelist]);

  // Fetch note whitelist enabled state
  const fetchNoteWl = useCallback(async () => {
    const { data } = await supabase.from("payment_note_whitelist").select("keyword,enabled");
    if (data) {
      const next = { Potlun: false, Opslun: false, "🆑": false } as Record<NoteKeyword, boolean>;
      for (const row of data as { keyword: string; enabled: boolean }[]) {
        if (row.keyword in next) next[row.keyword as NoteKeyword] = row.enabled;
      }
      setNoteWl(next);
    }
  }, []);

  useEffect(() => { fetchNoteWl(); }, [fetchNoteWl]);

  const handleNoteToggle = async (keyword: NoteKeyword) => {
    const newVal = !noteWl[keyword];
    setNoteWl(prev => ({ ...prev, [keyword]: newVal }));
    setNoteWlLoading(true);
    await supabase.from("payment_note_whitelist").update({ enabled: newVal }).eq("keyword", keyword);
    setNoteWlLoading(false);
  };

  const handleWlAdd = async () => {
    const phone = wlPhone.trim().replace(/\s/g, "");
    if (!phone) return;
    setWlAdding(true);
    const { error } = await supabase
      .from("payment_whitelist")
      .insert({ phone, label: wlLabel.trim() || null });
    if (!error) {
      setWlPhone("");
      setWlLabel("");
      await fetchWhitelist();
    }
    setWlAdding(false);
  };

  const startWlEdit = (w: WhitelistEntry) => {
    setWlEditId(w.id);
    setWlEditPhone(w.phone);
    setWlEditLabel(w.label || "");
  };

  const cancelWlEdit = () => {
    setWlEditId(null);
    setWlEditPhone("");
    setWlEditLabel("");
  };

  const handleWlSave = async () => {
    if (!wlEditId) return;
    const phone = wlEditPhone.trim().replace(/\s/g, "");
    if (!phone) return;
    const label = wlEditLabel.trim() || null;
    setWlSaving(true);
    const { error } = await supabase
      .from("payment_whitelist")
      .update({ phone, label })
      .eq("id", wlEditId);
    if (error) {
      toast({ title: "Gagal menyimpan", description: error.message, variant: "destructive" });
    } else {
      cancelWlEdit();
      // Refetch supaya urutan abjad ikut menyesuaikan kalau label berubah.
      await fetchWhitelist();
      toast({ title: "Whitelist diperbarui" });
    }
    setWlSaving(false);
  };

  const handleWlDelete = async (id: string) => {
    setWlDeleting(id);
    await supabase.from("payment_whitelist").delete().eq("id", id);
    setWhitelist(prev => prev.filter(w => w.id !== id));
    setWlDeleting(null);
  };

  // Realtime subscription — refetch di-debounce 1.5 detik.
  // wa-webhook insert payment satu-satu dalam loop, jadi 1 pesan berisi 50
  // baris = 50 event = 50 full refetch per tab. Di-debounce jadi 1 refetch
  // setelah event terakhir. Tampilan tetap update otomatis seperti biasa.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase
      .channel("payment_entries_realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_entries" }, () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => { timer = null; fetchEntries(); }, 1500);
      })
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [fetchEntries]);

  const searched = entries.filter(e => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      e.kode?.toLowerCase().includes(q) ||
      e.nama?.toLowerCase().includes(q) ||
      e.tag_raw?.toLowerCase().includes(q) ||
      e.tag_phone?.includes(q) ||
      e.norek?.includes(q) ||
      e.bank?.toLowerCase().includes(q)
    );
  });

  // Sort by total_get kalau tombolnya aktif; kalau null biarkan urutan
  // dari query (created_at desc).
  const filtered = sortTotal
    ? [...searched].sort((a, b) => {
        const diff = toNum(a.total_get) - toNum(b.total_get);
        return sortTotal === "asc" ? diff : -diff;
      })
    : searched;

  const handleDelete = (entry: PaymentEntry) => {
    setConfirmDel({
      ids: [entry.id],
      label: `${groupName(entry)} · ${entry.nama || "tanpa nama"}`,
    });
  };

  // Eksekusi hapus — dipakai baik untuk satuan maupun bulk.
  const runDelete = async (ids: string[]) => {
    if (ids.length === 0) return;
    const single = ids.length === 1;
    single ? setDeleting(ids[0]) : setBulkDeleting(true);
    const { error } = await supabase.from("payment_entries").delete().in("id", ids);
    if (error) {
      toast({ title: "Gagal menghapus", description: error.message, variant: "destructive" });
    } else {
      const idSet = new Set(ids);
      setEntries(prev => prev.filter(e => !idSet.has(e.id)));
      setSelected(prev => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
      toast({ title: single ? "Entri dihapus" : `${ids.length} entri dihapus` });
    }
    single ? setDeleting(null) : setBulkDeleting(false);
    setConfirmDel(null);
  };

  const handleBulkDelete = () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setConfirmDel({ ids, label: `${ids.length} entri payment` });
  };

  // Copy teks asli semua entri yang dicentang, berurutan sesuai tampilan
  // (ikut sort/filter yang aktif), dipisah baris kosong antar entri.
  const handleBulkCopy = async () => {
    const picked = filtered.filter(e => selected.has(e.id) && e.raw_text?.trim());
    if (picked.length === 0) {
      toast({ title: "Tidak ada teks asli", description: "Entri yang dipilih tidak punya teks asli.", variant: "destructive" });
      return;
    }
    const text = picked.map(e => e.raw_text!.trim()).join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopiedBulk(true);
      setTimeout(() => setCopiedBulk(false), 1800);
      toast({ title: `${picked.length} teks asli tercopy` });
    } catch {
      toast({ title: "Gagal copy ke clipboard", variant: "destructive" });
    }
  };

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const allSelected = filtered.length > 0 && filtered.every(e => selected.has(e.id));

  const toggleSelectAll = () => {
    setSelected(allSelected ? new Set() : new Set(filtered.map(e => e.id)));
  };

  const handleApprove = async (entry: PaymentEntry) => {
    setApproving(entry.id);
    try {
      const { error } = await supabase.functions.invoke("approve-payment", {
        body: { entry_id: entry.id },
      });
      if (error) {
        toast({ title: "Gagal kirim Approved", description: error.message, variant: "destructive" });
      } else {
        // Pesan terkirim — tandai Approved langsung tanpa menunggu refetch.
        const now = new Date().toISOString();
        setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, approved_at: now } : e));
        toast({ title: "Pesan Approved terkirim", description: groupName(entry) });
      }
    } catch (e) {
      toast({ title: "Gagal kirim Approved", description: String(e), variant: "destructive" });
    }
    setApproving(null);
  };

  // Klik tombol Upload → buka file picker untuk entri ini.
  const pickImage = (entryId: string) => {
    uploadTargetRef.current = entryId;
    if (fileInputRef.current) {
      fileInputRef.current.value = "";   // reset supaya file yang sama bisa dipilih lagi
      fileInputRef.current.click();
    }
  };

  // File dipilih → langsung kirim ke group sebagai reply bergambar.
  // Gambar tidak disimpan di storage mana pun: base64-nya dikirim ke edge
  // function, di-upload ke Wasender, dan URL-nya hangus sendiri dalam 24 jam.
  const handleImageChosen = async (file: File) => {
    const entryId = uploadTargetRef.current;
    uploadTargetRef.current = null;
    if (!entryId) return;

    const entry = entries.find(e => e.id === entryId);
    if (!file.type.startsWith("image/")) {
      toast({ title: "Harus berupa gambar", variant: "destructive" });
      return;
    }
    // Batas Wasender untuk gambar adalah 16MB; tahan di sini biar tidak
    // percuma bolak-balik ke server.
    if (file.size > 16 * 1024 * 1024) {
      toast({ title: "Gambar terlalu besar", description: "Maksimal 16MB.", variant: "destructive" });
      return;
    }

    setSendingImage(entryId);
    try {
      const dataUrl: string = await new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload = () => res(reader.result as string);
        reader.onerror = () => rej(new Error("Gagal membaca file"));
        reader.readAsDataURL(file);
      });

      const { error } = await supabase.functions.invoke("send-payment-image", {
        body: { entry_id: entryId, image_base64: dataUrl, mime: file.type },
      });
      if (error) {
        toast({ title: "Gagal kirim gambar", description: error.message, variant: "destructive" });
      } else {
        const now = new Date().toISOString();
        setEntries(prev => prev.map(e => e.id === entryId ? { ...e, image_sent_at: now } : e));
        toast({
          title: "Gambar terkirim",
          description: entry ? groupName(entry) : undefined,
        });
      }
    } catch (e) {
      toast({ title: "Gagal kirim gambar", description: String(e), variant: "destructive" });
    }
    setSendingImage(null);
  };

  const totalNominal = filtered.reduce((s, e) => s + toNum(e.total_get), 0);

  return (
    <div className="flex h-screen bg-[#0a0e1a] text-white overflow-hidden">
      <AdminSidebar />

      <div className="flex-1 flex flex-col lg:ml-56 overflow-hidden">
        {/* Mobile header */}
        <div className="lg:hidden flex items-center gap-3 px-4 py-3 bg-[#0f1424] border-b border-white/5">
          <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="text-gray-400">
                {drawerOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="p-0 w-56 bg-[#0f1424] border-r border-white/5">
              <AdminSidebar variant="drawer" onNavigate={() => setDrawerOpen(false)} />
            </SheetContent>
          </Sheet>
          <span className="font-semibold text-sm">Payment</span>
        </div>

        <div className="flex-1 overflow-y-auto p-4 lg:p-6 space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold text-white">Payment</h1>
              <p className="text-sm text-gray-400 mt-0.5">
                Data pembayaran yang dikirim admin via WhatsApp, di-parse otomatis.
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="text-gray-400 hover:text-white gap-1.5"
              onClick={fetchEntries}
              disabled={loading}
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>

          {/* Summary bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { label: "Total Entri", value: filtered.length, color: "text-blue-400" },
              { label: "Approved", value: filtered.filter(e => e.approved_at).length, color: "text-emerald-400" },
              { label: "Pending", value: filtered.filter(e => !e.approved_at).length, color: "text-amber-400" },
              { label: "Total Nominal", value: `Rp ${fmt(totalNominal)}`, color: "text-purple-400" },
            ].map(s => (
              <div key={s.label} className="bg-[#0f1424] border border-white/5 rounded-lg px-3 py-2 text-center">
                <div className={`text-base font-bold ${s.color}`}>{s.value}</div>
                <div className="text-[10px] text-gray-500">{s.label}</div>
              </div>
            ))}
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Cari kode, nama, bank, no. rek..."
              className="pl-9 bg-[#0f1424] border-white/10 text-white placeholder:text-gray-600 focus-visible:ring-purple-500/50"
            />
          </div>

          {/* Fetch error */}
          {fetchError && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
              <p className="text-sm text-red-400">Gagal memuat data: <code className="text-xs">{fetchError}</code></p>
            </div>
          )}

          {/* ─── Main layout: cards kiri, whitelist kanan (desktop) / stack (mobile) ── */}
          <div className="flex flex-col lg:flex-row gap-4 items-start">

            {/* ── Payment cards ── */}
            <div className="flex-1 min-w-0 w-full space-y-2">
              {/* Bulk action bar */}
              {!loading && filtered.length > 0 && (
                <div className="flex items-center justify-between gap-3 bg-[#0f1424] border border-white/5 rounded-lg px-3 py-2">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={toggleSelectAll}
                      className="border-white/20 data-[state=checked]:bg-purple-600 data-[state=checked]:border-purple-600"
                    />
                    <span className="text-xs text-gray-400">
                      {selected.size > 0 ? `${selected.size} dipilih` : "Pilih semua"}
                    </span>
                  </label>
                  <div className="flex items-center gap-1.5">
                    {/* Sort Total Get: off → desc → asc → off */}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setSortTotal(prev =>
                        prev === null ? "desc" : prev === "desc" ? "asc" : null
                      )}
                      className={`h-7 px-2 gap-1.5 text-xs ${
                        sortTotal
                          ? "bg-purple-500/15 text-purple-300 hover:bg-purple-500/25 hover:text-purple-200"
                          : "text-gray-400 hover:text-white"
                      }`}
                      title="Urutkan berdasarkan Total Get"
                    >
                      {sortTotal === "asc"
                        ? <ArrowUpNarrowWide className="w-3.5 h-3.5" />
                        : <ArrowDownWideNarrow className="w-3.5 h-3.5" />}
                      Total
                      {sortTotal && (
                        <span className="text-[10px] text-purple-400/80">
                          {sortTotal === "desc" ? "terbesar" : "terkecil"}
                        </span>
                      )}
                    </Button>

                    {selected.size > 0 && (
                      <>
                        <Button
                          size="sm"
                          onClick={handleBulkCopy}
                          className="bg-blue-600/90 hover:bg-blue-600 text-white h-7 px-2.5 gap-1.5 text-xs"
                          title="Copy teks asli semua entri yang dipilih"
                        >
                          {copiedBulk
                            ? <Check className="w-3.5 h-3.5" />
                            : <ClipboardList className="w-3.5 h-3.5" />}
                          {copiedBulk ? "Tercopy" : `Copy ${selected.size} Teks`}
                        </Button>
                        <Button
                          size="sm"
                          onClick={handleBulkDelete}
                          disabled={bulkDeleting}
                          className="bg-red-600/90 hover:bg-red-600 text-white h-7 px-2.5 gap-1.5 text-xs"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          {bulkDeleting ? "Menghapus..." : `Hapus ${selected.size}`}
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              )}

              {loading && (
                <div className="flex items-center justify-center py-16">
                  <RefreshCw className="w-6 h-6 text-purple-400 animate-spin" />
                </div>
              )}

              {!loading && filtered.length === 0 && !fetchError && (
                <div className="bg-[#0f1424] border border-white/5 rounded-xl p-10 text-center">
                  <AlertTriangle className="w-8 h-8 text-yellow-400 mx-auto mb-3" />
                  <p className="text-sm text-gray-400">
                    {search
                      ? "Tidak ada entri yang cocok dengan pencarian."
                      : dbCount === null
                      ? "Belum ada data payment."
                      : dbCount === 0
                      ? "Belum ada data payment. Data akan muncul otomatis saat admin kirim via WA."
                      : `Ada ${dbCount} baris di DB tapi tidak bisa ditampilkan — periksa RLS policy tabel payment_entries.`}
                  </p>
                </div>
              )}

              {!loading && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {filtered.map(entry => {
                    const hasPhone = !!entry.tag_phone;
                    const tagDisplay = displayTagMember(entry);
                    const isApproved = !!entry.approved_at;
                    const imgSent = !!entry.image_sent_at;
                    const isChecked = selected.has(entry.id);
                    const expanded = mobileExpanded === entry.id;
                    const gName = groupName(entry);

                    const copyPhone = (e: React.MouseEvent) => {
                      e.stopPropagation();
                      if (!tagDisplay) return;
                      navigator.clipboard.writeText(tagDisplay);
                      setCopiedPhone(entry.id);
                      setTimeout(() => setCopiedPhone(null), 1500);
                    };

                    const copyGroup = (e: React.MouseEvent) => {
                      e.stopPropagation();
                      if (gName === "-") return;
                      navigator.clipboard.writeText(gName);
                      setCopiedGroup(entry.id);
                      setTimeout(() => setCopiedGroup(null), 1500);
                    };

                    return (
                      <div
                        key={entry.id}
                        className={`bg-[#0f1424] border rounded-lg flex flex-col ${
                          isChecked ? "border-purple-500/50"
                            : isApproved ? "border-emerald-500/20"
                            : hasPhone ? "border-green-500/20" : "border-white/5"
                        }`}
                      >
                        {/* Header: checkbox + group + status + bank */}
                        <div className="flex items-center gap-1.5 px-2 pt-2">
                          <Checkbox
                            checked={isChecked}
                            onCheckedChange={() => toggleSelect(entry.id)}
                            className="shrink-0 h-3.5 w-3.5 border-white/20 data-[state=checked]:bg-purple-600 data-[state=checked]:border-purple-600"
                          />
                          <div
                            className="flex items-center gap-1 group/gcopy flex-1 min-w-0 w-fit cursor-pointer"
                            onClick={copyGroup}
                            title={entry.group_name || ""}
                          >
                            <span className="text-[11px] font-bold text-white truncate">
                              {gName}
                            </span>
                            <span className="text-gray-600 group-hover/gcopy:text-white transition-colors shrink-0">
                              {copiedGroup === entry.id
                                ? <Check className="w-2.5 h-2.5 text-green-400" />
                                : <Copy className="w-2.5 h-2.5" />}
                            </span>
                          </div>
                          <Badge className={`text-[9px] px-1 py-0 gap-0.5 border shrink-0 ${
                            isApproved
                              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                              : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                          }`}>
                            {isApproved
                              ? <CheckCircle2 className="w-2.5 h-2.5" />
                              : <Clock className="w-2.5 h-2.5" />}
                            {isApproved ? "Approved" : "Pending"}
                          </Badge>
                          {/* Status gambar ucapan — pola sama dengan badge Approved */}
                          <Badge
                            className={`text-[9px] px-1 py-0 gap-0.5 border shrink-0 ${
                              imgSent
                                ? "bg-sky-500/10 text-sky-400 border-sky-500/20"
                                : "bg-gray-500/10 text-gray-500 border-white/10"
                            }`}
                            title={imgSent
                              ? `Gambar terkirim ${fmtDate(entry.image_sent_at!)}`
                              : "Gambar ucapan belum dikirim"}
                          >
                            {imgSent
                              ? <ImageUp className="w-2.5 h-2.5" />
                              : <ImageOff className="w-2.5 h-2.5" />}
                            {imgSent ? "Terkirim" : "No Img"}
                          </Badge>
                          {entry.bank && (
                            <Badge className="text-[9px] bg-blue-500/10 text-blue-400 border border-blue-500/20 px-1 py-0 shrink-0">
                              {entry.bank}
                            </Badge>
                          )}
                        </div>

                        {/* Nomor + Nama | Nominal + Kode */}
                        <div
                          className="flex items-end justify-between px-2 py-1.5 gap-2 sm:cursor-default cursor-pointer"
                          onClick={() => setMobileExpanded(expanded ? null : entry.id)}
                        >
                          <div className="min-w-0 flex-1">
                            {tagDisplay ? (
                              <div className="flex items-center gap-1 group/copy w-fit" onClick={copyPhone}>
                                <span className="text-[11px] font-mono text-green-400 leading-none">{tagDisplay}</span>
                                <span className="text-gray-600 group-hover/copy:text-green-400 transition-colors">
                                  {copiedPhone === entry.id
                                    ? <Check className="w-2.5 h-2.5 text-green-400" />
                                    : <Copy className="w-2.5 h-2.5" />}
                                </span>
                              </div>
                            ) : (
                              <span className="text-[11px] text-gray-600">—</span>
                            )}
                            <div className="text-[13px] font-semibold text-white truncate leading-tight">
                              {entry.nama || <span className="text-gray-600 font-normal text-[11px]">—</span>}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-[13px] font-bold text-purple-300 leading-tight">
                              {toNum(entry.total_get) > 0 ? `Rp ${fmt(toNum(entry.total_get))}` : "—"}
                            </div>
                            <div className="text-[9px] text-gray-600 leading-none">{entry.kode || ""}</div>
                          </div>
                        </div>

                        {/* Detail ringkas — baris padat, bukan grid label/value */}
                        <div className={`border-t border-white/5 px-2 py-1.5 space-y-1 flex-1 text-[11px] ${
                          expanded ? "block" : "hidden sm:block"
                        }`}>
                          <Row label="No. Rek" value={entry.norek} mono />
                          {toNum(entry.potget) > 0 && (
                            <Row label="Potget" value={`Rp ${fmt(toNum(entry.potget))}`} />
                          )}
                          {entry.note && <Row label="Note" value={entry.note} />}
                          <Row label="Tanggal" value={fmtDate(entry.created_at)} />
                        </div>

                        {/* Footer: raw text + aksi */}
                        <div className={`px-2 pb-1.5 flex items-center justify-between gap-1 ${
                          expanded ? "flex" : "hidden sm:flex"
                        }`}>
                          {entry.raw_text ? (
                            <details className="group flex-1 min-w-0">
                              <summary className="text-[10px] text-gray-600 cursor-pointer hover:text-gray-400 select-none">
                                Teks asli
                              </summary>
                              <pre className="mt-1.5 text-[10px] text-gray-400 bg-black/30 rounded p-1.5 whitespace-pre-wrap font-mono leading-snug">
                                {entry.raw_text}
                              </pre>
                            </details>
                          ) : <span className="flex-1" />}
                          <div className="flex items-center gap-0.5 shrink-0">
                            <Button
                              variant="ghost"
                              size="sm"
                              className={`h-6 px-1.5 gap-1 text-[11px] ${
                                imgSent
                                  ? "text-sky-500 hover:text-sky-300"
                                  : "text-gray-600 hover:text-sky-400"
                              }`}
                              onClick={() => pickImage(entry.id)}
                              disabled={sendingImage === entry.id}
                              title={imgSent
                                ? "Kirim ulang gambar ucapan"
                                : "Upload gambar — langsung dikirim sebagai reply + tag member"}
                            >
                              <ImageUp className="w-3 h-3" />
                              {sendingImage === entry.id ? "..." : imgSent ? "Ulang" : "Upload"}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-emerald-600 hover:text-emerald-400 h-6 px-1.5 gap-1 text-[11px]"
                              onClick={() => handleApprove(entry)}
                              disabled={approving === entry.id}
                              title={isApproved ? "Kirim ulang pesan Approved" : "Kirim pesan Approved ke group"}
                            >
                              <SendHorizonal className="w-3 h-3" />
                              {approving === entry.id ? "..." : isApproved ? "Ulang" : "Approve"}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-gray-600 hover:text-red-400 h-6 px-1.5 gap-1 text-[11px]"
                              onClick={() => handleDelete(entry)}
                              disabled={deleting === entry.id}
                            >
                              <Trash2 className="w-3 h-3" />
                              {deleting === entry.id ? "..." : "Hapus"}
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── Whitelist sidebar (desktop: kanan, mobile: bawah) ── */}
            <div className="w-full lg:w-[27rem] lg:shrink-0 bg-[#0f1424] border border-white/5 rounded-xl overflow-hidden lg:sticky lg:top-0">
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-green-500/5">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-green-400" />
                  <span className="text-sm font-semibold text-white">Whitelist</span>
                  <Badge className="text-xs bg-green-500/15 text-green-400 border border-green-500/20 px-1.5 py-0">
                    {whitelist.length}
                  </Badge>
                </div>
                {wlLoading && <RefreshCw className="w-3 h-3 text-gray-500 animate-spin" />}
              </div>

              {/* Add form */}
              <div className="px-3 py-3 border-b border-white/5 flex flex-col sm:flex-row gap-2">
                <Input
                  value={wlPhone}
                  onChange={e => setWlPhone(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleWlAdd()}
                  placeholder="No. HP (08xxx / 62xxx)"
                  className="bg-black/30 border-white/10 text-white placeholder:text-gray-600 text-xs h-8 focus-visible:ring-green-500/50 flex-1"
                />
                <Input
                  value={wlLabel}
                  onChange={e => setWlLabel(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleWlAdd()}
                  placeholder="Label (opsional)"
                  className="bg-black/30 border-white/10 text-white placeholder:text-gray-600 text-xs h-8 focus-visible:ring-green-500/50 flex-1"
                />
                <Button
                  size="sm"
                  onClick={handleWlAdd}
                  disabled={wlAdding || !wlPhone.trim()}
                  className="bg-green-600 hover:bg-green-700 text-white h-8 px-2.5 shrink-0 gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {wlAdding ? "..." : "Tambah"}
                </Button>
              </div>

              {/* Whitelist entries */}
              {whitelist.length === 0 ? (
                <div className="px-4 py-6 text-center text-xs text-gray-600">
                  Belum ada nomor whitelist.
                </div>
              ) : (
                /* 2 kolom kiri-kanan biar hemat tempat — 100+ nomor tidak
                   perlu scroll panjang. Mobile tetap 1 kolom. */
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-white/5 max-h-80 lg:max-h-[calc(100vh-18rem)] overflow-y-auto">
                  {whitelist.map(w => {
                    const editing = wlEditId === w.id;
                    return (
                      <div
                        key={w.id}
                        className={`px-2.5 py-2 flex items-start gap-1.5 group bg-[#0f1424] transition-colors ${
                          editing ? "bg-white/[0.04]" : "hover:bg-white/[0.03]"
                        }`}
                      >
                        {editing ? (
                          <div className="flex-1 min-w-0 space-y-1.5">
                            <Input
                              value={wlEditLabel}
                              onChange={e => setWlEditLabel(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === "Enter") handleWlSave();
                                if (e.key === "Escape") cancelWlEdit();
                              }}
                              placeholder="Label (opsional)"
                              className="bg-black/30 border-white/10 text-white placeholder:text-gray-600 text-[11px] h-7 focus-visible:ring-green-500/50"
                            />
                            <Input
                              value={wlEditPhone}
                              onChange={e => setWlEditPhone(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === "Enter") handleWlSave();
                                if (e.key === "Escape") cancelWlEdit();
                              }}
                              placeholder="No. HP"
                              className="bg-black/30 border-white/10 text-green-400 font-mono placeholder:text-gray-600 text-[11px] h-7 focus-visible:ring-green-500/50"
                            />
                            <div className="flex items-center gap-1">
                              <Button
                                size="sm"
                                onClick={handleWlSave}
                                disabled={wlSaving || !wlEditPhone.trim()}
                                className="bg-green-600 hover:bg-green-700 text-white h-6 px-2 gap-1 text-[10px] flex-1"
                              >
                                <Check className="w-3 h-3" />
                                {wlSaving ? "..." : "Simpan"}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={cancelWlEdit}
                                disabled={wlSaving}
                                className="text-gray-500 hover:text-white h-6 px-2 text-[10px]"
                              >
                                Batal
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <Smartphone className="w-3 h-3 text-green-500 shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0">
                              {w.label && (
                                <div className="text-[11px] font-semibold text-white/90 truncate leading-tight">
                                  {w.label}
                                </div>
                              )}
                              <div className="text-[11px] font-mono text-green-400 leading-tight">
                                {w.phone}
                              </div>
                              <div className="text-[9px] text-gray-600">{fmtDateShort(w.created_at)}</div>
                            </div>
                            <div className="flex items-center shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-gray-700 hover:text-blue-400 h-5 w-5 p-0"
                                onClick={() => startWlEdit(w)}
                                title="Edit nomor / label"
                              >
                                <Pencil className="w-3 h-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-gray-700 hover:text-red-400 h-5 w-5 p-0"
                                onClick={() => handleWlDelete(w.id)}
                                disabled={wlDeleting === w.id}
                                title="Hapus"
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* ── Note Whitelist toggles ── */}
              <div className="border-t border-white/5 px-3 py-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Auto-Approved Note</span>
                  {noteWlLoading && <RefreshCw className="w-3 h-3 text-gray-500 animate-spin" />}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                  {NOTE_KEYWORDS.map(kw => (
                    <button
                      key={kw}
                      onClick={() => handleNoteToggle(kw)}
                      className={`flex items-center justify-between px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                        noteWl[kw]
                          ? "bg-green-500/15 border-green-500/40 text-green-400"
                          : "bg-white/[0.03] border-white/10 text-gray-500 hover:border-white/20 hover:text-gray-400"
                      }`}
                    >
                      <span>{kw}</span>
                      <span className={`w-7 h-4 rounded-full flex items-center transition-all ${noteWl[kw] ? "bg-green-500" : "bg-gray-700"}`}>
                        <span className={`w-3 h-3 rounded-full bg-white shadow transition-all mx-0.5 ${noteWl[kw] ? "translate-x-3" : "translate-x-0"}`} />
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* Input file tersembunyi — dipakai bersama oleh semua tombol Upload.
          1 gambar saja (tanpa multiple), langsung terkirim saat dipilih. */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => {
          const f = e.target.files?.[0];
          if (f) handleImageChosen(f);
        }}
      />

      {/* Konfirmasi hapus — satuan & bulk pakai dialog yang sama */}
      <AlertDialog open={!!confirmDel} onOpenChange={(o) => !o && setConfirmDel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmDel && confirmDel.ids.length > 1
                ? `Hapus ${confirmDel.ids.length} entri payment?`
                : "Hapus entri payment ini?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDel?.label}
              <br />
              Tindakan ini tidak bisa dibatalkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              disabled={bulkDeleting || !!deleting}
              onClick={(e) => {
                e.preventDefault();
                if (confirmDel) runDelete(confirmDel.ids);
              }}
            >
              {bulkDeleting || deleting ? "Menghapus..." : "Hapus"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Row({ label, value, mono }: {
  label: string; value: string | null | undefined; mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 min-w-0">
      <span className="text-gray-500 shrink-0">{label}</span>
      <span className={`truncate text-white/90 text-right ${mono ? "font-mono" : ""}`}>
        {value || <span className="text-gray-600">—</span>}
      </span>
    </div>
  );
}
