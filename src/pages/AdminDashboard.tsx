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
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Menu } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { LogOut, CheckCircle, XCircle, FileText, Filter, Search, X, Trash2, Loader2, RotateCcw, ArrowUpDown, RefreshCw, Pencil, Check, Users, ChevronDown, Copy } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import ThemeToggle from "@/components/ThemeToggle";
import AdminSidebar from "@/components/AdminSidebar";
import LaporanMatchDialog from "@/components/LaporanMatchDialog";
import { ScanSearch, HardDrive } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";
import { runHybridOcr, runAiOcr, isValidNominal, isValidJam } from "@/lib/ocr/hybridOcr";

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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
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
  const [deletingDuplicates, setDeletingDuplicates] = useState(false);
  const [hideDuplicates, setHideDuplicates] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [editingNominal, setEditingNominal] = useState<string | null>(null);
  const [editNominalValue, setEditNominalValue] = useState("");
  const [visibleCount, setVisibleCount] = useState(20);
  const [matchDialogOpen, setMatchDialogOpen] = useState(false);
  const [blockedNames, setBlockedNames] = useState<string[]>([]);
  const [blockedPhones, setBlockedPhones] = useState<string[]>([]);
  const [imageUrls, setImageUrls] = useState<Map<string, string>>(new Map());
  const [showAll, setShowAll] = useState(false);

  // Load blocked list dari Supabase
  useEffect(() => {
    supabase.from("blocked_identifiers").select("type,value").then(({ data }) => {
      if (!data) return;
      setBlockedNames(data.filter(d => d.type === "name").map(d => d.value.toLowerCase()));
      setBlockedPhones(data.filter(d => d.type === "phone").map(d => d.value));
    });
  }, []);

  // Fetch image_url on-demand untuk receipts yang terlihat
  const fetchImageUrl = useCallback(async (receiptId: string) => {
    if (imageUrls.has(receiptId)) return imageUrls.get(receiptId)!;
    
    const { data, error } = await supabase
      .from("receipts")
      .select("image_url")
      .eq("id", receiptId)
      .single();
    
    if (!error && data?.image_url) {
      setImageUrls(prev => new Map(prev).set(receiptId, data.image_url));
      return data.image_url;
    }
    return "";
  }, [imageUrls]);

  const getImageUrl = (receiptId: string): string => {
    const url = imageUrls.get(receiptId) || "";
    // Return thumbnail URL for list view (replace .jpg with _thumb.jpg)
    if (url && url.includes('/receipts/wa_')) {
      return url.replace('.jpg', '_thumb.jpg');
    }
    return url;
  };
  
  const getFullImageUrl = (receiptId: string): string => {
    // Return full original image URL for preview
    return imageUrls.get(receiptId) || "";
  };
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
        status,
        approved_by,
        approved_at,
        created_at,
        ocr_source,
        ocr_status,
        ocr_confidence,
        receipt_wa_messages(group_name)
      `)
      .order("created_at", { ascending: false })
      .limit(showAll ? 5000 : 100);

    if (dateFilter) {
      // Filter berdasarkan tanggal WIB (UTC+7)
      query = query
        .gte("created_at", `${dateFilter}T00:00:00+07:00`)
        .lt("created_at", `${dateFilter}T23:59:59.999+07:00`);
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
  }, [dateFilter, statusFilter, searchQuery, toast, showAll]);

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

  // Fetch image URLs untuk receipts yang visible
  useEffect(() => {
    const fetchVisibleImages = async () => {
      const visibleReceipts = receipts.slice(0, visibleCount);
      const missing = visibleReceipts.filter(r => !imageUrls.has(r.id));
      
      if (missing.length > 0) {
        const { data } = await supabase
          .from("receipts")
          .select("id, image_url")
          .in("id", missing.map(r => r.id));
        
        if (data) {
          const newUrls = new Map(imageUrls);
          data.forEach(r => {
            if (r.image_url) newUrls.set(r.id, r.image_url);
          });
          setImageUrls(newUrls);
        }
      }
    };
    
    if (receipts.length > 0) {
      fetchVisibleImages();
    }
  }, [receipts, visibleCount]); // eslint-disable-line react-hooks/exhaustive-deps

  // Realtime auto-refresh DIMATIKAN untuk hemat egress
  // User pakai manual refresh button aja
  // useEffect(() => {
  //   if (!userId) return;
  //   const channel = supabase
  //     .channel('receipts-realtime')
  //     .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'receipts' }, () => {
  //       setTimeout(() => { fetchReceipts(); }, 1000);
  //     })
  //     .subscribe();
  //   return () => { supabase.removeChannel(channel); };
  // }, [userId, fetchReceipts]);

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
      const imageUrl = await fetchImageUrl(receipt.id);
      if (!imageUrl) return;
      const url = new URL(imageUrl);
      const parts = url.pathname.split("/storage/v1/object/public/receipts/");
      if (parts[1]) {
        await supabase.storage.from("receipts").remove([parts[1]]);
      }
    } catch {}
    // Delete related wa messages then receipt
    await supabase.from("receipt_wa_messages").delete().eq("receipt_id", receipt.id);
    await supabase.from("receipts").delete().eq("id", receipt.id);
  }, []);

  const isBlockedReceipt = useCallback((receipt: Receipt, ocrText?: string): string | null => {
    const namaLower = (receipt.nama || '').toLowerCase();

    // Cek nama dari DB
    for (const blocked of blockedNames) {
      if (namaLower.includes(blocked)) return `Blocked name: ${blocked} (dari nama)`;
    }

    // Cek nomor HP dari DB
    for (const phone of blockedPhones) {
      if (receipt.nomor_hp?.includes(phone)) return `Blocked phone: ${phone} (dari nomor_hp)`;
    }

    // Cek dari OCR text (Tesseract raw_text atau AI keterangan)
    const checkText = [ocrText, receipt.keterangan].filter(Boolean).join(" ").toLowerCase();
    if (checkText) {
      for (const blocked of blockedNames) {
        if (checkText.includes(blocked)) return `Blocked name: ${blocked} (dari OCR)`;
      }
      for (const phone of blockedPhones) {
        if (checkText.includes(phone)) return `Blocked phone: ${phone} (dari OCR)`;
      }
    }

    return null;
  }, [blockedNames, blockedPhones]);

  const runOcrForReceipt = useCallback(async (receipt: Receipt, force = false) => {
    if (!force && ocrProcessedRef.current.has(receipt.id)) return;
    ocrProcessedRef.current.add(receipt.id);

    // Check blocked from DB fields first (no OCR needed)
    const blockedReason = isBlockedReceipt(receipt);
    if (blockedReason) {
      await autoDeleteReceipt(receipt);
      setReceipts(prev => prev.filter(r => r.id !== receipt.id));
      return;
    }

    // Skip if already valid (cost optimization). force=true bypasses.
    // Exception: nominal 100.000 selalu di-recheck via AI (ShopeePay misread).
    const suspect100k = Number(receipt.nominal) === 100000;
    if (!force && !suspect100k && isValidNominal(receipt.nominal) && isValidJam(receipt.jam_transfer)) {
      return;
    }

    // If this receipt already failed OCR before, or Tesseract isn't loaded,
    // skip Tesseract and go straight to Lovable AI OCR.
    const priorFailed = (receipt as any).ocr_status === "OCR_FAILED";
    // ShopeePay receipts sering salah baca jadi Rp 100.000 (dari teks "Cashback Saldo s.d. Rp100.000").
    // Paksa AI OCR untuk nominal mencurigakan ini.
    const suspectShopeepay = Number(receipt.nominal) === 100000;
    const aiOnly = priorFailed || suspectShopeepay || !window.Tesseract;

    setOcrProcessing(prev => new Set(prev).add(receipt.id));
    try {
      const imageUrl = await fetchImageUrl(receipt.id);
      if (!imageUrl) throw new Error("Image URL not found");
      
      const outcome = aiOnly
        ? await runAiOcr(imageUrl)
        : await runHybridOcr(imageUrl);

      // Blocked-name check: gabung raw_text (Tesseract) + keterangan (AI OCR)
      const ocrCheckText = [outcome.raw_text, outcome.keterangan].filter(Boolean).join(" ");
      if (ocrCheckText) {
        const ocrBlocked = isBlockedReceipt(receipt, ocrCheckText);
        if (ocrBlocked) {
          await autoDeleteReceipt(receipt);
          setReceipts(prev => prev.filter(r => r.id !== receipt.id));
          return;
        }
      }

      const updates: Record<string, any> = {
        ocr_source: outcome.source,
        ocr_confidence: outcome.confidence,
        ocr_status: outcome.status,
      };
      if (outcome.nominal) updates.nominal = outcome.nominal;
      if (outcome.jam_transfer) updates.jam_transfer = outcome.jam_transfer;

      const { error } = await supabase.from("receipts").update(updates).eq("id", receipt.id);
      if (error) {
        // If the new OCR columns don't exist yet, retry without them so the UI still updates.
        const retry: Record<string, any> = {};
        if (outcome.nominal) retry.nominal = outcome.nominal;
        if (outcome.jam_transfer) retry.jam_transfer = outcome.jam_transfer;
        if (Object.keys(retry).length) {
          await supabase.from("receipts").update(retry).eq("id", receipt.id);
        }
        console.warn("OCR meta columns update failed (kolom baru belum ada?):", error.message);
      }
      setReceipts(prev => prev.map(r => r.id === receipt.id ? ({ ...r, ...updates } as Receipt) : r));
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
  // EXCEPTION: auto re-run via Lovable AI for receipts that previously failed OCR.
  const aiRetryRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const failed = receipts.filter(r => {
      const s = (r as any).ocr_status as string | undefined;
      const suspect = Number(r.nominal) === 100000;
      const needs = suspect || s === "OCR_FAILED" || (!isValidNominal(r.nominal) && !isValidJam(r.jam_transfer) && s);
      return needs && !aiRetryRef.current.has(r.id);
    });
    if (failed.length === 0) return;
    failed.forEach(r => aiRetryRef.current.add(r.id));
    runOcrConcurrent(failed, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipts]);

  const handleReOcr = (receipt: Receipt) => {
    ocrProcessedRef.current.delete(receipt.id);
    runOcrForReceipt(receipt, true);
  };

  const [ocrAllRunning, setOcrAllRunning] = useState(false);

  // OCR semua pending (force re-OCR)
  const handleOcrAll = async () => {
    if (ocrAllRunning) return;
    setOcrAllRunning(true);
    const targets = receipts.filter(r => r.status?.toLowerCase() === 'pending');
    await runOcrConcurrent(targets, true);
    setOcrAllRunning(false);
  };

  // OCR hanya yang belum pernah di-OCR (ocr_source null)
  const handleOcrUnprocessed = async () => {
    if (ocrAllRunning) return;
    setOcrAllRunning(true);
    const targets = receipts.filter(r =>
      r.status?.toLowerCase() === 'pending' && !(r as any).ocr_source
    );
    ocrProcessedRef.current = new Set(); // reset cache agar tidak di-skip
    await runOcrConcurrent(targets, false);
    setOcrAllRunning(false);
  };

  // OCR ulang yang sebelumnya pakai AI (LOVABLE_AI)
  const handleOcrRetryAi = async () => {
    if (ocrAllRunning) return;
    setOcrAllRunning(true);
    const targets = receipts.filter(r =>
      r.status?.toLowerCase() === 'pending' && (r as any).ocr_source === 'LOVABLE_AI'
    );
    await runOcrConcurrent(targets, true);
    setOcrAllRunning(false);
  };

  // OCR ulang yang sebelumnya pakai Tesseract
  const handleOcrRetryTesseract = async () => {
    if (ocrAllRunning) return;
    setOcrAllRunning(true);
    const targets = receipts.filter(r =>
      r.status?.toLowerCase() === 'pending' && (r as any).ocr_source === 'TESSERACT'
    );
    await runOcrConcurrent(targets, true);
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
    const CHUNK_SIZE = 20;
    for (const status of ["Approved", "Rejected"] as const) {
      const ids = Array.from(buf[status]);
      if (ids.length === 0) continue;
      // Chunk per 20 (20 × 2.5s = 50s per invocation, aman dari timeout 150s)
      // Setiap chunk di-delay 2s agar tidak serentak
      for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
        const chunk = ids.slice(i, i + CHUNK_SIZE);
        const delayMs = (i / CHUNK_SIZE) * 2000;
        window.setTimeout(() => {
          supabase.functions.invoke("send-wa-notification", {
            body: { status, receipt_ids: chunk },
          }).then(({ error: waError }) => {
            if (waError) console.error("WA notification failed", waError);
          });
        }, delayMs);
      }
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
      
      // FLOW 1 & 2: Delete images + duplicates untuk approved receipts
      if (status === "Approved") {
        for (const receiptId of matchingIds) {
          const r = receipts.find(rec => rec.id === receiptId);
          if (!r) continue;
          
          // Flow 1: Delete image setelah approve
          const imageUrl = await fetchImageUrl(receiptId);
          if (imageUrl && imageUrl !== "") {
            try {
              const url = new URL(imageUrl);
              const parts = url.pathname.split("/storage/v1/object/public/receipts/");
              if (parts[1]) {
                await supabase.storage.from("receipts").remove([parts[1]]);
                await supabase.from("receipts").update({ image_url: "" }).eq("id", receiptId);
                console.log(`[DELETE IMAGE] ${parts[1]} deleted after approve`);
              }
            } catch (e) {
              console.error(`[DELETE IMAGE] Error:`, e);
            }
          }
          
          // Flow 2: Delete duplicates (keep oldest)
          const today = dateFilter || new Date().toISOString().split("T")[0];
          const todayStart = `${today}T00:00:00+07:00`;
          const todayEnd = `${today}T23:59:59.999+07:00`;
          
          const { data: duplicates } = await supabase
            .from("receipts")
            .select("id, created_at")
            .eq("nama", r.nama)
            .eq("nominal", r.nominal)
            .eq("jam_transfer", r.jam_transfer)
            .eq("status", "Approved")
            .gte("created_at", todayStart)
            .lt("created_at", todayEnd)
            .order("created_at", { ascending: true });
          
          if (duplicates && duplicates.length > 1) {
            const toDelete = duplicates.slice(1); // hapus yang lebih baru
            console.log(`[DUPLICATE] Found ${toDelete.length} duplicates, deleting...`);
            
            for (const dup of toDelete) {
              // Delete from receipt_wa_messages first
              await supabase.from("receipt_wa_messages").delete().eq("receipt_id", dup.id);
              // Delete from receipts
              await supabase.from("receipts").delete().eq("id", dup.id);
            }
          }
        }
      }
      
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
        const imageUrl = await fetchImageUrl(id);
        if (imageUrl) {
          const url = new URL(imageUrl);
          const parts = url.pathname.split("/storage/v1/object/public/receipts/");
          if (parts[1]) await supabase.storage.from("receipts").remove([parts[1]]);
        }
      } catch {}
      await supabase.from("receipt_wa_messages").delete().eq("receipt_id", id);
    }
    const { error } = await supabase.from("receipts").delete().eq("id", id);
    if (error) toast({ title: "Gagal hapus resi", description: error.message, variant: "destructive" });
    else { toast({ title: "Resi dihapus", description: "1 resi berhasil dihapus permanen." }); setSelectedIds(prev => { const n = new Set(prev); n.delete(id); return n; }); fetchReceipts(); }
  };

  const bulkDelete = async () => {
    if (selectedIds.size === 0) return;
    setBulkDeleting(true);
    const ids = Array.from(selectedIds);
    // Delete images from storage
    const filePathsPromises = ids.map(async (id) => {
      const r = receipts.find(rec => rec.id === id);
      if (!r) return null;
      try {
        const imageUrl = await fetchImageUrl(id);
        if (!imageUrl) return null;
        const url = new URL(imageUrl);
        const parts = url.pathname.split("/storage/v1/object/public/receipts/");
        return parts[1] || null;
      } catch { return null; }
    });
    const filePaths = (await Promise.all(filePathsPromises)).filter(Boolean) as string[];
    if (filePaths.length > 0) await supabase.storage.from("receipts").remove(filePaths);
    await supabase.from("receipt_wa_messages").delete().in("receipt_id", ids);
    const { error } = await supabase.from("receipts").delete().in("id", ids);
    if (error) toast({ title: "Gagal hapus", description: error.message, variant: "destructive" });
    else { toast({ title: "Resi dihapus", description: `${selectedIds.size} resi berhasil dihapus permanen.` }); setSelectedIds(new Set()); fetchReceipts(); }
    setBulkDeleting(false);
  };

  const deleteByStatusList = async (targets: Receipt[], label: string) => {
    if (targets.length === 0) {
      toast({ title: "Tidak ada data", description: `Tidak ada resi berstatus ${label}.` });
      return;
    }
    setDeletingDay(true);
    try {
      const filePathsPromises = targets.map(async (r) => {
        try {
          const imageUrl = await fetchImageUrl(r.id);
          if (!imageUrl) return null;
          const url = new URL(imageUrl);
          const parts = url.pathname.split("/storage/v1/object/public/receipts/");
          return parts[1] || null;
        } catch { return null; }
      });
      const filePaths = (await Promise.all(filePathsPromises)).filter(Boolean) as string[];
      if (filePaths.length > 0) await supabase.storage.from("receipts").remove(filePaths);
      const ids = targets.map(r => r.id);
      await supabase.from("receipt_wa_messages").delete().in("receipt_id", ids);
      const { error } = await supabase.from("receipts").delete().in("id", ids);
      if (error) {
        toast({ title: `Gagal hapus ${label}`, description: error.message, variant: "destructive" });
      } else {
        toast({ title: `${ids.length} resi ${label} dihapus`, description: "Data berhasil dihapus permanen." });
        setSelectedIds(new Set());
        fetchReceipts();
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
    setDeletingDay(false);
  };

  const deleteAllDay = async () => deleteByStatusList(receipts, "hari ini");
  const deleteAllPending = async () => deleteByStatusList(receipts.filter(r => r.status === "Pending"), "Pending");
  const deleteAllApproved = async () => deleteByStatusList(receipts.filter(r => r.status === "Approved"), "Approved");

  const deleteDuplicates = async () => {
    setDeletingDuplicates(true);
    try {
      // Pakai data yang sedang tampil/filter saat ini, lalu simpan item paling atas.
      // Duplikat mengikuti tombol "Unik saja": nama + nominal + jam.
      const seen = new Set<string>();
      const toDelete = sortedReceipts
        .filter(r => r.status === "Approved")
        .filter(r => {
          const key = `${(r.nama || "").trim().toLowerCase()}|${r.nominal}|${r.jam_transfer}`;
          if (seen.has(key)) return true;
          seen.add(key);
          return false;
        });

      if (toDelete.length === 0) {
        toast({ title: "Tidak ada duplikat ditemukan ✅" });
        setDeletingDuplicates(false);
        return;
      }

      // Hapus gambar dari Storage dulu (best effort, lanjut walau file sudah tidak ada)
      const BUCKET = "receipts";
      const marker = "/storage/v1/object/public/receipts/";
      const pathsPromises = toDelete.map(async (r) => {
        const imageUrl = await fetchImageUrl(r.id);
        const idx = (imageUrl || "").indexOf(marker);
        return idx !== -1 ? imageUrl!.slice(idx + marker.length) : null;
      });
      const paths = (await Promise.all(pathsPromises)).filter((p): p is string => !!p);

      for (let i = 0; i < paths.length; i += 100) {
        await supabase.storage.from(BUCKET).remove(paths.slice(i, i + 100));
      }

      // Hapus baris duplikat dari DB
      const ids = toDelete.map(r => r.id);
      for (let i = 0; i < ids.length; i += 500) {
        const { error: dErr } = await supabase.from("receipts").delete().in("id", ids.slice(i, i + 500));
        if (dErr) throw dErr;
      }

      toast({ title: `${toDelete.length} resi duplikat berhasil dihapus 🗑️` });
      fetchReceipts();
    } catch (e: any) {
      toast({ title: "Gagal hapus duplikat", description: e.message, variant: "destructive" });
    }
    setDeletingDuplicates(false);
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

    // Sembunyikan duplikat: dari resi yang nama+nominal+jam sama, hanya tampilkan 1 (paling atas)
    if (hideDuplicates) {
      const seen = new Set<string>();
      sorted = sorted.filter(r => {
        const key = `${(r.nama || "").toLowerCase()}|${r.nominal}|${r.jam_transfer}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
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
      case "Approved": return <Badge className="bg-green-500/10 text-green-400 border-green-500/20">Approved</Badge>;
      case "Rejected": return <Badge className="bg-red-500/10 text-red-400 border-red-500/20">Rejected</Badge>;
      default: return <Badge className="bg-orange-500/10 text-orange-400 border-orange-500/20">Pending</Badge>;
    }
  };

  const getOcrBadge = (r: Receipt) => {
    const src = (r as any).ocr_source as string | null | undefined;
    const status = (r as any).ocr_status as string | null | undefined;
    // Always render a box — grey if not yet OCR'd, colored if done
    if (status === "OCR_FAILED") {
      return (
        <span title="OCR Gagal" className="inline-flex items-center justify-center w-5 h-5 rounded border border-red-500/60 bg-red-500/10 shadow-[0_0_6px_rgba(239,68,68,0.4)]">
          <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
        </span>
      );
    }
    if (src === "TESSERACT") {
      return (
        <span title="OCR: Tesseract" className="inline-flex items-center justify-center w-5 h-5 rounded border border-emerald-500/60 bg-emerald-500/10 shadow-[0_0_6px_rgba(16,185,129,0.4)]">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
        </span>
      );
    }
    if (src === "LOVABLE_AI") {
      return (
        <span title="OCR: AI" className="inline-flex items-center justify-center w-5 h-5 rounded border border-purple-500/60 bg-purple-500/10 shadow-[0_0_6px_rgba(168,85,247,0.4)]">
          <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
        </span>
      );
    }
    // Not yet OCR'd — grey box
    return (
      <span title="Belum di-OCR" className="inline-flex items-center justify-center w-5 h-5 rounded border border-white/20 bg-white/5">
        <span className="w-1.5 h-1.5 rounded-full bg-gray-500" />
      </span>
    );
  };


  const formatCurrency = (val: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(val);
  const formatDate = (dateStr: string) => new Date(dateStr).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });


  const getGroupName = (keterangan: string | null, groupNameRaw?: string | null) => {
    const raw = groupNameRaw || keterangan || "";
    if (!raw) return "-";
    // Extract K.AHxxxx code (e.g. "K.AH1162" from "🌺 K.AH1162 CO SUKA...")
    const codeMatch = raw.match(/[Kk]\.?[Aa][Hh]\d+/);
    if (codeMatch) return codeMatch[0];
    // Fallback: first word that has alphanumeric chars (skip pure-emoji tokens)
    const firstReal = raw.trim().split(/\s+/).find(w => /[a-zA-Z0-9]/.test(w));
    return firstReal || "-";
  };

  // --- OCR Selected ---
  const handleOcrSelected = async () => {
    if (ocrAllRunning || selectedIds.size === 0) return;
    const items = receipts.filter(r => selectedIds.has(r.id));
    if (items.length === 0) return;
    setOcrAllRunning(true);
    toast({ title: `OCR ${items.length} resi terpilih...` });
    await runOcrConcurrent(items, true);
    setOcrAllRunning(false);
    toast({ title: "OCR selesai ✅" });
  };

  // --- Mobile Card Row (clean card list) ---
  const MobileRow = ({ r }: { r: Receipt }) => {
    const d = new Date(r.created_at);
    const statusCfg = r.status === "Approved"
      ? { pill: "bg-green-500/10 border-green-500/20 text-green-400", dot: "bg-green-400" }
      : r.status === "Rejected"
      ? { pill: "bg-red-500/10 border-red-500/20 text-red-400", dot: "bg-red-400" }
      : { pill: "bg-orange-500/10 border-orange-500/20 text-orange-400", dot: "bg-orange-400" };

    return (
      <div className={`px-3 py-3 border-b border-white/5 ${selectedIds.has(r.id) ? "bg-purple-500/5" : ""}`}>
        {/* Baris 1: checkbox + nama/grup + status pill + thumbnail */}
        <div className="flex items-start gap-2">
          <Checkbox checked={selectedIds.has(r.id)} onCheckedChange={() => toggleSelect(r.id)} className="border-white/20 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white truncate">{r.nama || r.nomor_hp}</p>
                <p className="text-xs text-gray-400 truncate">
                  {getGroupName(r.keterangan, (r as any).receipt_wa_messages?.[0]?.group_name)}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-medium ${statusCfg.pill}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${statusCfg.dot}`} />
                  {r.status}
                </span>
                <button onClick={async () => {
                  const url = await fetchImageUrl(r.id);
                  if (url) setPreviewImage(url);
                }} className="shrink-0">
                  <img loading="lazy" src={getImageUrl(r.id)} alt="Resi" className="w-9 h-9 object-cover rounded border border-white/20 hover:opacity-80 transition-opacity" />
                </button>
              </div>
            </div>

            {/* Baris 2: Nominal + Tanggal */}
            <div className="flex items-center gap-3 mt-1.5">
              <span className="text-xs text-gray-400">Nominal:</span>
              {ocrProcessing.has(r.id) ? (
                <span className="flex items-center gap-1 text-purple-400 text-xs"><Loader2 className="w-3 h-3 animate-spin" />Membaca...</span>
              ) : editingNominal === r.id ? (
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    className="w-24 px-1.5 py-0.5 rounded bg-[#0a0e1a] text-white border border-white/20 text-xs"
                    value={editNominalValue}
                    onChange={(e) => setEditNominalValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") saveNominal(r.id); if (e.key === "Escape") setEditingNominal(null); }}
                    autoFocus
                  />
                  <button onClick={() => saveNominal(r.id)}><Check className="w-3 h-3 text-green-400" /></button>
                  <button onClick={() => setEditingNominal(null)}><X className="w-3 h-3 text-gray-400" /></button>
                </div>
              ) : (
                <button className="flex items-center gap-1 text-xs font-medium text-white" onClick={() => startEditNominal(r)}>
                  {formatCurrency(r.nominal)} <Pencil className="w-3 h-3 opacity-40" />
                </button>
              )}
              <span className="text-gray-500">·</span>
              <span className="text-xs text-gray-400">{formatDate(r.created_at)}</span>
              <span className="text-xs text-gray-500">{r.jam_transfer || d.toLocaleTimeString("id-ID", { hour12: false })}</span>
            </div>

            {/* Baris 3: Tombol aksi */}
            <div className="flex items-center gap-1.5 mt-2">
              <button
                onClick={() => handleReOcr(r)}
                disabled={ocrProcessing.has(r.id)}
                title="Re-OCR"
                className="flex items-center gap-1 h-7 px-2 rounded border border-white/20 text-gray-300 hover:bg-white/10 text-xs transition-colors disabled:opacity-50"
              >
                {ocrProcessing.has(r.id) ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                <span>Re-OCR</span>
              </button>
              {r.status === "Pending" && (
                <>
                  <button
                    onClick={() => updateStatus(r.id, "Approved")}
                    className="flex items-center gap-1 h-7 px-2 rounded bg-green-600 hover:bg-green-700 text-white text-xs transition-colors"
                  >
                    <CheckCircle className="w-3 h-3" /><span>Approve</span>
                  </button>
                  <button
                    onClick={() => updateStatus(r.id, "Rejected")}
                    className="flex items-center gap-1 h-7 px-2 rounded bg-red-600 hover:bg-red-700 text-white text-xs transition-colors"
                  >
                    <XCircle className="w-3 h-3" /><span>Reject</span>
                  </button>
                </>
              )}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button title="Hapus" className="flex items-center gap-1 h-7 px-2 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 text-xs transition-colors">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle className="text-white">Hapus Resi?</AlertDialogTitle>
                    <AlertDialogDescription className="text-gray-400">Resi dari <strong className="text-white">{r.nama}</strong> sebesar {formatCurrency(r.nominal)} akan dihapus permanen.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="bg-transparent border-white/20 text-gray-300 hover:bg-white/10">Batal</AlertDialogCancel>
                    <AlertDialogAction onClick={() => deleteReceipt(r.id)} className="bg-red-600 text-white hover:bg-red-700">Hapus</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // --- Mobile Card (tidak dipakai lagi di dashboard, disimpan sebagai referensi) ---
  const ReceiptCard = ({ r }: { r: Receipt }) => (
    <Card className="mb-3 bg-[#1a1f35] border-white/10">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start gap-2">
          <Checkbox checked={selectedIds.has(r.id)} onCheckedChange={() => toggleSelect(r.id)} className="mt-1 border-white/20" />
          <div className="flex-1">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-semibold text-white">{r.nomor_hp}</p>
              </div>
              <div className="flex items-center gap-1 flex-wrap justify-end">{getOcrBadge(r)}{getStatusBadge(r.status)}</div>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <span className="text-gray-400">Nominal:</span>
            {ocrProcessing.has(r.id) ? (
              <p className="font-medium flex items-center gap-1 text-purple-400"><Loader2 className="w-3 h-3 animate-spin" />Membaca resi...</p>
            ) : editingNominal === r.id ? (
              <div className="flex items-center gap-1 mt-1">
                <Input
                  className="h-7 w-28 text-xs bg-[#0a0e1a] border-white/20 text-white"
                  value={editNominalValue}
                  onChange={(e) => setEditNominalValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") saveNominal(r.id); if (e.key === "Escape") setEditingNominal(null); }}
                  autoFocus
                />
                <Button size="sm" variant="ghost" className="h-7 px-1 hover:bg-white/10" onClick={() => saveNominal(r.id)}><Check className="w-3 h-3 text-green-400" /></Button>
                <Button size="sm" variant="ghost" className="h-7 px-1 hover:bg-white/10" onClick={() => setEditingNominal(null)}><X className="w-3 h-3 text-gray-400" /></Button>
              </div>
            ) : (
              <button className="font-medium flex items-center gap-1 text-white" onClick={() => startEditNominal(r)}>
                {formatCurrency(r.nominal)} <Pencil className="w-3 h-3 opacity-40" />
              </button>
            )}
          </div>
          <div>
            <span className="text-gray-400">Jam:</span>
            {ocrProcessing.has(r.id) ? (
              <p className="font-medium flex items-center gap-1 text-purple-400"><Loader2 className="w-3 h-3 animate-spin" />...</p>
            ) : (
              <p className="font-medium text-white">{r.jam_transfer}</p>
            )}
          </div>
          <div>
            <span className="text-gray-400">Tanggal:</span>
            <p className="font-medium text-white">{formatDate(r.created_at)}</p>
          </div>
        </div>
        {r.keterangan && (
          <div className="text-sm">
            <span className="text-gray-400">Keterangan:</span>
              <p className="text-white">
                {getGroupName(r.keterangan)}
              </p>
          </div>
        )}
        <div className="flex items-center gap-3">
          <button onClick={async () => {
            const url = await fetchImageUrl(r.id);
            if (url) setPreviewImage(url);
          }} className="shrink-0">
            <img loading="lazy" src={getImageUrl(r.id)} alt="Resi" className="w-14 h-14 object-cover rounded border border-white/20 cursor-pointer hover:opacity-80 transition-opacity" />
          </button>
          <div className="flex-1 grid grid-cols-2 gap-1.5">
            <Button size="sm" variant="outline" className="h-8 px-2 text-xs border-white/20 text-gray-300 hover:bg-white/10" onClick={() => handleReOcr(r)} disabled={ocrProcessing.has(r.id)}>
              {ocrProcessing.has(r.id) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
              <span className="ml-1">Re-OCR</span>
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="outline" className="h-8 px-2 text-xs border-red-500/30 text-red-400 hover:bg-red-500/10">
                  <Trash2 className="w-3.5 h-3.5" /><span className="ml-1">Hapus</span>
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle className="text-white">Hapus Resi?</AlertDialogTitle>
                  <AlertDialogDescription className="text-gray-400">Resi dari <strong className="text-white">{r.nama}</strong> sebesar {formatCurrency(r.nominal)} akan dihapus permanen.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="bg-transparent border-white/20 text-gray-300 hover:bg-white/10">Batal</AlertDialogCancel>
                  <AlertDialogAction onClick={() => deleteReceipt(r.id)} className="bg-red-600 text-white hover:bg-red-700">Hapus</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            {r.status === "Pending" && (
              <>
                <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white h-8 px-2 text-xs" onClick={() => updateStatus(r.id, "Approved")}>
                  <CheckCircle className="w-3.5 h-3.5 mr-1" />Approve
                </Button>
                <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white h-8 px-2 text-xs" onClick={() => updateStatus(r.id, "Rejected")}>
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
    <div className="min-h-screen bg-[#0a0e1a] flex overflow-x-hidden">
      <AdminSidebar />

      {/* Main Content */}
      <div className="flex-1 min-w-0 lg:ml-56">
        <header className="bg-[#0f1424] border-b border-white/5 sticky top-0 z-10">
          <div className="px-4 py-3 md:px-6 md:py-4 flex items-center gap-3">
            {/* Hamburger (mobile only) */}
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

            {/* Logo tile (mobile only) */}
            <div className="lg:hidden shrink-0 w-9 h-9 rounded-lg bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center">
              <CheckCircle className="w-5 h-5 text-white" />
            </div>

            <div className="flex-1 min-w-0">
              <h1 className="text-base md:text-xl font-bold text-white truncate">Dashboard Validasi Resi</h1>
              <p className="text-[11px] md:text-sm text-gray-400 mt-0.5 truncate">Selamat datang kembali, <span className="text-white font-medium">Admin AH</span> 👋</p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {/* Kalender: ikon saja di mobile, chip lengkap di desktop */}
              <div className="sm:hidden flex items-center justify-center w-9 h-9 rounded-lg border border-white/10 bg-white/5 text-gray-300">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <line x1="16" y1="2" x2="16" y2="6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <line x1="8" y1="2" x2="8" y2="6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <line x1="3" y1="10" x2="21" y2="10" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <div className="hidden sm:flex items-center gap-2 px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-gray-300 text-sm">
                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <line x1="16" y1="2" x2="16" y2="6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <line x1="8" y1="2" x2="8" y2="6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <line x1="3" y1="10" x2="21" y2="10" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span className="text-white font-medium">{new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}</span>
              </div>
            </div>
          </div>
        </header>

      <main className="px-4 py-4 md:px-6 md:py-6 space-y-4 md:space-y-5 pb-6">
        {/* Filters */}
        <Card className="bg-[#0f1424] border-2 border-purple-500/30 shadow-[0_0_15px_rgba(168,85,247,0.15)]">
          <CardContent className="p-4 md:py-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-white mb-4">
              <div className="flex items-center justify-center w-7 h-7 rounded-md bg-purple-500/10">
                <Filter className="w-4 h-4 text-purple-400" />
              </div>
              <span>Filter & Pencarian</span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
              <div className="space-y-2 col-span-2 sm:col-span-1">
                <label className="text-xs font-medium text-gray-400">Cari Nama / No. HP</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                  <Input className="pl-9 bg-[#1a1f35] border-white/10 text-white placeholder:text-gray-500 focus:border-purple-500/50 transition-colors h-10" placeholder="Ketik nama atau nomor HP..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-gray-400">Tanggal</label>
                <div className="relative">
                  <Input 
                    type="date" 
                    className="bg-[#1a1f35] border-white/10 text-white focus:border-purple-500/50 transition-colors h-10 pr-10 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:right-3 [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-100 [&::-webkit-calendar-picker-indicator]:w-4 [&::-webkit-calendar-picker-indicator]:h-4 [&::-webkit-calendar-picker-indicator]:filter [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:brightness-[0.8] [&::-webkit-calendar-picker-indicator]:contrast-[1.5]" 
                    value={dateFilter} 
                    onChange={(e) => setDateFilter(e.target.value)} 
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-gray-400">Status</label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="bg-[#1a1f35] border-white/10 text-white h-10"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-[#1a1f35] border-white/10">
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
        <div className="grid grid-cols-3 gap-2 md:gap-4">
          {(() => {
            const total = receipts.length;
            const pendingCount = receipts.filter(r => r.status === "Pending").length;
            const approvedCount = receipts.filter(r => r.status === "Approved").length;
            const rejectedCount = receipts.filter(r => r.status === "Rejected").length;
            const pctPending  = total > 0 ? Math.round((pendingCount  / total) * 100) : 0;
            const pctApproved = total > 0 ? Math.round((approvedCount / total) * 100) : 0;
            const pctRejected = total > 0 ? Math.round((rejectedCount / total) * 100) : 0;
            return (
              <>
          <Card className="bg-[#0f1424] border-2 border-orange-500/30 shadow-[0_0_15px_rgba(249,115,22,0.15)] hover:shadow-[0_0_25px_rgba(249,115,22,0.25)] transition-all overflow-hidden relative">
            <CardContent className="p-3 md:p-6">
              <div className="flex flex-col items-center text-center gap-2 md:flex-row md:items-center md:text-left md:gap-4">
                <div className="w-9 h-9 md:w-14 md:h-14 rounded-full bg-orange-500/10 flex items-center justify-center border-2 border-orange-500/30 shrink-0">
                  <svg className="w-5 h-5 md:w-7 md:h-7 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-2xl md:text-5xl font-bold text-orange-400 tabular-nums leading-none mb-1 md:mb-2">{pendingCount}</p>
                  <p className="text-xs md:text-sm font-semibold text-orange-400">Pending</p>
                  <p className="text-[10px] md:text-xs text-gray-400 mt-0.5 md:mt-1 leading-tight">Menunggu verifikasi</p>
                </div>
                <div className="hidden md:block text-right shrink-0">
                  <span className="text-sm font-bold text-orange-400">{pctPending}%</span>
                  <p className="text-[10px] text-gray-500">dari total</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-[#0f1424] border-2 border-green-500/30 shadow-[0_0_15px_rgba(34,197,94,0.15)] hover:shadow-[0_0_25px_rgba(34,197,94,0.25)] transition-all overflow-hidden relative">
            <CardContent className="p-3 md:p-6">
              <div className="flex flex-col items-center text-center gap-2 md:flex-row md:items-center md:text-left md:gap-4">
                <div className="w-9 h-9 md:w-14 md:h-14 rounded-full bg-green-500/10 flex items-center justify-center border-2 border-green-500/30 shrink-0">
                  <CheckCircle className="w-5 h-5 md:w-7 md:h-7 text-green-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-2xl md:text-5xl font-bold text-green-400 tabular-nums leading-none mb-1 md:mb-2">{approvedCount}</p>
                  <p className="text-xs md:text-sm font-semibold text-green-400">Approved</p>
                  <p className="text-[10px] md:text-xs text-gray-400 mt-0.5 md:mt-1 leading-tight">Disetujui</p>
                </div>
                <div className="hidden md:block text-right shrink-0">
                  <span className="text-sm font-bold text-green-400">{pctApproved}%</span>
                  <p className="text-[10px] text-gray-500">dari total</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-[#0f1424] border-2 border-red-500/30 shadow-[0_0_15px_rgba(239,68,68,0.15)] hover:shadow-[0_0_25px_rgba(239,68,68,0.25)] transition-all overflow-hidden relative">
            <CardContent className="p-3 md:p-6">
              <div className="flex flex-col items-center text-center gap-2 md:flex-row md:items-center md:text-left md:gap-4">
                <div className="w-9 h-9 md:w-14 md:h-14 rounded-full bg-red-500/10 flex items-center justify-center border-2 border-red-500/30 shrink-0">
                  <XCircle className="w-5 h-5 md:w-7 md:h-7 text-red-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-2xl md:text-5xl font-bold text-red-400 tabular-nums leading-none mb-1 md:mb-2">{rejectedCount}</p>
                  <p className="text-xs md:text-sm font-semibold text-red-400">Rejected</p>
                  <p className="text-[10px] md:text-xs text-gray-400 mt-0.5 md:mt-1 leading-tight">Ditolak</p>
                </div>
                <div className="hidden md:block text-right shrink-0">
                  <span className="text-sm font-bold text-red-400">{pctRejected}%</span>
                  <p className="text-[10px] text-gray-500">dari total</p>
                </div>
              </div>
            </CardContent>
          </Card>
              </>
            );
          })()}
        </div>

        {/* Data List */}
        <Card className="bg-[#0f1424] border-white/5">
          <CardHeader className="p-4 pb-3 md:pb-4 border-b border-white/5">
            <div className="flex flex-col gap-2">
              {/* Baris 1: Judul + Refresh + OCR + Hapus */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="flex items-center justify-center w-7 h-7 md:w-8 md:h-8 rounded-lg bg-purple-500/10 shrink-0">
                    <FileText className="w-4 h-4 text-purple-400" />
                  </div>
                  <CardTitle className="text-sm md:text-base font-semibold text-white truncate">Daftar Resi <span className="text-gray-400 font-normal text-xs md:text-sm">({receipts.length})</span></CardTitle>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {/* Refresh */}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2.5 text-xs border-white/20 text-gray-300 hover:bg-white/10 transition-colors"
                    onClick={async () => { setRefreshing(true); await fetchReceipts(); setRefreshing(false); }}
                    disabled={refreshing}
                    title="Refresh"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
                    <span className="hidden sm:inline ml-1.5">Refresh</span>
                  </Button>
                  {/* OCR Semua — dropdown */}
                  <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 px-3 text-xs border-white/20 text-gray-300 hover:bg-white/10 transition-colors gap-1.5"
                      disabled={ocrAllRunning || receipts.length === 0}
                    >
                      {ocrAllRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ScanSearch className="w-3.5 h-3.5" />}
                      <span className="hidden sm:inline">OCR Semua</span>
                      <ChevronDown className="w-3 h-3 opacity-60" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="bg-[#0f1424] border-white/10 text-gray-200 w-56">
                    <DropdownMenuLabel className="text-xs text-gray-500 font-normal">Pilih mode OCR</DropdownMenuLabel>
                    <DropdownMenuSeparator className="bg-white/5" />
                    <DropdownMenuItem
                      className="text-xs gap-2 cursor-pointer hover:bg-white/10 focus:bg-white/10 focus:text-white"
                      onClick={handleOcrAll}
                    >
                      <ScanSearch className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                      <div>
                        <p className="font-medium text-white">OCR Semua Pending</p>
                        <p className="text-gray-500">Force re-OCR semua resi pending</p>
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-xs gap-2 cursor-pointer hover:bg-white/10 focus:bg-white/10 focus:text-white"
                      onClick={handleOcrUnprocessed}
                    >
                      <ScanSearch className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                      <div>
                        <p className="font-medium text-white">OCR Belum Diproses</p>
                        <p className="text-gray-500">Hanya yang belum pernah di-OCR</p>
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator className="bg-white/5" />
                    <DropdownMenuItem
                      className="text-xs gap-2 cursor-pointer hover:bg-white/10 focus:bg-white/10 focus:text-white"
                      onClick={handleOcrRetryAi}
                    >
                      <ScanSearch className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                      <div>
                        <p className="font-medium text-white">OCR Ulang — AI</p>
                        <p className="text-gray-500">Ulangi yang sebelumnya pakai AI</p>
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-xs gap-2 cursor-pointer hover:bg-white/10 focus:bg-white/10 focus:text-white"
                      onClick={handleOcrRetryTesseract}
                    >
                      <ScanSearch className="w-3.5 h-3.5 text-green-400 shrink-0" />
                      <div>
                        <p className="font-medium text-white">OCR Ulang — Tesseract</p>
                        <p className="text-gray-500">Ulangi yang sebelumnya pakai Tesseract</p>
                      </div>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                {/* Hapus dropdown */}
                {dateFilter && receipts.length > 0 && (() => {
                  const pendingCount = receipts.filter(r => r.status === "Pending").length;
                  const approvedCount = receipts.filter(r => r.status === "Approved").length;
                  return (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-9 px-3 text-xs border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors gap-1.5"
                          disabled={deletingDay}
                        >
                          {deletingDay ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                          <span className="hidden sm:inline">Hapus</span>
                          <ChevronDown className="w-3 h-3 opacity-60" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="bg-[#0f1424] border-white/10 text-gray-200 w-52">
                        <DropdownMenuLabel className="text-xs text-gray-500 font-normal">Pilih yang ingin dihapus</DropdownMenuLabel>
                        <DropdownMenuSeparator className="bg-white/5" />
                        {/* Hapus Hari Ini */}
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <DropdownMenuItem
                              className="text-xs gap-2 cursor-pointer hover:bg-white/10 focus:bg-white/10 focus:text-white"
                              onSelect={e => e.preventDefault()}
                            >
                              <Trash2 className="w-3.5 h-3.5 text-red-400 shrink-0" />
                              <div>
                                <p className="font-medium text-white">Hapus Hari Ini</p>
                                <p className="text-gray-500">Semua {receipts.length} resi tanggal {dateFilter}</p>
                              </div>
                            </DropdownMenuItem>
                          </AlertDialogTrigger>
                          <AlertDialogContent className="bg-[#0f1424] border-white/10">
                            <AlertDialogHeader>
                              <AlertDialogTitle className="text-white">Hapus Semua Resi Tanggal {dateFilter}?</AlertDialogTitle>
                              <AlertDialogDescription className="text-gray-400">
                                Semua {receipts.length} resi beserta gambarnya akan dihapus permanen.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel className="bg-transparent border-white/20 text-gray-300 hover:bg-white/10">Batal</AlertDialogCancel>
                              <AlertDialogAction onClick={deleteAllDay} className="bg-red-600 text-white hover:bg-red-700">Hapus Semua</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                        {/* Hapus Pending */}
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <DropdownMenuItem
                              className="text-xs gap-2 cursor-pointer hover:bg-white/10 focus:bg-white/10 focus:text-white"
                              onSelect={e => e.preventDefault()}
                              disabled={pendingCount === 0}
                            >
                              <Trash2 className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                              <div>
                                <p className="font-medium text-white">Hapus Semua Pending</p>
                                <p className="text-gray-500">{pendingCount} resi pending</p>
                              </div>
                            </DropdownMenuItem>
                          </AlertDialogTrigger>
                          <AlertDialogContent className="bg-[#0f1424] border-white/10">
                            <AlertDialogHeader>
                              <AlertDialogTitle className="text-white">Hapus {pendingCount} Resi Pending?</AlertDialogTitle>
                              <AlertDialogDescription className="text-gray-400">
                                Semua resi berstatus Pending pada tanggal {dateFilter} akan dihapus permanen.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel className="bg-transparent border-white/20 text-gray-300 hover:bg-white/10">Batal</AlertDialogCancel>
                              <AlertDialogAction onClick={deleteAllPending} className="bg-red-600 text-white hover:bg-red-700">Hapus Pending</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                        {/* Hapus Approved */}
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <DropdownMenuItem
                              className="text-xs gap-2 cursor-pointer hover:bg-white/10 focus:bg-white/10 focus:text-white"
                              onSelect={e => e.preventDefault()}
                              disabled={approvedCount === 0}
                            >
                              <Trash2 className="w-3.5 h-3.5 text-green-400 shrink-0" />
                              <div>
                                <p className="font-medium text-white">Hapus Semua Approve</p>
                                <p className="text-gray-500">{approvedCount} resi approved</p>
                              </div>
                            </DropdownMenuItem>
                          </AlertDialogTrigger>
                          <AlertDialogContent className="bg-[#0f1424] border-white/10">
                            <AlertDialogHeader>
                              <AlertDialogTitle className="text-white">Hapus {approvedCount} Resi Approved?</AlertDialogTitle>
                              <AlertDialogDescription className="text-gray-400">
                                Semua resi berstatus Approved pada tanggal {dateFilter} akan dihapus permanen.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel className="bg-transparent border-white/20 text-gray-300 hover:bg-white/10">Batal</AlertDialogCancel>
                              <AlertDialogAction onClick={deleteAllApproved} className="bg-red-600 text-white hover:bg-red-700">Hapus Approved</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>

                        {/* Separator + Hapus Resi Duplikat */}
                        <DropdownMenuSeparator className="bg-purple-500/20" />
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <DropdownMenuItem
                              className="text-xs gap-2 cursor-pointer hover:bg-purple-500/10 focus:bg-purple-500/10 focus:text-white"
                              onSelect={e => e.preventDefault()}
                              disabled={deletingDuplicates}
                            >
                              <Copy className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                              <div>
                                <p className="font-medium text-purple-300">Hapus Resi Duplikat</p>
                                <p className="text-gray-500">Approved dengan data sama</p>
                              </div>
                            </DropdownMenuItem>
                          </AlertDialogTrigger>
                          <AlertDialogContent className="bg-[#0f1424] border-white/10">
                            <AlertDialogHeader>
                              <AlertDialogTitle className="text-white">Hapus Resi Duplikat?</AlertDialogTitle>
                              <AlertDialogDescription className="text-gray-400">
                                Resi <b className="text-white">Approved</b> yang memiliki kombinasi <b className="text-purple-300">nama + nomor HP + nominal + jam</b> sama akan dihapus —
                                hanya menyimpan yang <b className="text-white">paling lama</b>. Gambar di storage juga ikut dihapus. Resi Pending tidak tersentuh.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel className="bg-transparent border-white/20 text-gray-300 hover:bg-white/10">Batal</AlertDialogCancel>
                              <AlertDialogAction onClick={deleteDuplicates} className="bg-purple-700 text-white hover:bg-purple-800">Hapus Duplikat</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>

                      </DropdownMenuContent>
                    </DropdownMenu>
                  );
                })()}
              </div>
            </div>

            {/* Baris 2: Toggle duplikat + Show All — selalu tampil di bawah */}
            <div className="flex items-center gap-2">
              {/* Toggle Sembunyikan Duplikat */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setHideDuplicates(prev => !prev)}
                className={`h-8 text-xs transition-colors ${hideDuplicates ? "bg-yellow-500/20 border-yellow-500/40 text-yellow-300 hover:bg-yellow-500/30" : "border-white/20 text-gray-400 hover:bg-white/10"}`}
                title={hideDuplicates ? "Tampilkan semua termasuk duplikat" : "Sembunyikan duplikat"}
              >
                {hideDuplicates ? "Unik saja" : "Semua"}
              </Button>
              {/* Show All toggle */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAll(prev => !prev)}
                className={`h-8 text-xs transition-colors ${showAll ? "bg-purple-500/20 border-purple-500/40 text-purple-300 hover:bg-purple-500/30" : "border-white/20 text-gray-400 hover:bg-white/10"}`}
                title={showAll ? "Mode hemat (100 data)" : "Tampilkan semua data hari ini"}
              >
                {showAll ? `Semua (${receipts.length})` : "Load 100"}
              </Button>
              {/* Show All / Collapse toggle */}
              {visibleCount < sortedReceipts.length ? (
                <Button variant="outline" size="sm" className="h-8 text-xs border-purple-500/30 text-purple-400 hover:bg-purple-500/10 transition-colors" onClick={() => setVisibleCount(sortedReceipts.length)}>
                  Show All ({sortedReceipts.length})
                </Button>
              ) : sortedReceipts.length > 50 && (
                <Button variant="outline" size="sm" className="h-8 text-xs border-purple-500/30 text-purple-400 hover:bg-purple-500/10 transition-colors" onClick={() => setVisibleCount(50)}>
                  Collapse (50)
                </Button>
              )}
            </div>

          </div>
        </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-8 text-center text-gray-400">Memuat data...</div>
            ) : receipts.length === 0 ? (
              <div className="p-8 text-center text-gray-400">Tidak ada resi untuk tanggal ini</div>
            ) : (
              <>
              <div className="md:hidden">
                <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/5">
                  <Checkbox checked={selectedIds.size === receipts.length && receipts.length > 0} onCheckedChange={toggleSelectAll} className="border-white/20" />
                  <span className="text-[11px] text-gray-400">Pilih semua ({receipts.length})</span>
                </div>
                <div>
                  {sortedReceipts.slice(0, visibleCount).map((r) => <MobileRow key={r.id} r={r} />)}
                </div>
                {visibleCount < sortedReceipts.length && (
                  <div className="text-center py-3 border-t border-white/5">
                    <Button variant="outline" size="sm" className="text-xs border-white/20 text-gray-300 hover:bg-white/10" onClick={() => setVisibleCount(c => c + 50)}>
                      Tampilkan 50 lagi ({sortedReceipts.length - visibleCount} sisa)
                    </Button>
                  </div>
                )}
              </div>
      <div className="hidden md:block">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-[#1a1f35] hover:bg-[#1a1f35] border-b border-white/5">
                      <TableHead className="w-10 text-gray-300">
                        <Checkbox checked={selectedIds.size === receipts.length && receipts.length > 0} onCheckedChange={toggleSelectAll} className="border-white/20" />
                      </TableHead>
                      <TableHead className="font-semibold text-gray-300 text-xs uppercase tracking-wide">
                        <button className="flex items-center gap-1 hover:text-purple-400 transition-colors" onClick={togglePhoneSort}>
                          Nama <ArrowUpDown className="w-3 h-3" />
                          {sortByPhone && <span className="text-xs normal-case">({sortByPhone})</span>}
                        </button>
                      </TableHead>
                      <TableHead className="font-semibold text-gray-300 text-xs uppercase tracking-wide">Nominal</TableHead>
                      <TableHead className="font-semibold text-gray-300 text-xs uppercase tracking-wide">
                        <button className="flex items-center gap-1 hover:text-purple-400 transition-colors" onClick={toggleJamSort}>
                          Jam <ArrowUpDown className="w-3 h-3" />
                          {sortByJam && <span className="text-xs normal-case">({sortByJam})</span>}
                        </button>
                      </TableHead>
                      <TableHead className="font-semibold text-gray-300 text-xs uppercase tracking-wide">Tanggal</TableHead>
                      <TableHead className="font-semibold text-gray-300 text-xs uppercase tracking-wide">Nama Group</TableHead>
                      <TableHead className="font-semibold text-gray-300 text-xs uppercase tracking-wide">Resi</TableHead>
                      <TableHead className="font-semibold text-gray-300 text-xs uppercase tracking-wide w-36">Status</TableHead>
                      <TableHead className="font-semibold text-gray-300 text-xs uppercase tracking-wide w-48">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayedReceipts.map((r) => (
                      <TableRow key={r.id} className={`transition-colors border-b border-white/5 hover:bg-white/5 ${selectedIds.has(r.id) ? "bg-purple-500/5 hover:bg-purple-500/10" : ""}`}>
                        <TableCell><Checkbox checked={selectedIds.has(r.id)} onCheckedChange={() => toggleSelect(r.id)} className="border-white/20" /></TableCell>
                        <TableCell className="whitespace-nowrap text-white">{r.nama}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          {ocrProcessing.has(r.id) ? (
                            <span className="flex items-center gap-1 text-purple-400"><Loader2 className="w-3 h-3 animate-spin" />Membaca...</span>
                          ) : editingNominal === r.id ? (
                            <div className="flex items-center gap-1">
                              <input type="number" className="w-24 px-2 py-1 border rounded bg-[#1a1f35] text-white border-white/20 text-sm" value={editNominalValue} onChange={e => setEditNominalValue(e.target.value)} onKeyDown={e => { if (e.key === "Enter") saveNominal(r.id); if (e.key === "Escape") setEditingNominal(null); }} autoFocus />
                              <Button size="sm" variant="ghost" className="h-6 px-1 hover:bg-white/10" onClick={() => saveNominal(r.id)}><Check className="w-3 h-3 text-green-400" /></Button>
                              <Button size="sm" variant="ghost" className="h-6 px-1 hover:bg-white/10" onClick={() => setEditingNominal(null)}><X className="w-3 h-3 text-gray-400" /></Button>
                            </div>
                          ) : (
                            <button className="hover:underline cursor-pointer flex items-center gap-1 text-white" onClick={() => startEditNominal(r)}>
                              Rp {(r.nominal || 0).toLocaleString("id-ID")} <Pencil className="w-3 h-3 opacity-50" />
                            </button>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-white">{r.jam_transfer}</TableCell>
                        <TableCell className="whitespace-nowrap text-gray-300">{formatDate(r.created_at)}</TableCell>
        <TableCell className="max-w-[150px] truncate text-gray-300">
                          {getGroupName(r.keterangan, (r as any).receipt_wa_messages?.[0]?.group_name)}
                        </TableCell>
                        <TableCell>
                          <button onClick={async () => {
                            const url = await fetchImageUrl(r.id);
                            if (url) setPreviewImage(url);
                          }} className="block">
                            <img loading="lazy" src={getImageUrl(r.id)} alt="Resi" className="w-10 h-10 object-cover rounded border border-white/20 cursor-pointer hover:opacity-80 transition-opacity" />
                          </button>
                        </TableCell>
                        <TableCell><div className="flex flex-row items-center gap-1.5">{getStatusBadge(r.status)}{getOcrBadge(r)}</div></TableCell>
                        <TableCell>
                          <div className="flex gap-1 items-center">
                            <Button size="sm" variant="outline" className="h-8 px-2 border-white/20 hover:bg-white/10 text-gray-300" onClick={() => handleReOcr(r)} disabled={ocrProcessing.has(r.id)} title="OCR Ulang">
                              {ocrProcessing.has(r.id) ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                            </Button>
                            {r.status === "Pending" && (
                              <>
                                <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white h-8 px-3 text-xs" onClick={() => updateStatus(r.id, "Approved")}>
                                  <CheckCircle className="w-3 h-3 mr-1" />Approve
                                </Button>
                                <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white h-8 px-3 text-xs" onClick={() => updateStatus(r.id, "Rejected")}>
                                  <XCircle className="w-3 h-3 mr-1" />Reject
                                </Button>
                              </>
                            )}
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button size="sm" variant="outline" className="h-8 px-2 border-red-500/30 text-red-400 hover:bg-red-500/10"><Trash2 className="w-3 h-3" /></Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle className="text-white">Hapus Resi?</AlertDialogTitle>
                                  <AlertDialogDescription className="text-gray-400">Resi dari <strong className="text-white">{r.nama}</strong> sebesar {formatCurrency(r.nominal)} akan dihapus permanen.</AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel className="bg-transparent border-white/20 text-gray-300 hover:bg-white/10">Batal</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => deleteReceipt(r.id)} className="bg-red-600 text-white hover:bg-red-700">Hapus</AlertDialogAction>
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
                   <div className="text-center py-4 border-t border-white/5 bg-[#0f1424]">
                     <Button variant="outline" size="sm" className="text-xs border-white/20 text-gray-300 hover:bg-white/10 transition-colors" onClick={() => setVisibleCount(c => c + 50)}>
                       Tampilkan 50 lagi ({sortedReceipts.length - visibleCount} sisa)
                     </Button>
                   </div>
                 )}
              </div>
              </div>
              </>
            )}
          </CardContent>
        </Card>
      </main>
      </div>

      {/* Floating Selection Bar — muncul hanya saat ada resi dipilih */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 animate-in fade-in slide-in-from-bottom-3 duration-200">
          <div className="flex items-center gap-3 rounded-2xl bg-[#0f1424]/95 border border-purple-500/20 shadow-[0_0_30px_rgba(168,85,247,0.15),0_8px_32px_rgba(0,0,0,0.6)] px-4 py-2.5 backdrop-blur-md">
            {/* Badge count */}
            <div className="flex items-center gap-1.5 pr-3 border-r border-white/10">
              <div className="w-5 h-5 rounded-full bg-purple-500/20 flex items-center justify-center">
                <span className="text-[10px] font-bold text-purple-400">{selectedIds.size}</span>
              </div>
              <span className="text-xs font-medium text-gray-300">dipilih</span>
            </div>
            {/* OCR Button */}
            <Button
              size="sm"
              variant="ghost"
              className="h-8 px-3 text-xs text-gray-300 hover:text-white hover:bg-white/10 rounded-xl gap-1.5 transition-all"
              onClick={handleOcrSelected}
              disabled={ocrAllRunning}
            >
              {ocrAllRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-400" /> : <RotateCcw className="w-3.5 h-3.5 text-purple-400" />}
              <span className="hidden sm:inline">OCR Pilihan</span>
            </Button>
            {/* Divider */}
            <div className="w-px h-5 bg-white/10" />
            {/* Delete Button */}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 px-3 text-xs text-red-400 hover:text-white hover:bg-red-500/20 rounded-xl gap-1.5 transition-all"
                  disabled={bulkDeleting}
                >
                  {bulkDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  <span className="hidden sm:inline">Hapus</span>
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle className="text-white">Hapus {selectedIds.size} Resi?</AlertDialogTitle>
                  <AlertDialogDescription className="text-gray-400">Semua resi yang dipilih akan dihapus permanen.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="bg-transparent border-white/20 text-gray-300 hover:bg-white/10">Batal</AlertDialogCancel>
                  <AlertDialogAction onClick={bulkDelete} className="bg-red-600 text-white hover:bg-red-700">Hapus Semua</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      )}


      {/* Image Preview Modal */}
      <Dialog open={!!previewImage} onOpenChange={(open) => { if (!open) setPreviewImage(null); }}>
        <DialogContent className="max-w-[95vw] sm:max-w-2xl p-0 overflow-hidden [&>button]:hidden bg-transparent border-none shadow-none">
          <DialogTitle className="sr-only">Preview Resi</DialogTitle>
          <div className="relative bg-[#1a1f35] rounded-lg border-2 border-white/10 shadow-xl overflow-hidden">
            <button onClick={() => setPreviewImage(null)} className="absolute right-2 top-2 z-50 rounded-full bg-white/90 text-[#0a0e1a] p-2 shadow-lg hover:bg-white transition-colors" aria-label="Close">
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
