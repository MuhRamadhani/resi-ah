import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Menu, Wifi, WifiOff, RefreshCw, QrCode, Loader2, LogOut,
  CheckCircle2, XCircle, AlertTriangle, RotateCcw, Plus,
  Trash2, Power, ServerCrash,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import AdminSidebar from "@/components/AdminSidebar";

type ConnectionState = "open" | "close" | "connecting" | "scan" | "unknown";

interface EvolutionInstance {
  instance: {
    instanceName: string;
    instanceId?: string;
    status?: string;
    state?: string;
  };
  [key: string]: any;
}

const WAConnection = () => {
  const navigate = useNavigate();
  const { toast } = useToast();

  // ── State utama instance aktif ──
  const [state, setState] = useState<ConnectionState>("unknown");
  const [stateRaw, setStateRaw] = useState<string>("");
  const [loadingState, setLoadingState] = useState(false);
  const [loadingConnect, setLoadingConnect] = useState(false);
  const [loadingRestart, setLoadingRestart] = useState(false);
  const [loadingLogout, setLoadingLogout] = useState(false);
  const [qrBase64, setQrBase64] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);

  // ── Daftar semua instance ──
  const [instances, setInstances] = useState<EvolutionInstance[]>([]);
  const [loadingInstances, setLoadingInstances] = useState(false);
  const [deletingInstance, setDeletingInstance] = useState<string | null>(null);

  // ── Form buat instance baru ──
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newNumber, setNewNumber] = useState("");

  // ── helpers ──
  // Edge Function sekarang selalu return 200 dengan { evolutionStatus, data }
  const invoke = (action: string, extra?: Record<string, unknown>) =>
    supabase.functions.invoke("wa-instance", { body: { _action: action, ...extra } });

  // Unwrap response dari Edge Function
  const unwrap = (res: { data: any; error: any }) => {
    if (res.error) throw new Error(res.error.message || "Invoke error");
    const evStatus = res.data?.evolutionStatus ?? 200;
    const data = res.data?.data ?? res.data;
    if (evStatus >= 400) {
      const msg = (data as any)?.message || (data as any)?.error || `Evolution error ${evStatus}`;
      throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
    }
    return data;
  };

  // Status WasenderAPI: connecting | connected | disconnected | need_scan
  //                     need_passkey | logged_out | expired
  const parseState = (raw: string): ConnectionState => {
    const s = (raw || "").toLowerCase();
    if (s === "open" || s === "connected") return "open";
    if (s === "close" || s === "disconnected" || s === "logged_out" || s === "expired") return "close";
    if (s === "connecting") return "connecting";
    if (s === "need_scan" || s === "need_passkey") return "scan";
    return "unknown";
  };

  // ── Cek state instance utama ──
  const checkState = useCallback(async () => {
    setLoadingState(true);
    try {
      const res = await invoke("state");
      const d = unwrap(res);
      const rawState =
        d?.instance?.state ||
        d?.connectionStatus?.state ||
        d?.state ||
        d?.instance?.connectionStatus?.state ||
        "";
      setStateRaw(rawState);
      setState(parseState(rawState));
      setLastChecked(new Date());
    } catch (e: any) {
      toast({ title: "Gagal cek status", description: e?.message || "Error", variant: "destructive" });
      setState("unknown");
    } finally {
      setLoadingState(false);
    }
  }, [toast]);

  // ── Fetch semua instance ──
  const fetchInstances = useCallback(async () => {
    setLoadingInstances(true);
    try {
      const res = await invoke("fetchInstances");
      const data = unwrap(res);

      let raw: any[] = [];
      if (Array.isArray(data)) {
        raw = data;
      } else if (data && Array.isArray(data.instances)) {
        raw = data.instances;
      } else if (data && typeof data === "object") {
        raw = [data];
      }

      const list: EvolutionInstance[] = raw.map((item: any) => {
        if (item?.instance && typeof item.instance === "object") {
          const inst = item.instance;
          return {
            instance: {
              instanceName: inst.name || inst.instanceName || "—",
              status: inst.connectionStatus || inst.status || inst.state || "unknown",
              state: inst.state || inst.connectionStatus || inst.status || "unknown",
            },
          } as EvolutionInstance;
        }
        // Format flat Evolution v2: { name, connectionStatus, ... }
        return {
          instance: {
            instanceName: item.name || item.instanceName || "—",
            status: item.connectionStatus || item.status || item.state || "unknown",
            state: item.state || item.connectionStatus || item.status || "unknown",
          },
        } as EvolutionInstance;
      });

      setInstances(list);
    } catch (e: any) {
      toast({ title: "Gagal fetch instances", description: e?.message || "Error", variant: "destructive" });
    } finally {
      setLoadingInstances(false);
    }
  }, [toast]);

  // ── Connect / QR ──
  const handleConnect = async () => {
    setLoadingConnect(true);
    setQrBase64(null);
    setPairingCode(null);
    try {
      const res = await invoke("connect");
      const d = unwrap(res);
      if (d.base64) {
        setQrBase64(d.base64.replace(/^data:image\/[^;]+;base64,/, ""));
        setAutoRefresh(true);
      }
      if (d.pairingCode || d.code) setPairingCode(d.pairingCode || d.code || null);
      toast({ title: "QR Code siap", description: "Scan dengan WhatsApp untuk connect." });
      await checkState();
    } catch (e: any) {
      toast({ title: "Gagal connect", description: e?.message || "Error", variant: "destructive" });
    } finally {
      setLoadingConnect(false);
    }
  };

  // ── Restart ──
  const handleRestart = async () => {
    setLoadingRestart(true);
    try {
      const res = await invoke("restart");
      unwrap(res);
      toast({ title: "✅ Instance Di-restart", description: "Tunggu beberapa detik..." });
      setTimeout(() => checkState(), 3000);
    } catch (e: any) {
      toast({ title: "Gagal restart", description: e?.message || "Error", variant: "destructive" });
    } finally {
      setLoadingRestart(false);
    }
  };

  // ── Logout instance utama ──
  const handleLogout = async () => {
    setLoadingLogout(true);
    try {
      const res = await invoke("logout");
      unwrap(res);
      toast({ title: "✅ Logout Berhasil", description: "Instance berhasil di-logout." });
      setQrBase64(null);
      setPairingCode(null);
      setAutoRefresh(false);
      await checkState();
      await fetchInstances();
    } catch (e: any) {
      toast({ title: "Gagal logout", description: e?.message || "Error", variant: "destructive" });
    } finally {
      setLoadingLogout(false);
    }
  };

  // ── Delete instance (by name) ──
  const handleDelete = async (instanceName: string) => {
    setDeletingInstance(instanceName);
    try {
      const res = await invoke("delete", { instanceName });
      unwrap(res);
      toast({ title: "✅ Instance Dihapus", description: `${instanceName} berhasil dihapus.` });
      await fetchInstances();
      await checkState();
    } catch (e: any) {
      toast({ title: "Gagal hapus", description: e?.message || "Error", variant: "destructive" });
    } finally {
      setDeletingInstance(null);
    }
  };

  // ── Create instance baru ──
  const handleCreate = async () => {
    if (!newName.trim()) {
      toast({ title: "Nama instance wajib diisi", variant: "destructive" });
      return;
    }
    setCreating(true);
    try {
      const res = await invoke("create", {
        payload: {
          instanceName: newName.trim(),
          qrcode: true,
          integration: "WHATSAPP-BAILEYS",
          ...(newNumber.trim() ? { number: newNumber.trim() } : {}),
        },
      });
      unwrap(res);
      toast({ title: "✅ Instance Dibuat", description: `${newName.trim()} berhasil dibuat.` });
      setNewName("");
      setNewNumber("");
      setShowCreate(false);
      await fetchInstances();
    } catch (e: any) {
      toast({ title: "Gagal buat instance", description: e?.message || "Error", variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  // ── Auto-refresh state setelah QR muncul ──
  // Interval 8s (dari 5s) + cap 5 menit. Sebelumnya polling jalan terus
  // selamanya selama tab dibuka — 720 invoke/jam, tiap invoke = baris log.
  // Scan QR tidak butuh presisi 5 detik.
  useEffect(() => {
    if (!autoRefresh) return;
    let ticks = 0;
    const MAX_TICKS = 38; // ~5 menit pada interval 8s
    const interval = setInterval(async () => {
      if (++ticks > MAX_TICKS) {
        setAutoRefresh(false);
        toast({
          title: "Auto-refresh dihentikan",
          description: "Sudah 5 menit tidak terhubung. Klik Cek Status untuk lanjut.",
        });
        return;
      }
      const res = await invoke("state");
      const d = unwrap(res);
      const rawState =
        d?.instance?.state ||
        d?.connectionStatus?.state ||
        d?.state ||
        d?.instance?.connectionStatus?.state ||
        "";
      const parsed = parseState(rawState);
      setStateRaw(rawState);
      setState(parsed);
      setLastChecked(new Date());
      if (parsed === "open") {
        setAutoRefresh(false);
        setQrBase64(null);
        setPairingCode(null);
        toast({ title: "✅ WhatsApp Terhubung!", description: "Instance berhasil connect." });
      }
    }, 8000);
    return () => clearInterval(interval);
  }, [autoRefresh, toast]);

  // ── Mount ──
  useEffect(() => {
    checkState();
    fetchInstances();
  }, [checkState, fetchInstances]);

  const logout = async () => {
    await supabase.auth.signOut();
    navigate("/admin/login");
  };

  const stateConfig = {
    open:       { label: "Terhubung",       color: "text-green-400",  bg: "bg-green-500/10",  border: "border-green-500/20",  icon: CheckCircle2 },
    close:      { label: "Terputus",        color: "text-red-400",    bg: "bg-red-500/10",    border: "border-red-500/20",    icon: XCircle },
    connecting: { label: "Menghubungkan",   color: "text-yellow-400", bg: "bg-yellow-500/10", border: "border-yellow-500/20", icon: Loader2 },
    scan:       { label: "Menunggu Scan QR", color: "text-blue-400",  bg: "bg-blue-500/10",   border: "border-blue-500/20",   icon: QrCode },
    unknown:    { label: "Tidak Diketahui", color: "text-gray-400",   bg: "bg-white/5",       border: "border-white/10",      icon: AlertTriangle },
  };

  const cfg = stateConfig[state];
  const StateIcon = cfg.icon;

  return (
    <div className="min-h-screen bg-[#0a0e1a] flex">
      <AdminSidebar variant="desktop" />

      <div className="flex-1 lg:ml-56 flex flex-col min-h-screen">
        {/* Mobile header */}
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
          <span className="text-sm font-semibold text-white">WA Connection</span>
          <Button variant="ghost" size="sm" className="text-gray-400 hover:text-red-400" onClick={logout}>
            <LogOut className="w-4 h-4" />
          </Button>
        </header>

        <main className="flex-1 p-4 md:p-6 space-y-5 max-w-2xl mx-auto w-full">
          {/* Header */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-green-500/10 flex items-center justify-center">
              <Wifi className="w-5 h-5 text-green-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">WhatsApp Instance Manager</h1>
              <p className="text-xs text-gray-400">Kelola koneksi Evolution API</p>
            </div>
          </div>

          {/* ── Status instance utama ── */}
          <Card className="bg-[#0f1424] border-white/5">
            <CardHeader className="p-4 pb-3 border-b border-white/5">
              <CardTitle className="text-sm font-semibold text-white flex items-center gap-2">
                <WifiOff className="w-4 h-4 text-gray-400" />
                Instance Aktif
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-3">
              {/* State badge */}
              <div className={`flex items-center gap-3 rounded-xl border p-3 ${cfg.bg} ${cfg.border}`}>
                <StateIcon className={`w-5 h-5 shrink-0 ${cfg.color} ${state === "connecting" ? "animate-spin" : ""}`} />
                <div className="flex-1 min-w-0">
                  <p className={`font-semibold text-sm ${cfg.color}`}>{cfg.label}</p>
                  {stateRaw && <p className="text-xs text-gray-500 mt-0.5">state: <code className="text-gray-400">{stateRaw}</code></p>}
                  {lastChecked && <p className="text-xs text-gray-600 mt-0.5">Dicek: {lastChecked.toLocaleTimeString("id-ID")}</p>}
                </div>
                {autoRefresh && (
                  <div className="flex items-center gap-1.5 text-xs text-yellow-400 shrink-0">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>Auto-cek...</span>
                  </div>
                )}
              </div>

              {/* Action buttons — row 1 */}
              <div className="flex gap-2">
                <Button
                  variant="outline" size="sm"
                  className="flex-1 h-9 text-xs border-white/20 text-gray-300 hover:bg-white/10 gap-1.5"
                  onClick={checkState} disabled={loadingState}
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingState ? "animate-spin" : ""}`} />
                  Cek Status
                </Button>
                <Button
                  variant="outline" size="sm"
                  className="flex-1 h-9 text-xs border-orange-500/30 text-orange-400 hover:bg-orange-500/10 gap-1.5"
                  onClick={handleRestart} disabled={loadingRestart}
                >
                  {loadingRestart ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                  Restart
                </Button>
                <Button
                  size="sm"
                  className="flex-1 h-9 text-xs bg-green-600 hover:bg-green-700 text-white gap-1.5"
                  onClick={handleConnect} disabled={loadingConnect || state === "open"}
                >
                  {loadingConnect ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <QrCode className="w-3.5 h-3.5" />}
                  {state === "open" ? "Terhubung" : "Connect / QR"}
                </Button>
              </div>

              {/* Action buttons — row 2: Logout */}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline" size="sm"
                    className="w-full h-9 text-xs border-red-500/30 text-red-400 hover:bg-red-500/10 gap-1.5"
                    disabled={loadingLogout}
                  >
                    {loadingLogout ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Power className="w-3.5 h-3.5" />}
                    Logout Instance Aktif
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="bg-[#0f1424] border-white/10">
                  <AlertDialogHeader>
                    <AlertDialogTitle className="text-white">Logout Instance?</AlertDialogTitle>
                    <AlertDialogDescription className="text-gray-400">
                      Instance akan di-logout dari WhatsApp. Kamu perlu scan QR lagi untuk reconnect.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="border-white/10 text-gray-300 hover:bg-white/5">Batal</AlertDialogCancel>
                    <AlertDialogAction onClick={handleLogout} className="bg-red-600 hover:bg-red-700 text-white">
                      Ya, Logout
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardContent>
          </Card>

          {/* ── QR Code ── */}
          {(qrBase64 || pairingCode) && (
            <Card className="bg-[#0f1424] border-green-500/20 shadow-[0_0_30px_rgba(34,197,94,0.08)]">
              <CardHeader className="p-4 pb-3 border-b border-white/5">
                <CardTitle className="text-sm font-semibold text-white flex items-center gap-2">
                  <QrCode className="w-4 h-4 text-green-400" />
                  Scan QR Code
                  <span className="ml-auto text-xs font-normal text-yellow-400 flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Menunggu scan...
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6 flex flex-col items-center gap-4">
                {qrBase64 && (
                  <div className="p-3 bg-white rounded-2xl shadow-lg">
                    <img src={`data:image/png;base64,${qrBase64}`} alt="QR Code WhatsApp" className="w-56 h-56 object-contain" />
                  </div>
                )}
                {pairingCode && (
                  <div className="text-center">
                    <p className="text-xs text-gray-500 mb-1">Atau gunakan pairing code:</p>
                    <code className="text-2xl font-bold tracking-widest text-green-400 bg-green-500/10 px-4 py-2 rounded-lg block">
                      {pairingCode}
                    </code>
                  </div>
                )}
                <p className="text-xs text-gray-500 text-center">
                  Buka WhatsApp → Perangkat Tertaut → Tautkan Perangkat → Scan QR
                </p>
              </CardContent>
            </Card>
          )}

          {/* ── Semua Instance ── */}
          <Card className="bg-[#0f1424] border-white/5">
            <CardHeader className="p-4 pb-3 border-b border-white/5">
              <CardTitle className="text-sm font-semibold text-white flex items-center gap-2">
                <ServerCrash className="w-4 h-4 text-purple-400" />
                Semua Instance
                <button
                  onClick={fetchInstances}
                  className="ml-auto text-gray-500 hover:text-gray-300 transition-colors"
                  disabled={loadingInstances}
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingInstances ? "animate-spin" : ""}`} />
                </button>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {loadingInstances ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                </div>
              ) : instances.length === 0 ? (
                <p className="text-xs text-gray-500 text-center py-8">Tidak ada instance ditemukan</p>
              ) : (
                <div className="divide-y divide-white/5">
                  {instances.map((inst) => {
                    const name = inst.instance?.instanceName || "—";
                    const status = (inst.instance?.state || inst.instance?.status || "unknown").toLowerCase();
                    const isOpen = parseState(status) === "open";
                    const isDeleting = deletingInstance === name;
                    return (
                      <div key={name} className="flex items-center gap-3 px-4 py-3">
                        <div className={`w-2 h-2 rounded-full shrink-0 ${isOpen ? "bg-green-400" : "bg-gray-600"}`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-white truncate">{name}</p>
                          <p className={`text-xs ${isOpen ? "text-green-400" : "text-gray-500"}`}>{status}</p>
                        </div>
                        {/* Delete button */}
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost" size="sm"
                              className="h-7 w-7 p-0 text-gray-600 hover:text-red-400 hover:bg-red-500/10"
                              disabled={isDeleting}
                            >
                              {isDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent className="bg-[#0f1424] border-white/10">
                            <AlertDialogHeader>
                              <AlertDialogTitle className="text-white">Hapus Instance?</AlertDialogTitle>
                              <AlertDialogDescription className="text-gray-400">
                                Instance <span className="text-white font-medium">{name}</span> akan dihapus permanen dari Evolution API.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel className="border-white/10 text-gray-300 hover:bg-white/5">Batal</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDelete(name)} className="bg-red-600 hover:bg-red-700 text-white">
                                Ya, Hapus
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Tombol buat instance baru */}
              <div className="p-4 border-t border-white/5">
                {!showCreate ? (
                  <Button
                    variant="outline" size="sm"
                    className="w-full h-9 text-xs border-purple-500/30 text-purple-400 hover:bg-purple-500/10 gap-1.5"
                    onClick={() => setShowCreate(true)}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Buat Instance Baru
                  </Button>
                ) : (
                  <div className="space-y-3">
                    <p className="text-xs font-semibold text-white">Buat Instance Baru</p>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-gray-400">Nama Instance <span className="text-red-400">*</span></Label>
                      <Input
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder="contoh: AnggrekHitam2"
                        className="h-8 text-xs bg-[#1a1f35] border-white/10 text-white"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-gray-400">Nomor WA (opsional)</Label>
                      <Input
                        value={newNumber}
                        onChange={(e) => setNewNumber(e.target.value)}
                        placeholder="628xxx (tanpa +)"
                        className="h-8 text-xs bg-[#1a1f35] border-white/10 text-white"
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline" size="sm"
                        className="flex-1 h-8 text-xs border-white/10 text-gray-400 hover:bg-white/5"
                        onClick={() => { setShowCreate(false); setNewName(""); setNewNumber(""); }}
                      >
                        Batal
                      </Button>
                      <Button
                        size="sm"
                        className="flex-1 h-8 text-xs bg-purple-600 hover:bg-purple-700 text-white gap-1.5"
                        onClick={handleCreate} disabled={creating || !newName.trim()}
                      >
                        {creating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                        Buat
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
};

export default WAConnection;
