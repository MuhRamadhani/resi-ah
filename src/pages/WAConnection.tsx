import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Menu, Wifi, WifiOff, RefreshCw, QrCode, Loader2, LogOut, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import AdminSidebar from "@/components/AdminSidebar";

type ConnectionState = "open" | "close" | "connecting" | "unknown";

interface StateResponse {
  instance?: { state?: string };
  state?: string;
  [key: string]: any;
}

interface ConnectResponse {
  base64?: string;   // QR code image
  code?: string;     // pairing code
  pairingCode?: string;
  count?: number;
  [key: string]: any;
}

const WAConnection = () => {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [state, setState] = useState<ConnectionState>("unknown");
  const [stateRaw, setStateRaw] = useState<string>("");
  const [loadingState, setLoadingState] = useState(false);
  const [loadingConnect, setLoadingConnect] = useState(false);
  const [qrBase64, setQrBase64] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const parseState = (raw: string): ConnectionState => {
    const s = (raw || "").toLowerCase();
    if (s === "open")       return "open";
    if (s === "close")      return "close";
    if (s === "connecting") return "connecting";
    return "unknown";
  };

  const checkState = useCallback(async () => {
    setLoadingState(true);
    try {
      const res = await supabase.functions.invoke("wa-instance", {
        body: { _action: "state" },
      });
      if (res.error) throw res.error;
      const d: StateResponse = res.data || {};
      const rawState = d?.instance?.state || d?.state || "";
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

  const handleConnect = async () => {
    setLoadingConnect(true);
    setQrBase64(null);
    setPairingCode(null);
    try {
      const res = await supabase.functions.invoke("wa-instance", {
        body: { _action: "connect" },
      });
      if (res.error) throw res.error;
      const d: ConnectResponse = res.data || {};
      if (d.base64) {
        // strip data URI prefix jika ada
        setQrBase64(d.base64.replace(/^data:image\/[^;]+;base64,/, ""));
        setAutoRefresh(true); // mulai auto-refresh state setelah QR muncul
      }
      if (d.pairingCode || d.code) {
        setPairingCode(d.pairingCode || d.code || null);
      }
      toast({ title: "QR Code siap", description: "Scan dengan WhatsApp untuk connect." });
      await checkState();
    } catch (e: any) {
      toast({ title: "Gagal connect", description: e?.message || "Error", variant: "destructive" });
    } finally {
      setLoadingConnect(false);
    }
  };

  // Auto-refresh state setiap 5 detik setelah QR muncul
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(async () => {
      const res = await supabase.functions.invoke("wa-instance", { body: { _action: "state" } });
      const d: StateResponse = res.data || {};
      const rawState = d?.instance?.state || d?.state || "";
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
    }, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, toast]);

  // Cek state saat halaman dibuka
  useEffect(() => { checkState(); }, [checkState]);

  const logout = async () => {
    await supabase.auth.signOut();
    navigate("/admin/login");
  };

  const stateConfig = {
    open:       { label: "Terhubung",    color: "text-green-400",  bg: "bg-green-500/10",  border: "border-green-500/20",  icon: CheckCircle2 },
    close:      { label: "Terputus",     color: "text-red-400",    bg: "bg-red-500/10",    border: "border-red-500/20",    icon: XCircle },
    connecting: { label: "Menghubungkan",color: "text-yellow-400", bg: "bg-yellow-500/10", border: "border-yellow-500/20", icon: Loader2 },
    unknown:    { label: "Tidak Diketahui", color: "text-gray-400",bg: "bg-white/5",       border: "border-white/10",      icon: AlertTriangle },
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
          <span className="text-sm font-semibold text-white">WhatsApp Connection</span>
          <Button variant="ghost" size="sm" className="text-gray-400 hover:text-red-400" onClick={logout}>
            <LogOut className="w-4 h-4" />
          </Button>
        </header>

        <main className="flex-1 p-4 md:p-6 space-y-6 max-w-2xl mx-auto w-full">
          {/* Header */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-green-500/10 flex items-center justify-center">
              <Wifi className="w-5 h-5 text-green-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">WhatsApp Connection</h1>
              <p className="text-xs text-gray-400">Kelola koneksi Evolution API instance</p>
            </div>
          </div>

          {/* Status Card */}
          <Card className="bg-[#0f1424] border-white/5">
            <CardHeader className="p-4 pb-3 border-b border-white/5">
              <CardTitle className="text-sm font-semibold text-white flex items-center gap-2">
                <WifiOff className="w-4 h-4 text-gray-400" />
                Status Koneksi
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-4">
              {/* State badge */}
              <div className={`flex items-center gap-3 rounded-xl border p-4 ${cfg.bg} ${cfg.border}`}>
                <StateIcon className={`w-6 h-6 shrink-0 ${cfg.color} ${state === "connecting" ? "animate-spin" : ""}`} />
                <div className="flex-1">
                  <p className={`font-semibold text-sm ${cfg.color}`}>{cfg.label}</p>
                  {stateRaw && <p className="text-xs text-gray-500 mt-0.5">state: <code className="text-gray-400">{stateRaw}</code></p>}
                  {lastChecked && (
                    <p className="text-xs text-gray-600 mt-0.5">
                      Dicek: {lastChecked.toLocaleTimeString("id-ID")}
                    </p>
                  )}
                </div>
                {/* Auto-refresh indicator */}
                {autoRefresh && (
                  <div className="flex items-center gap-1.5 text-xs text-yellow-400">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>Auto-cek...</span>
                  </div>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 h-9 text-xs border-white/20 text-gray-300 hover:bg-white/10 gap-1.5"
                  onClick={checkState}
                  disabled={loadingState}
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingState ? "animate-spin" : ""}`} />
                  Cek Status
                </Button>
                <Button
                  size="sm"
                  className="flex-1 h-9 text-xs bg-green-600 hover:bg-green-700 text-white gap-1.5"
                  onClick={handleConnect}
                  disabled={loadingConnect || state === "open"}
                >
                  {loadingConnect
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <QrCode className="w-3.5 h-3.5" />}
                  {state === "open" ? "Sudah Terhubung" : "Connect / QR Code"}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* QR Code Card */}
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
                    <img
                      src={`data:image/png;base64,${qrBase64}`}
                      alt="QR Code WhatsApp"
                      className="w-56 h-56 object-contain"
                    />
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

          {/* Info card */}
          <Card className="bg-[#0f1424] border-white/5">
            <CardContent className="p-4">
              <div className="space-y-2 text-xs text-gray-500">
                <p className="text-gray-400 font-medium text-sm mb-3">Info Instance</p>
                <div className="flex justify-between">
                  <span>Instance</span>
                  <code className="text-purple-400">AnggrekHitam</code>
                </div>
                <div className="flex justify-between">
                  <span>Server</span>
                  <code className="text-gray-400 text-[11px]">evolution-api-production-f0f2.up.railway.app</code>
                </div>
                <div className="flex justify-between">
                  <span>Auto-reconnect</span>
                  <span className={autoRefresh ? "text-yellow-400" : "text-gray-600"}>
                    {autoRefresh ? "Aktif (setiap 5 detik)" : "Tidak aktif"}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
};

export default WAConnection;
