import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Upload, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { extractFrames } from "@/lib/video-ocr/frameExtractor";
import { ocrCanvas, terminateWorkers } from "@/lib/video-ocr/merchantOcr";
import { parseMutationsFromLines, dedupMutations, shiftTimeHours, type ParsedMutation } from "@/lib/video-ocr/mutationParser";

const TransaksiUpload = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [transactionDate, setTransactionDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState("");
  const [results, setResults] = useState<ParsedMutation[]>([]);
  const [ingestSummary, setIngestSummary] = useState<any>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Default crop: skip top 30% (header, tabs, search) and bottom 12% (date filter overlay)
  const [cropTop, setCropTop] = useState(30);
  const [cropBottom, setCropBottom] = useState(12);
  // Video source timezone. WITA (+8) needs -1h shift to match resi (WIB).
  const [videoTz, setVideoTz] = useState<"WIB" | "WITA">("WIB");

  async function onProcess() {
    if (!file) return;
    setProcessing(true);
    setProgress(0);
    setResults([]);
    setIngestSummary(null);
    const start = Date.now();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      setPhase("Ekstrak frame dari video...");
      const { frames, duration, totalConsidered } = await extractFrames(file, {
        fps: 1,
        maxFps: 2,
        crop: { top: cropTop / 100, bottom: cropBottom / 100, left: 0, right: 0 },
        signal: ctrl.signal,
        onProgress: (d, t) => setProgress(Math.min(50, (d / Math.max(1, t)) * 50)),
      });

      setPhase(`OCR ${frames.length} frame...`);
      const allParsed: ParsedMutation[] = [];
      let done = 0;
      const concurrency = 3;
      let i = 0;
      async function worker() {
        while (i < frames.length) {
          const idx = i++;
          if (ctrl.signal.aborted) return;
          const f = frames[idx];
          try {
            const res = await ocrCanvas(f.canvas);
            const parsed = parseMutationsFromLines(res.lines).map((p) => ({
              ...p,
              confidence: Math.min(p.confidence, Math.round(res.avgConfidence)),
            }));
            allParsed.push(...parsed);
          } catch (e) {
            console.error("ocr fail", e);
          }
          done++;
          setProgress(50 + (done / frames.length) * 45);
        }
      }
      await Promise.all(Array.from({ length: concurrency }).map(() => worker()));

      setPhase("Deduplikasi hasil...");
      const tzShift = videoTz === "WITA" ? -1 : 0; // WITA -> WIB
      const shifted = allParsed.map((p) => ({
        ...p,
        transaction_time: tzShift ? shiftTimeHours(p.transaction_time, tzShift) : p.transaction_time,
      }));
      const deduped = dedupMutations(shifted);
      setResults(deduped);
      setProgress(97);

      if (deduped.length === 0) {
        toast({
          title: "Tidak ada transaksi terdeteksi",
          description: "Coba naikkan/turunkan crop atas & bawah agar area daftar mutasi tepat, lalu proses ulang.",
          variant: "destructive",
        });
      }

      setPhase("Kirim ke server...");
      const processing_time_ms = Date.now() - start;
      const { data, error } = await supabase.functions.invoke("transactions-ingest", {
        body: {
          transaction_date: transactionDate,
          video_meta: {
            file_name: file.name,
            file_size_bytes: file.size,
            duration_seconds: Math.round(duration),
            total_frames: totalConsidered,
            used_frames: frames.length,
            processing_time_ms,
          },
          transactions: deduped.map((d) => ({
            nominal: d.nominal,
            transaction_time: d.transaction_time,
            kode_transaksi: d.kode_transaksi || null,
            ocr_confidence: d.confidence,
            raw_ocr: d.raw,
          })),
        },
      });
      if (error) throw error;
      setIngestSummary(data);
      setProgress(100);
      setPhase("Selesai");
      toast({ title: "Berhasil", description: `${data?.inserted ?? 0} transaksi tersimpan (${data?.duplicates_skipped ?? 0} duplikat).` });
    } catch (e: any) {
      console.error(e);
      toast({ title: "Gagal", description: e?.message || "Error", variant: "destructive" });
    } finally {
      setProcessing(false);
      abortRef.current = null;
      await terminateWorkers();
    }
  }

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6">
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => navigate("/admin/dashboard")}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Kembali
          </Button>
          <h1 className="text-xl font-bold">Upload Video Livin' Merchant</h1>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Unggah Video</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm block mb-1">File Video (MP4/MOV/MKV/WEBM, max 500MB, ~10m)</label>
              <Input
                type="file"
                accept="video/mp4,video/quicktime,video/x-matroska,video/webm"
                onChange={(e) => {
                  const f = e.target.files?.[0] || null;
                  if (f && f.size > 500 * 1024 * 1024) {
                    toast({ title: "Terlalu besar", description: "Max 500MB", variant: "destructive" });
                    return;
                  }
                  setFile(f);
                }}
                disabled={processing}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-sm block mb-1">Tanggal Transaksi</label>
                <Input type="date" value={transactionDate} onChange={(e) => setTransactionDate(e.target.value)} disabled={processing} />
              </div>
              <div>
                <label className="text-sm block mb-1">Crop atas (%)</label>
                <Input type="number" value={cropTop} onChange={(e) => setCropTop(Number(e.target.value) || 0)} disabled={processing} />
              </div>
              <div>
                <label className="text-sm block mb-1">Crop bawah (%)</label>
                <Input type="number" value={cropBottom} onChange={(e) => setCropBottom(Number(e.target.value) || 0)} disabled={processing} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={onProcess} disabled={!file || processing}>
                {processing ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Upload className="w-4 h-4 mr-1" />}
                Proses
              </Button>
              {processing && (
                <Button variant="outline" onClick={() => abortRef.current?.abort()}>Batal</Button>
              )}
              <Button variant="secondary" onClick={() => navigate("/admin/auto-matching")}>Buka Auto Matching</Button>
            </div>

            {processing && (
              <div className="space-y-1">
                <Progress value={progress} />
                <p className="text-xs text-muted-foreground">{phase} ({Math.round(progress)}%)</p>
              </div>
            )}
          </CardContent>
        </Card>

        {results.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Hasil OCR ({results.length} unik)</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {ingestSummary && (
                <p className="text-sm text-muted-foreground mb-2">
                  Tersimpan: {ingestSummary.inserted} · Duplikat: {ingestSummary.duplicates_skipped}
                </p>
              )}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Jam</TableHead>
                    <TableHead>Nominal</TableHead>
                    <TableHead>Kode</TableHead>
                    <TableHead>Conf</TableHead>
                    <TableHead>Raw</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell>{r.transaction_time}</TableCell>
                      <TableCell>Rp {r.nominal.toLocaleString("id-ID")}</TableCell>
                      <TableCell className="font-mono text-xs">{r.kode_transaksi || "-"}</TableCell>
                      <TableCell>{r.confidence}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[300px] truncate">{r.raw}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

export default TransaksiUpload;
