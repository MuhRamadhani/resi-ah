import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import ThemeToggle from "@/components/ThemeToggle";
import AdminSidebar from "@/components/AdminSidebar";

type Row = {
  id: string;
  nominal: number;
  transaction_time: string;
  transaction_date: string;
  kode_transaksi: string | null;
  status_match: string;
  ocr_confidence: number | null;
  created_at: string;
};

const RiwayatTransaksi = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("transactions" as any)
      .select("*")
      .eq("transaction_date", date)
      .order("transaction_time", { ascending: false })
      .limit(1000);
    if (error) {
      toast({ title: "Gagal muat", description: error.message, variant: "destructive" });
    }
    setRows((data as any) || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
     
  }, [date]);

  const statusColor = (s: string) => {
    if (s === "matched") return "default";
    if (s === "review") return "secondary";
    return "outline";
  };

  return (
    <div className="min-h-screen bg-[#0a0e1a] flex overflow-x-hidden">
      <AdminSidebar />

      {/* Main Content */}
      <div className="flex-1 min-w-0 lg:ml-56">
        <header className="bg-[#0f1424] border-b border-white/5 sticky top-0 z-10">
          <div className="px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" className="lg:hidden text-gray-400 hover:text-white hover:bg-white/10" onClick={() => navigate("/admin/dashboard")}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div>
                <h1 className="text-xl font-bold text-white">Riwayat Transaksi</h1>
                <p className="text-sm text-gray-400 mt-0.5">Data transaksi hasil Auto Match OCR</p>
              </div>
            </div>
            <div className="lg:hidden">
              <ThemeToggle />
            </div>
          </div>
        </header>

        <main className="px-6 py-6 max-w-6xl mx-auto space-y-5">
          <Card className="bg-[#0f1424] border-2 border-purple-500/30 shadow-[0_0_15px_rgba(168,85,247,0.15)]">
            <CardHeader className="border-b border-white/5">
              <CardTitle className="text-base text-white">Filter & Statistik</CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="flex flex-wrap gap-3 items-end">
                <div className="flex-1 min-w-[200px]">
                  <label className="text-sm block mb-2 text-gray-400 font-medium">Tanggal</label>
                  <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="bg-[#1a1f35] border-white/10 text-white focus:border-purple-500/50" />
                </div>
                <Button variant="outline" onClick={load} className="bg-[#1a1f35] border-white/10 text-gray-300 hover:bg-white/10">
                  <Loader2 className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
              </div>
              <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-[#1a1f35] p-3 rounded-lg border border-white/10">
                  <p className="text-2xl font-bold text-white">{rows.length}</p>
                  <p className="text-xs text-gray-400 mt-1">Total</p>
                </div>
                <div className="bg-[#1a1f35] p-3 rounded-lg border border-green-500/30">
                  <p className="text-2xl font-bold text-green-400">{rows.filter((r) => r.status_match === "matched").length}</p>
                  <p className="text-xs text-gray-400 mt-1">Matched</p>
                </div>
                <div className="bg-[#1a1f35] p-3 rounded-lg border border-orange-500/30">
                  <p className="text-2xl font-bold text-orange-400">{rows.filter((r) => r.status_match === "review").length}</p>
                  <p className="text-xs text-gray-400 mt-1">Review</p>
                </div>
                <div className="bg-[#1a1f35] p-3 rounded-lg border border-red-500/30">
                  <p className="text-2xl font-bold text-red-400">{rows.filter((r) => r.status_match === "unmatched").length}</p>
                  <p className="text-xs text-gray-400 mt-1">Unmatched</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-[#0f1424] border-white/5">
            <CardContent className="p-0 overflow-x-auto">
              {loading ? (
                <div className="p-8 text-center"><Loader2 className="w-6 h-6 mx-auto animate-spin text-purple-400" /></div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-[#1a1f35] hover:bg-[#1a1f35] border-b border-white/5">
                      <TableHead className="text-gray-300">Jam</TableHead>
                      <TableHead className="text-gray-300">Nominal</TableHead>
                      <TableHead className="text-gray-300">Kode</TableHead>
                      <TableHead className="text-gray-300">Status</TableHead>
                      <TableHead className="text-gray-300">OCR Conf</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.id} className="border-b border-white/5 hover:bg-white/5">
                        <TableCell className="text-white">{r.transaction_time?.slice(0, 5)}</TableCell>
                        <TableCell className="text-white">Rp {Number(r.nominal).toLocaleString("id-ID")}</TableCell>
                        <TableCell className="font-mono text-xs text-gray-300">{r.kode_transaksi || "-"}</TableCell>
                        <TableCell>
                          <Badge className={
                            r.status_match === "matched" ? "bg-green-500/10 text-green-400 border-green-500/30" :
                            r.status_match === "review" ? "bg-orange-500/10 text-orange-400 border-orange-500/30" :
                            "bg-red-500/10 text-red-400 border-red-500/30"
                          }>
                            {r.status_match}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-gray-300">{r.ocr_confidence ?? "-"}</TableCell>
                      </TableRow>
                    ))}
                    {rows.length === 0 && (
                      <TableRow><TableCell colSpan={5} className="text-center text-gray-400 py-8">Belum ada transaksi.</TableCell></TableRow>
                    )}
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

export default RiwayatTransaksi;
