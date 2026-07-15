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
    <div className="min-h-screen bg-background p-4 sm:p-6">
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => navigate("/admin/dashboard")}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Kembali
          </Button>
          <h1 className="text-xl font-bold">Riwayat Transaksi</h1>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Filter</CardTitle>
          </CardHeader>
          <CardContent className="flex gap-2 items-end">
            <div>
              <label className="text-sm block mb-1">Tanggal</label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <Button variant="outline" onClick={load}>Refresh</Button>
            <div className="ml-auto text-sm text-muted-foreground">
              Total: {rows.length} · Matched: {rows.filter((r) => r.status_match === "matched").length} · Review: {rows.filter((r) => r.status_match === "review").length} · Unmatched: {rows.filter((r) => r.status_match === "unmatched").length}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0 overflow-x-auto">
            {loading ? (
              <div className="p-6 text-center"><Loader2 className="w-5 h-5 mx-auto animate-spin" /></div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Jam</TableHead>
                    <TableHead>Nominal</TableHead>
                    <TableHead>Kode</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>OCR Conf</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{r.transaction_time?.slice(0, 5)}</TableCell>
                      <TableCell>Rp {Number(r.nominal).toLocaleString("id-ID")}</TableCell>
                      <TableCell className="font-mono text-xs">{r.kode_transaksi || "-"}</TableCell>
                      <TableCell><Badge variant={statusColor(r.status_match) as any}>{r.status_match}</Badge></TableCell>
                      <TableCell>{r.ocr_confidence ?? "-"}</TableCell>
                    </TableRow>
                  ))}
                  {rows.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">Belum ada transaksi.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default RiwayatTransaksi;
