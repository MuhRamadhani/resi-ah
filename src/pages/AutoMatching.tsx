import { useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Loader2, PlayCircle, CheckCircle, AlertTriangle, Info, Menu } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import ThemeToggle from "@/components/ThemeToggle";
import AdminSidebar from "@/components/AdminSidebar";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

const AutoMatching = () => {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<any>(null);
  const [applying, setApplying] = useState(false);

  async function runPreview() {
    setLoading(true);
    setPreview(null);
    try {
      const { data, error } = await supabase.functions.invoke("auto-match", {
        body: { mode: "preview", transaction_date: date },
      });
      if (error) throw error;
      setPreview(data);
    } catch (e: any) {
      toast({ title: "Gagal", description: e?.message || "Error", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function runApply() {
    setApplying(true);
    try {
      const { data, error } = await supabase.functions.invoke("auto-match", {
        body: { mode: "apply", transaction_date: date },
      });
      if (error) throw error;
      toast({ title: "Selesai", description: `Auto-approved: ${data?.applied?.auto_approved ?? 0}, Review: ${data?.applied?.review ?? 0}` });
      setPreview(null);
    } catch (e: any) {
      toast({ title: "Gagal", description: e?.message || "Error", variant: "destructive" });
    } finally {
      setApplying(false);
    }
  }

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
              <h1 className="text-sm md:text-xl font-bold text-white truncate">Auto Matching</h1>
              <p className="text-[11px] md:text-sm text-gray-400 mt-0.5 truncate">Match otomatis transaksi dengan resi</p>
            </div>

            <div className="lg:hidden shrink-0">
              <ThemeToggle />
            </div>
          </div>
        </header>

        <main className="px-4 py-4 md:px-6 md:py-6 max-w-5xl mx-auto space-y-4 md:space-y-5">
          <Card className="bg-[#0f1424] border-2 border-purple-500/30 shadow-[0_0_15px_rgba(168,85,247,0.15)]">
            <CardHeader className="p-4 border-b border-white/5">
              <CardTitle className="text-sm md:text-base text-white">Jalankan</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-4 space-y-4">
              <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-3">
                <div className="flex-1 sm:min-w-[200px]">
                  <label className="text-xs md:text-sm block mb-2 text-gray-400 font-medium">Tanggal</label>
                  <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="bg-[#1a1f35] border-white/10 text-white focus:border-purple-500/50 h-10 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:opacity-70 [&::-webkit-calendar-picker-indicator]:cursor-pointer" />
                </div>
                <Button onClick={runPreview} disabled={loading} className="w-full sm:w-auto h-10 bg-purple-600 hover:bg-purple-700 text-white text-sm">
                  {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <PlayCircle className="w-4 h-4 mr-2" />}
                  Preview Matching
                </Button>
              </div>
              <p className="text-xs text-gray-400 bg-[#1a1f35] p-3 rounded-lg border border-white/10">
                Auto-approve jika nominal sama dan menit sama persis. Jam boleh sama, +1, atau -1 untuk beda WIB/WITA.
              </p>
            </CardContent>
          </Card>

          {preview && (
            <Card className="bg-[#0f1424] border-white/5">
              <CardHeader className="p-4 border-b border-white/5">
                <CardTitle className="text-sm md:text-base text-white">Hasil Preview</CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-4 space-y-4">
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 md:gap-3">
                  <Stat label="Total TX" value={preview.summary.total} />
                  <Stat label="Resi Pending" value={preview.summary.pending_receipts ?? preview.debug?.pending_receipts ?? 0} />
                  <Stat label="Auto Approve" value={preview.summary.auto_approve} color="green" />
                  <Stat label="Review Manual" value={preview.summary.review} color="orange" />
                  <Stat label="Unmatched" value={preview.summary.unmatched} color="red" />
                </div>

                {preview.debug && (
                  <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-4 text-sm text-gray-300 space-y-2">
                    <div className="flex items-start gap-2 text-blue-400">
                      <Info className="h-4 w-4 mt-0.5 shrink-0" />
                      <p className="font-medium">Aturan: {preview.debug.rule}</p>
                    </div>
                    <p>Jam transaksi valid: {preview.debug.valid_transaction_times} / {preview.debug.transactions_checked}</p>
                    <p>Jam resi valid: {preview.debug.valid_receipt_times} / {preview.debug.pending_receipts}</p>
                  </div>
                )}

                {preview.summary.auto_approve > 0 && (
                  <PreviewList
                    title="Akan Auto Approve"
                    icon={<CheckCircle className="h-4 w-4 text-green-400" />}
                    items={preview.auto_approve}
                    render={(item: any) => (
                      <>
                        <span className="font-medium text-white">{formatCurrency(item.nominal)}</span>
                        <span className="text-gray-300">TX {item.tx_time} → Resi {item.receipt_time}</span>
                        <span className="text-gray-400 text-xs">{item.reason}</span>
                      </>
                    )}
                  />
                )}

                {preview.summary.review > 0 && (
                  <PreviewList
                    title="Perlu Review Manual"
                    icon={<AlertTriangle className="h-4 w-4 text-orange-400" />}
                    items={preview.review}
                    render={(item: any) => (
                      <>
                        <span className="font-medium text-white">{formatCurrency(item.nominal)}</span>
                        <span className="text-gray-300">TX {item.tx_time}</span>
                        <span className="text-gray-400 text-xs">{item.reason}</span>
                      </>
                    )}
                  />
                )}

                {preview.summary.unmatched > 0 && (
                  <PreviewList
                    title="Tidak Match"
                    icon={<AlertTriangle className="h-4 w-4 text-red-400" />}
                    items={preview.unmatched}
                    render={(item: any) => (
                      <>
                        <span className="font-medium text-white">{formatCurrency(item.nominal)}</span>
                        <span className="text-gray-300">TX {item.tx_time}</span>
                        <span className="text-gray-400 text-xs">{item.reason}</span>
                      </>
                    )}
                  />
                )}

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button disabled={preview.summary.auto_approve === 0 || applying} className="w-full sm:w-auto h-10 bg-green-600 hover:bg-green-700 text-white text-sm">
                      {applying ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle className="w-4 h-4 mr-2" />}
                      Terapkan (Auto Approve {preview.summary.auto_approve})
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="bg-[#1a1f35] border-white/10">
                    <AlertDialogHeader>
                      <AlertDialogTitle className="text-white">Terapkan auto-approve?</AlertDialogTitle>
                      <AlertDialogDescription className="text-gray-400">
                        {preview.summary.auto_approve} resi akan langsung di-approve dan dikirim notifikasi WhatsApp.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel className="bg-transparent border-white/20 text-gray-300 hover:bg-white/10">Batal</AlertDialogCancel>
                      <AlertDialogAction onClick={runApply} className="bg-green-600 text-white hover:bg-green-700">Terapkan</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </CardContent>
            </Card>
          )}
        </main>
      </div>
    </div>
  );
};

const Stat = ({ label, value, color }: { label: string; value: number; color?: "green" | "orange" | "red" }) => {
  const colorClass = color === "green" ? "border-green-500/30 bg-green-500/5" :
                     color === "orange" ? "border-orange-500/30 bg-orange-500/5" :
                     color === "red" ? "border-red-500/30 bg-red-500/5" :
                     "border-white/10 bg-[#1a1f35]";
  const textColor = color === "green" ? "text-green-400" :
                    color === "orange" ? "text-orange-400" :
                    color === "red" ? "text-red-400" :
                    "text-white";
  
  return (
    <div className={`rounded-lg border p-2.5 md:p-4 ${colorClass}`}>
      <p className="text-[10px] md:text-xs text-gray-400 mb-0.5 md:mb-1 leading-tight">{label}</p>
      <p className={`text-xl md:text-3xl font-bold ${textColor}`}>{value}</p>
    </div>
  );
};

const formatCurrency = (value: number) => `Rp ${Number(value || 0).toLocaleString("id-ID")}`;

const PreviewList = ({
  title,
  icon,
  items,
  render,
}: {
  title: string;
  icon?: ReactNode;
  items: any[];
  render: (item: any) => ReactNode;
}) => (
  <div className="rounded-lg border border-white/10 bg-[#1a1f35] overflow-hidden">
    <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3 text-sm font-medium bg-[#0f1424]">
      {icon}
      <span className="text-white">{title}</span>
      <span className="text-gray-400">({items.length})</span>
    </div>
    <div className="divide-y divide-white/5 max-h-96 overflow-y-auto">
      {items.slice(0, 30).map((item, index) => (
        <div key={`${item.transaction_id || index}-${index}`} className="grid gap-2 px-4 py-3 text-sm sm:grid-cols-[120px_180px_1fr] hover:bg-white/5 transition-colors">
          {render(item)}
        </div>
      ))}
      {items.length > 30 && (
        <div className="px-4 py-3 text-xs text-gray-400 bg-[#0f1424]">
          Menampilkan 30 data pertama dari {items.length} hasil.
        </div>
      )}
    </div>
  </div>
);

export default AutoMatching;
