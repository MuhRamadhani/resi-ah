import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Loader2, PlayCircle, CheckCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

const AutoMatching = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
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
    <div className="min-h-screen bg-background p-4 sm:p-6">
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => navigate("/admin/dashboard")}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Kembali
          </Button>
          <h1 className="text-xl font-bold">Auto Matching</h1>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Jalankan</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-end gap-2">
              <div>
                <label className="text-sm block mb-1">Tanggal</label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <Button onClick={runPreview} disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <PlayCircle className="w-4 h-4 mr-1" />}
                Preview Matching
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Auto-approve hanya jika confidence 100% (nominal identik & jam persis, kandidat tunggal). 95–99% masuk Review Manual.
            </p>
          </CardContent>
        </Card>

        {preview && (
          <Card>
            <CardHeader><CardTitle className="text-base">Hasil Preview</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Stat label="Total TX" value={preview.summary.total} />
                <Stat label="Auto Approve" value={preview.summary.auto_approve} />
                <Stat label="Review Manual" value={preview.summary.review} />
                <Stat label="Unmatched" value={preview.summary.unmatched} />
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button disabled={preview.summary.auto_approve === 0 || applying}>
                    {applying ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <CheckCircle className="w-4 h-4 mr-1" />}
                    Terapkan (Auto Approve {preview.summary.auto_approve})
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Terapkan auto-approve?</AlertDialogTitle>
                    <AlertDialogDescription>
                      {preview.summary.auto_approve} resi akan langsung di-approve dan dikirim notifikasi WhatsApp.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Batal</AlertDialogCancel>
                    <AlertDialogAction onClick={runApply}>Terapkan</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

const Stat = ({ label, value }: { label: string; value: number }) => (
  <div className="rounded border p-3 bg-card">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="text-2xl font-bold">{value}</p>
  </div>
);

export default AutoMatching;
