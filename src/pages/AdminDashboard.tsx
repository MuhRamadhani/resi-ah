import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { LogOut, CheckCircle, XCircle, FileText, Filter, Search, X, Download, Trash2, Loader2, RotateCcw, ArrowUpDown, RefreshCw, Pencil, Check, Users } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import ThemeToggle from "@/components/ThemeToggle";
import LaporanMatchDialog from "@/components/LaporanMatchDialog";
import { ScanSearch, HardDrive, MessageSquare } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";

declare global {
  interface Window {
    Tesseract: any;
  }
}

type Receipt = Tables<"receipts">;

const AdminDashboard = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [dateFilter, setDateFilter] = useState(() => new Date().toISOString().split("T")[0]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [ocrProcessing, setOcrProcessing] = useState<Set<string>>(new Set());
  const ocrProcessedRef = useRef<Set<string>>(new Set());
  const [sortByPhone, setSortByPhone] = useState<"asc" | "desc" | null>(null);
  const [sortByJam, setSortByJam] = useState<"asc" | "desc" | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [deletingDay, setDeletingDay] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [editingNominal, setEditingNominal] = useState<string | null>(null);
  const [editNominalValue, setEditNominalValue] = useState("");
  const [visibleCount, setVisibleCount] = useState(20);
  const [matchDialogOpen, setMatchDialogOpen] = useState(false);
  const fetchReceipts = useCallback(async () => {
    let query = supabase
      .from("receipts")
      .select(`
        id,
        nama,
        nomor_hp,
        nominal,
        jam_transfer,
        keterangan,
        image_url,
        status,
        approved_by,
        approved_at,
        created_at
      `)
      .order("created_at", { ascending: false })
      .limit(500);

    if (dateFilter) {
      query = query
        .gte("created_at", `${dateFilter}T00:00:00`)
        .lt("created_at", `${dateFilter}T23:59:59.999`);
    }

    if (statusFilter !== "all") {
      query = query.eq("status", statusFilter);
    }

    if (searchQuery.trim()) {
      query = query.or(`nama.ilike.%${searchQuery.trim()}%,nomor_hp.ilike.%${searchQuery.trim()}%`);
    }

    const { data, error } = await query;
    if (error) {
      toast({ title: "Gagal memuat data", description: error.message, variant: "destructive" });
    } else {
      setReceipts(data || []);
    }
    setLoading(false);
  }, [dateFilter, statusFilter, searchQuery, toast]);

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate("/admin/login"); return; }
      setUserId(session.user.id);
      const { data: roleData } = await supabase
        .from("user_roles").select("role")
        .eq("user_id", session.user.id).eq("role", "admin").maybeSingle();
      if (!roleData) { await supabase.auth.signOut(); navigate("/admin/login"); }
    };
    checkAuth();
  }, [navigate]);

  useEffect(() => { if (userId) fetchReceipts(); }, [userId, fetchReceipts]);

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel('receipts-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'receipts' }, () => {
        console.log("📥 Resi baru masuk");
        setTimeout(() => { fetchReceipts(); }, 1000);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, fetchReceipts]);

  // --- OCR ---
  const extractReceiptData = (text: string) => {
    let nominal: number | null = null;
    let jam_transfer: string | null = null;
    let senderReceiver: string | null = null;

    const parseNominal = (raw: string): number => {
      let s = raw.trim();
      s = s.replace(/[.,]\d{2}$/, "");
      s = s.replace(/[.,]/g, "");
      return parseInt(s) || 0;
    };

    // Extract sender/receiver names
    const namePatterns = [
      /(?:(?:kepada|ke|penerima|to|recipient|tujuan|nama penerima)[:\s]+)([A-Za-z\s]+?)(?:\n|$|\d)/gi,
      /(?:(?:dari|from|pengirim|sender|nama pengirim)[:\s]+)([A-Za-z\s]+?)(?:\n|$|\d)/gi,
    ];
    for (const pattern of namePatterns) {
      const matches = [...text.matchAll(pattern)];
      for (const match of matches) {
        const name = match[1].trim();
        if (name.length >= 3) {
          senderReceiver = name;
          break;
        }
      }
      if (senderReceiver) break;
    }

    // Strategy 1: Find nominal near keywords (highest priority)
    const keywordPatterns = [
      /(?:nominal|jumlah|amount|total)\s*[:\s]*(?:rp\.?\s*)?([0-9][0-9.,]*)/gi,
      /(?:rp\.?\s*)([0-9]{1,3}(?:[.,][0-9]{3})+(?:[.,]\d{2})?)/gi,
      /IDR\s+([0-9][0-9.,]*)/gi,
    ];

    for (const pattern of keywordPatterns) {
      const matches = [...text.matchAll(pattern)];
      for (const match of matches) {
        const num = parseNominal(match[1]);
        if (num >= 1000 && num <= 100000000) {
          if (nominal === null) nominal = num;
        }
      }
      if (nominal) break;
    }

    // Strategy 2: Fallback - find standalone formatted numbers
    if (!nominal) {
      const standalonePattern = /([0-9]{1,3}(?:[.,][0-9]{3})+(?:[.,]\d{2})?)/g;
      const matches = [...text.matchAll(standalonePattern)];
      const candidates: number[] = [];
      for (const match of matches) {
        const num = parseNominal(match[1]);
        if (num >= 1000 && num <= 100000000) candidates.push(num);
      }
      if (candidates.length > 0) {
        const freq = new Map<number, number>();
        candidates.forEach(n => freq.set(n, (freq.get(n) || 0) + 1));
        const maxFreq = Math.max(...freq.values());
        const mostCommon = [...freq.entries()].filter(([, f]) => f === maxFreq).map(([n]) => n);
        nominal = Math.min(...mostCommon);
      }
    }

    const timePatterns = [
      /(?:waktu|jam|time|pukul|tanggal)[:\s]*.*?(\d{1,2}[:.]\d{2})/gi,
      /(\d{1,2}):(\d{2})(?::(\d{2}))?/g,
    ];
    for (const pattern of timePatterns) {
      const matches = [...text.matchAll(pattern)];
      for (const match of matches) {
        let hours: number, minutes: number;
        if (match[2] !== undefined) { hours = parseInt(match[1]); minutes = parseInt(match[2]); }
        else { const [h, m] = match[1].replace(".", ":").split(":"); hours = parseInt(h); minutes = parseInt(m); }
        if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
          jam_transfer = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
          break;
        }
      }
      if (jam_transfer) break;
    }
    return { nominal, jam_transfer, senderReceiver };
  };

  // --- Edit Nominal ---
  const startEditNominal = (r: Receipt) => {
    setEditingNominal(r.id);
    setEditNominalValue(String(r.nominal));
  };

  const saveNominal = async (id: string) => {
    const val = parseInt(editNominalValue.replace(/[^0-9]/g, "")) || 0;
    const { error } = await supabase.from("receipts").update({ nominal: val }).eq("id", id);
    if (error) {
      toast({ title: "Gagal update nominal", description: error.message, variant: "destructive" });
    } else {
      setEditingNominal(null);
      fetchReceipts();
    }
  };

  const autoDeleteReceipt = useCallback(async (receipt: Receipt) => {
    // Delete image from storage
    try {
      const url = new URL(receipt.image_url);
      const parts = url.pathname.split("/storage/v1/object/public/receipts/");
      if (parts[1]) {
        await supabase.storage.from("receipts").remove([parts[1]]);
      }
    } catch {}
    // Delete related wa messages then receipt
    await supabase.from("receipt_wa_messages").delete().eq("receipt_id", receipt.id);
    await supabase.from("receipts").delete().eq("id", receipt.id);
    console.log(`🗑️ Auto-deleted receipt ${receipt.id} (Tiqka Mutiah detected in OCR)`);
  }, []);

  const isBlockedReceipt = useCallback((receipt: Receipt, ocrText?: string): string | null => {
    const BLOCKED_PHONES = ['082352476245', '081545081942'];
    const namaLower = (receipt.nama || '').toLowerCase();
    
    // Check database nama field
    if (/tiqka|mutiah/i.test(namaLower)) return 'Tiqka Mutiah (dari nama)';
    if (/wahyu/i.test(namaLower)) return 'Wahyu (dari nama)';
    if (/wahxx/i.test(namaLower)) return 'Wahyu (dari nama)';

    if (
      BLOCKED_PHONES.some(phone => 
        receipt.nomor_hp?.includes(phone)
      )
    ) {
      return `Blocked phone ${BLOCKED_PHONES}`;
    }

    // if (receipt.nomor_hp?.includes(BLOCKED_PHONE)) return `Blocked phone ${BLOCKED_PHONE}`;

    // Also check keterangan field
    // const ketLower = (receipt.keterangan || '').toLowerCase();
    // if (/tiqka|mutiah/i.test(ketLower)) return 'Tiqka Mutiah (dari keterangan)';
    // if (/wahyu/i.test(ketLower)) return 'Wahyu (dari keterangan)';
    
    // Check OCR text if available
    if (ocrText) {
      const textLower = ocrText.toLowerCase();
      if (/tiqka|mutiah/i.test(ocrText)) return 'Tiqka Mutiah (dari OCR)';
      if (BLOCKED_PHONES.some(p => ocrText.includes(p))) return `Blocked phone (dari OCR)`;
      if (/wahyu/i.test(ocrText)) return 'Wahyu (dari OCR)';
      if (/wahxx/i.test(ocrText)) return 'Wahyu (dari OCR)';
    }
    return null;
  }, []);

  const runOcrForReceipt = useCallback(async (receipt: Receipt, force = false) => {
    if (!window.Tesseract) return;
    if (!force && ocrProcessedRef.current.has(receipt.id)) return;
    ocrProcessedRef.current.add(receipt.id);

    // Check blocked from DB fields first (no OCR needed)
    const blockedReason = isBlockedReceipt(receipt);
    if (blockedReason) {
      console.log(`⚠️ ${blockedReason} for receipt ${receipt.id}, auto-deleting...`);
      await autoDeleteReceipt(receipt);
      setReceipts(prev => prev.filter(r => r.id !== receipt.id));
      return;
    }

    setOcrProcessing(prev => new Set(prev).add(receipt.id));
    try {
      const res = await fetch(receipt.image_url);
      const blob = await res.blob();
      const { data: { text } } = await window.Tesseract.recognize(blob, "ind+eng");
      console.log(`OCR for ${receipt.nama}:`, text);
      const result = extractReceiptData(text);

      // Check for blocked names/numbers in full OCR text
      const ocrBlocked = isBlockedReceipt(receipt, text);
      if (ocrBlocked) {
        console.log(`⚠️ ${ocrBlocked} for receipt ${receipt.id}, auto-deleting...`);
        await autoDeleteReceipt(receipt);
        setReceipts(prev => prev.filter(r => r.id !== receipt.id));
        return;
      }

      if (result.nominal || result.jam_transfer) {
        const updates: Record<string, any> = {};
        if (result.nominal) updates.nominal = result.nominal;
        if (result.jam_transfer) updates.jam_transfer = result.jam_transfer;
        const { error } = await supabase.from("receipts").update(updates).eq("id", receipt.id);
        if (!error) {
          console.log(`OCR updated receipt ${receipt.id}:`, updates);
          setReceipts(prev => prev.map(r => r.id === receipt.id ? { ...r, ...updates } : r));
        }
      } else {
        console.log("OCR tidak menemukan data untuk", receipt.nama);
      }
    } catch (err) {
      console.error(`OCR error for receipt ${receipt.id}:`, err);
      ocrProcessedRef.current.delete(receipt.id);
    } finally {
      setOcrProcessing(prev => { const n = new Set(prev); n.delete(receipt.id); return n; });
    }
  }, [autoDeleteReceipt, isBlockedReceipt]);

  const OCR_BATCH_SIZE = 25;
  const OCR_CONCURRENCY = 5;
  const ocrQueueRunning = useRef(false);

  const runOcrConcurrent = useCallback(async (items: Receipt[], force = false) => {
    let idx = 0;
    const workers = Array.from({ length: Math.min(OCR_CONCURRENCY, items.length) }, async () => {
      while (idx < items.length) {
        const cur = items[idx++];
        if (force) ocrProcessedRef.current.delete(cur.id);
        await runOcrForReceipt(cur, force);
      }
    });
    await Promise.all(workers);
  }, [runOcrForReceipt]);

  // Auto OCR on dashboard load is DISABLED for performance.
  // OCR only runs when user clicks "OCR All" or "Re-OCR" buttons.

  const handleReOcr = (receipt: Receipt) => {
    ocrProcessedRef.current.delete(receipt.id);
    runOcrForReceipt(receipt, true);
  };

  const [ocrAllRunning, setOcrAllRunning] = useState(false);
  const handleOcrAll = async () => {
    if (ocrAllRunning) return;
    setOcrAllRunning(true);
    console.log(receipts.map(r => r.status));
    const pendingReceipts = receipts.filter(r => r.status?.toLowerCase() === 'pending');
    console.log(`OCR All: ${pendingReceipts.length} pending dari ${receipts.length} total`);
    await runOcrConcurrent(pendingReceipts, true);
    setOcrAllRunning(false);
  };

  // --- Notification Buffer ---
  // Group multiple Approve/Reject clicks into one edge-function call.
  const notifBufferRef = useRef<{ Approved: Set<string>; Rejected: Set<string> }>({ Approved: new Set(), Rejected: new Set() });
  const notifTimerRef = useRef<number | null>(null);

  const flushNotifications = useCallback(() => {
    notifTimerRef.current = null;
    const buf = notifBufferRef.current;
    notifBufferRef.current = { Approved: new Set(), Rejected: new Set() };
    for (const status of ["Approved", "Rejected"] as const) {
      const ids = Array.from(buf[status]);
      if (ids.length === 0) continue;
      supabase.functions.invoke("send-wa-notification", {
        body: { status, receipt_ids: ids },
      }).then(({ error: waError }) => {
        if (waError) console.warn("WA notification failed", waError);
      });
    }
  }, []);

  const queueNotification = useCallback((status: "Approved" | "Rejected", ids: string[]) => {
    ids.forEach(id => notifBufferRef.current[status].add(id));
    if (notifTimerRef.current !== null) window.clearTimeout(notifTimerRef.current);
    notifTimerRef.current = window.setTimeout(flushNotifications, 1500);
  }, [flushNotifications]);

  // --- Actions ---
  const updateStatus = async (id: string, status: "Approved" | "Rejected") => {
    const receipt = receipts.find(r => r.id === id);
    if (!receipt) return;

    // Bulk approve: find all receipts with same phone + nominal
    const matchingIds = status === "Approved"
      ? receipts.filter(r => r.status === "Pending" && r.nomor_hp === receipt.nomor_hp && r.nominal === receipt.nominal).map(r => r.id)
      : [id];

    const updatePayload = { status, approved_by: userId, approved_at: new Date().toISOString() };
    const { error } = await supabase.from("receipts").update(updatePayload).in("id", matchingIds);

    if (error) {
      toast({ title: "Gagal update status", description: error.message, variant: "destructive" });
    } else {
      const count = matchingIds.length;
      toast({ title: `${count > 1 ? `${count} resi` : "Resi"} ${status}` });
      fetchReceipts();
      // Buffer notifications to combine multiple Approve clicks into one batch
      queueNotification(status, matchingIds);
    }
  };

  const handleLogout = async () => { await supabase.auth.signOut(); navigate("/admin/login"); };

  const deleteReceipt = async (id: string) => {
    const receipt = receipts.find(r => r.id === id);
    if (receipt) {
      try {
        const url = new URL(receipt.image_url);
        const parts = url.pathname.split("/storage/v1/object/public/receipts/");
        if (parts[1]) await supabase.storage.from("receipts").remove([parts[1]]);
      } catch {}
      await supabase.from("receipt_wa_messages").delete().eq("receipt_id", id);
    }
    const { error } = await supabase.from("receipts").delete().eq("id", id);
    if (error) toast({ title: "Gagal hapus resi", description: error.message, variant: "destructive" });
    else { toast({ title: "Resi berhasil dihapus 🗑️" }); setSelectedIds(prev => { const n = new Set(prev); n.delete(id); return n; }); fetchReceipts(); }
  };

  const bulkDelete = async () => {
    if (selectedIds.size === 0) return;
    setBulkDeleting(true);
    const ids = Array.from(selectedIds);
    // Delete images from storage
    const filePaths = ids.map(id => {
      const r = receipts.find(rec => rec.id === id);
      if (!r) return null;
      try {
        const url = new URL(r.image_url);
        const parts = url.pathname.split("/storage/v1/object/public/receipts/");
        return parts[1] || null;
      } catch { return null; }
    }).filter(Boolean) as string[];
    if (filePaths.length > 0) await supabase.storage.from("receipts").remove(filePaths);
    await supabase.from("receipt_wa_messages").delete().in("receipt_id", ids);
    const { error } = await supabase.from("receipts").delete().in("id", ids);
    if (error) toast({ title: "Gagal hapus", description: error.message, variant: "destructive" });
    else { toast({ title: `${selectedIds.size} resi berhasil dihapus 🗑️` }); setSelectedIds(new Set()); fetchReceipts(); }
    setBulkDeleting(false);
  };

  const deleteAllDay = async () => {
    if (!dateFilter || receipts.length === 0) return;
    setDeletingDay(true);
    try {
      // Delete images from storage
      const filePaths = receipts.map(r => {
        try {
          const url = new URL(r.image_url);
          const parts = url.pathname.split("/storage/v1/object/public/receipts/");
          return parts[1] || null;
        } catch { return null; }
      }).filter(Boolean) as string[];

      if (filePaths.length > 0) {
        await supabase.storage.from("receipts").remove(filePaths);
      }

      // Delete related wa messages first
      const ids = receipts.map(r => r.id);
      await supabase.from("receipt_wa_messages").delete().in("receipt_id", ids);

      // Delete receipts
      const { error } = await supabase.from("receipts").delete().in("id", ids);
      if (error) {
        toast({ title: "Gagal hapus data hari ini", description: error.message, variant: "destructive" });
      } else {
        toast({ title: `${ids.length} resi tanggal ${dateFilter} berhasil dihapus 🗑️` });
        setSelectedIds(new Set());
        fetchReceipts();
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
    setDeletingDay(false);
  };

  // --- Selection ---
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };
  const toggleSelectAll = () => {
    if (selectedIds.size === receipts.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(receipts.map(r => r.id)));
  };

  // --- Sorting ---
  const sortedReceipts = (() => {
    let sorted = [...receipts];
    if (sortByPhone) {
      sorted.sort((a, b) => sortByPhone === "asc" ? a.nomor_hp.localeCompare(b.nomor_hp) : b.nomor_hp.localeCompare(a.nomor_hp));
    } else if (sortByJam) {
      sorted.sort((a, b) => sortByJam === "asc" ? String(a.jam_transfer).localeCompare(String(b.jam_transfer)) : String(b.jam_transfer).localeCompare(String(a.jam_transfer)));
    }
    return sorted;
  })();

  const displayedReceipts = sortedReceipts.slice(0, visibleCount);

  // reset pagination when filters change
  useEffect(() => { setVisibleCount(50); }, [dateFilter, statusFilter, searchQuery]);

  const togglePhoneSort = () => {
    setSortByJam(null);
    setSortByPhone(prev => prev === null ? "asc" : prev === "asc" ? "desc" : null);
  };
  const toggleJamSort = () => {
    setSortByPhone(null);
    setSortByJam(prev => prev === null ? "asc" : prev === "asc" ? "desc" : null);
  };

  // --- Helpers ---
  const getStatusBadge = (status: string) => {
    switch (status) {
      case "Approved": return <Badge className="bg-success text-success-foreground">Approved</Badge>;
      case "Rejected": return <Badge className="bg-destructive text-destructive-foreground">Rejected</Badge>;
      default: return <Badge className="bg-warning text-warning-foreground">Pending</Badge>;
    }
  };

  const formatCurrency = (val: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(val);
  const formatDate = (dateStr: string) => new Date(dateStr).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });


  const getGroupName = (keterangan: string | null) => {
    if (!keterangan) return "-";
    
    const match = keterangan.match(/\(WA Group:\s*(.*?)\)/i);
    
    if (match?.[1]) {
      return match[1].trim();
    }
  
    return "-";
  };

  const exportCSV = () => {
    if (receipts.length === 0) { toast({ title: "Tidak ada data untuk diexport", variant: "destructive" }); return; }
    const headers = ["Nama", "No. HP", "Nominal", "Jam Transfer", "Tanggal", "Keterangan", "Status"];
    const rows = receipts.map(r => [r.nama, r.nomor_hp, r.nominal, r.jam_transfer, formatDate(r.created_at), `"${(r.keterangan || "").replace(/"/g, '""')}"`, r.status]);
    const csv = [headers.join(","), ...rows.map(row => row.join(","))].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `resi_${dateFilter || "semua"}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Data berhasil diexport ✅" });
  };

  // --- Mobile Card ---
  const ReceiptCard = ({ r }: { r: Receipt }) => (
    <Card className="mb-3">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start gap-2">
          <Checkbox checked={selectedIds.has(r.id)} onCheckedChange={() => toggleSelect(r.id)} className="mt-1" />
          <div className="flex-1">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-semibold text-foreground">{r.nomor_hp}</p>
              </div>
              {getStatusBadge(r.status)}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <span className="text-muted-foreground">Nominal:</span>
            {ocrProcessing.has(r.id) ? (
              <p className="font-medium flex items-center gap-1 text-primary"><Loader2 className="w-3 h-3 animate-spin" />Membaca resi...</p>
            ) : editingNominal === r.id ? (
              <div className="flex items-center gap-1 mt-1">
                <Input
                  className="h-7 w-28 text-xs"
                  value={editNominalValue}
                  onChange={(e) => setEditNominalValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") saveNominal(r.id); if (e.key === "Escape") setEditingNominal(null); }}
                  autoFocus
                />
                <Button size="sm" variant="ghost" className="h-7 px-1" onClick={() => saveNominal(r.id)}><Check className="w-3 h-3 text-success" /></Button>
                <Button size="sm" variant="ghost" className="h-7 px-1" onClick={() => setEditingNominal(null)}><X className="w-3 h-3" /></Button>
              </div>
            ) : (
              <button className="font-medium flex items-center gap-1" onClick={() => startEditNominal(r)}>
                {formatCurrency(r.nominal)} <Pencil className="w-3 h-3 opacity-40" />
              </button>
            )}
          </div>
          <div>
            <span className="text-muted-foreground">Jam:</span>
            {ocrProcessing.has(r.id) ? (
              <p className="font-medium flex items-center gap-1 text-primary"><Loader2 className="w-3 h-3 animate-spin" />...</p>
            ) : (
              <p className="font-medium">{r.jam_transfer}</p>
            )}
          </div>
          <div>
            <span className="text-muted-foreground">Tanggal:</span>
            <p className="font-medium">{formatDate(r.created_at)}</p>
          </div>
        </div>
        {r.keterangan && (
          <div className="text-sm">
            <span className="text-muted-foreground">Keterangan:</span>
              <p className="text-foreground">
                {getGroupName(r.keterangan)}
              </p>
          </div>
        )}
        <div className="flex items-center gap-3">
          <button onClick={() => setPreviewImage(r.image_url)} className="shrink-0">
            <img loading="lazy" src={r.image_url} alt="Resi" className="w-14 h-14 object-cover rounded border cursor-pointer hover:opacity-80 transition-opacity" />
          </button>
          <div className="flex-1 grid grid-cols-2 gap-1.5">
            <Button size="sm" variant="outline" className="h-8 px-2 text-xs" onClick={() => handleReOcr(r)} disabled={ocrProcessing.has(r.id)}>
              {ocrProcessing.has(r.id) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
              <span className="ml-1">Re-OCR</span>
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="outline" className="h-8 px-2 text-xs text-destructive hover:text-destructive">
                  <Trash2 className="w-3.5 h-3.5" /><span className="ml-1">Hapus</span>
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Hapus Resi?</AlertDialogTitle>
                  <AlertDialogDescription>Resi dari <strong>{r.nama}</strong> sebesar {formatCurrency(r.nominal)} akan dihapus permanen.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Batal</AlertDialogCancel>
                  <AlertDialogAction onClick={() => deleteReceipt(r.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Hapus</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            {r.status === "Pending" && (
              <>
                <Button size="sm" className="bg-success hover:bg-success/90 text-success-foreground h-8 px-2 text-xs" onClick={() => updateStatus(r.id, "Approved")}>
                  <CheckCircle className="w-3.5 h-3.5 mr-1" />Approve
                </Button>
                <Button size="sm" variant="destructive" className="h-8 px-2 text-xs" onClick={() => updateStatus(r.id, "Rejected")}>
                  <XCircle className="w-3.5 h-3.5 mr-1" />Reject
                </Button>
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card sticky top-0 z-10">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" />
            <h1 className="text-lg font-semibold text-foreground">Dashboard Validasi Resi</h1>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => navigate("/admin/create-group")}>
              <Users className="w-4 h-4 mr-1" />{!isMobile && "Create Group"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => navigate("/admin/monthly-report")}>
              <FileText className="w-4 h-4 mr-1" />{!isMobile && "Laporan Bulanan"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => navigate("/admin/storage")}>
              <HardDrive className="w-4 h-4 mr-1" />{!isMobile && "Storage"}
            </Button>
            <ThemeToggle />
            <Button variant="ghost" size="sm" onClick={handleLogout}>
              <LogOut className="w-4 h-4 mr-1" />{!isMobile && "Logout"}
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 space-y-4">
        {/* Filters */}
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-3">
              <Filter className="w-4 h-4" /><span className="font-medium">Filter</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Cari Nama / No. HP</label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input className="pl-8" placeholder="Ketik nama atau nomor HP..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Tanggal</label>
                <Input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Status</label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Status</SelectItem>
                    <SelectItem value="Pending">Pending</SelectItem>
                    <SelectItem value="Approved">Approved</SelectItem>
                    <SelectItem value="Rejected">Rejected</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          <Card><CardContent className="py-3 text-center"><p className="text-2xl font-bold text-warning">{receipts.filter(r => r.status === "Pending").length}</p><p className="text-xs text-muted-foreground">Pending</p></CardContent></Card>
          <Card><CardContent className="py-3 text-center"><p className="text-2xl font-bold text-success">{receipts.filter(r => r.status === "Approved").length}</p><p className="text-xs text-muted-foreground">Approved</p></CardContent></Card>
          <Card><CardContent className="py-3 text-center"><p className="text-2xl font-bold text-destructive">{receipts.filter(r => r.status === "Rejected").length}</p><p className="text-xs text-muted-foreground">Rejected</p></CardContent></Card>
        </div>

        {/* Data List */}
        <Card>
          <CardHeader className="pb-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Daftar Resi ({receipts.length})</CardTitle>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={async () => { setRefreshing(true); await fetchReceipts(); setRefreshing(false); }} disabled={refreshing}>
                  <RefreshCw className={`w-4 h-4 ${isMobile ? "" : "mr-1"} ${refreshing ? "animate-spin" : ""}`} />{!isMobile && "Refresh"}
                </Button>
                <Button variant="outline" size="sm" onClick={exportCSV} disabled={receipts.length === 0}>
                  <Download className={`w-4 h-4 ${isMobile ? "" : "mr-1"}`} />{!isMobile && "Export CSV"}
                </Button>
                <Button variant="outline" size="sm" onClick={handleOcrAll} disabled={ocrAllRunning || receipts.length === 0}>
                  {ocrAllRunning ? <Loader2 className={`w-4 h-4 animate-spin ${isMobile ? "" : "mr-1"}`} /> : <RotateCcw className={`w-4 h-4 ${isMobile ? "" : "mr-1"}`} />}
                  {!isMobile && (ocrAllRunning ? "OCR..." : "OCR All")}
                </Button>
                <Button variant="default" size="sm" onClick={() => setMatchDialogOpen(true)}>
                  <ScanSearch className={`w-4 h-4 ${isMobile ? "" : "mr-1"}`} />
                  {!isMobile && "Cocokkan Laporan"}
                </Button>
                {selectedIds.size > 0 && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="destructive" size="sm" disabled={bulkDeleting}>
                        {bulkDeleting ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Trash2 className="w-4 h-4 mr-1" />}
                        Hapus ({selectedIds.size})
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Hapus {selectedIds.size} Resi?</AlertDialogTitle>
                        <AlertDialogDescription>Semua resi yang dipilih akan dihapus permanen. Tindakan ini tidak bisa dibatalkan.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Batal</AlertDialogCancel>
                        <AlertDialogAction onClick={bulkDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Hapus Semua</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
                {dateFilter && receipts.length > 0 && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="destructive" size="sm" disabled={deletingDay}>
                        {deletingDay ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Trash2 className="w-4 h-4 mr-1" />}
                        {isMobile ? "Hapus Hari" : "Hapus Hari Ini"}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Hapus Semua Data Tanggal {dateFilter}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Semua {receipts.length} resi beserta gambarnya pada tanggal ini akan dihapus permanen dari database dan storage. Tindakan ini tidak bisa dibatalkan.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Batal</AlertDialogCancel>
                        <AlertDialogAction onClick={deleteAllDay} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Hapus Semua</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className={isMobile ? "p-3" : "p-0"}>
            {loading ? (
              <div className="p-8 text-center text-muted-foreground">Memuat data...</div>
            ) : receipts.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">Tidak ada resi untuk tanggal ini</div>
            ) : isMobile ? (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Checkbox checked={selectedIds.size === receipts.length && receipts.length > 0} onCheckedChange={toggleSelectAll} />
                  <span className="text-xs text-muted-foreground">Pilih semua</span>
                </div>
                {sortedReceipts.slice(0, visibleCount).map((r) => <ReceiptCard key={r.id} r={r} />)}
                {visibleCount < sortedReceipts.length && (
                  <div className="text-center pt-3">
                    <Button variant="outline" size="sm" onClick={() => setVisibleCount(c => c + 50)}>
                      Tampilkan 50 lagi ({sortedReceipts.length - visibleCount} sisa)
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox checked={selectedIds.size === receipts.length && receipts.length > 0} onCheckedChange={toggleSelectAll} />
                      </TableHead>
                      <TableHead>
                        <button className="flex items-center gap-1 hover:text-foreground transition-colors" onClick={togglePhoneSort}>
                          No. HP <ArrowUpDown className="w-3 h-3" />
                          {sortByPhone && <span className="text-xs">({sortByPhone})</span>}
                        </button>
                      </TableHead>
                      <TableHead>Nominal</TableHead>
                      <TableHead>
                        <button className="flex items-center gap-1 hover:text-foreground transition-colors" onClick={toggleJamSort}>
                          Jam <ArrowUpDown className="w-3 h-3" />
                          {sortByJam && <span className="text-xs">({sortByJam})</span>}
                        </button>
                      </TableHead>
                      <TableHead>Tanggal</TableHead>
                      <TableHead>Keterangan</TableHead>
                      <TableHead>Resi</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayedReceipts.map((r) => (
                      <TableRow key={r.id} className={selectedIds.has(r.id) ? "bg-muted/50" : ""}>
                        <TableCell><Checkbox checked={selectedIds.has(r.id)} onCheckedChange={() => toggleSelect(r.id)} /></TableCell>
                        <TableCell className="whitespace-nowrap">{r.nomor_hp}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          {ocrProcessing.has(r.id) ? (
                            <span className="flex items-center gap-1 text-primary"><Loader2 className="w-3 h-3 animate-spin" />Membaca...</span>
                          ) : editingNominal === r.id ? (
                            <div className="flex items-center gap-1">
                              <input type="number" className="w-24 px-1 py-0.5 border rounded bg-background text-foreground text-sm" value={editNominalValue} onChange={e => setEditNominalValue(e.target.value)} onKeyDown={e => { if (e.key === "Enter") saveNominal(r.id); if (e.key === "Escape") setEditingNominal(null); }} autoFocus />
                              <Button size="sm" variant="ghost" className="h-6 px-1" onClick={() => saveNominal(r.id)}><Check className="w-3 h-3" /></Button>
                              <Button size="sm" variant="ghost" className="h-6 px-1" onClick={() => setEditingNominal(null)}><X className="w-3 h-3" /></Button>
                            </div>
                          ) : (
                            <button className="hover:underline cursor-pointer flex items-center gap-1" onClick={() => startEditNominal(r)}>
                              Rp {(r.nominal || 0).toLocaleString("id-ID")} <Pencil className="w-3 h-3 opacity-50" />
                            </button>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{r.jam_transfer}</TableCell>
                        <TableCell className="whitespace-nowrap">{formatDate(r.created_at)}</TableCell>
                        <TableCell className="max-w-[150px] truncate">
                          {getGroupName(r.keterangan)}
                        </TableCell>
                        <TableCell>
                          <button onClick={() => setPreviewImage(r.image_url)} className="block">
                            <img loading="lazy" src={r.image_url} alt="Resi" className="w-10 h-10 object-cover rounded border cursor-pointer hover:opacity-80 transition-opacity" />
                          </button>
                        </TableCell>
                        <TableCell>{getStatusBadge(r.status)}</TableCell>
                        <TableCell>
                          <div className="flex gap-1 items-center">
                            <Button size="sm" variant="outline" className="h-8 px-2" onClick={() => handleReOcr(r)} disabled={ocrProcessing.has(r.id)} title="OCR Ulang">
                              {ocrProcessing.has(r.id) ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                            </Button>
                            {r.status === "Pending" && (
                              <>
                                <Button size="sm" className="bg-success hover:bg-success/90 text-success-foreground h-8 px-2 text-xs" onClick={() => updateStatus(r.id, "Approved")}>
                                  <CheckCircle className="w-3 h-3 mr-1" />Approve
                                </Button>
                                <Button size="sm" variant="destructive" className="h-8 px-2 text-xs" onClick={() => updateStatus(r.id, "Rejected")}>
                                  <XCircle className="w-3 h-3 mr-1" />Reject
                                </Button>
                              </>
                            )}
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button size="sm" variant="outline" className="h-8 px-2 text-destructive hover:text-destructive"><Trash2 className="w-3 h-3" /></Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Hapus Resi?</AlertDialogTitle>
                                  <AlertDialogDescription>Resi dari <strong>{r.nama}</strong> sebesar {formatCurrency(r.nominal)} akan dihapus permanen.</AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Batal</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => deleteReceipt(r.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Hapus</AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {visibleCount < sortedReceipts.length && (
                  <div className="text-center py-3 border-t">
                    <Button variant="outline" size="sm" onClick={() => setVisibleCount(c => c + 50)}>
                      Tampilkan 50 lagi ({sortedReceipts.length - visibleCount} sisa)
                    </Button>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      {/* Image Preview Modal */}
      <Dialog open={!!previewImage} onOpenChange={(open) => { if (!open) setPreviewImage(null); }}>
        <DialogContent className="max-w-[95vw] sm:max-w-2xl p-0 overflow-hidden [&>button]:hidden bg-transparent border-none shadow-none">
          <DialogTitle className="sr-only">Preview Resi</DialogTitle>
          <div className="relative bg-card rounded-lg border-2 border-border shadow-xl overflow-hidden">
            <button onClick={() => setPreviewImage(null)} className="absolute right-2 top-2 z-50 rounded-full bg-foreground/80 text-background p-2 shadow-lg hover:bg-foreground transition-colors" aria-label="Close">
              <X className="h-5 w-5" />
            </button>
            {previewImage && <img loading="lazy" src={previewImage} alt="Preview Resi" className="w-full max-h-[80vh] object-contain" />}
          </div>
        </DialogContent>
      </Dialog>

      <LaporanMatchDialog
        open={matchDialogOpen}
        onOpenChange={setMatchDialogOpen}
        pendingReceipts={receipts.filter(r => r.status === "Pending")}
        userId={userId}
        onApproved={fetchReceipts}
      />
    </div>
  );
};

export default AdminDashboard;
