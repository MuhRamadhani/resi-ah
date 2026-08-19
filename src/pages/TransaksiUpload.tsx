import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Upload, Loader2, Sparkles, Info, Menu, CheckCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { extractFrames } from "@/lib/video-ocr/frameExtractor";
import { ocrCanvas, terminateWorkers } from "@/lib/video-ocr/merchantOcr";
import { parseMutationsFromLines, dedupMutations, shiftTimeHours, type ParsedMutation } from "@/lib/video-ocr/mutationParser";
import ThemeToggle from "@/components/ThemeToggle";
import AdminSidebar from "@/components/AdminSidebar";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

const TransaksiUpload = () => {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [mobileNavOpen, setMobileNavOpen] = useState(false);
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
      const concurrency = 2;
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
              <h1 className="text-sm md:text-xl font-bold text-white truncate">Upload Video Livin' Merchant</h1>
              <p className="text-[11px] md:text-sm text-gray-400 mt-0.5 truncate">Unggah video transaksi untuk Auto Matching</p>
            </div>

            <div className="lg:hidden shrink-0">
              <ThemeToggle />
            </div>
          </div>
        </header>

        <main className="px-3 py-3 md:px-6 md:py-6 max-w-4xl mx-auto space-y-3 md:space-y-5">
          <Card className="bg-[#0f1424] border-2 border-blue-500/30 shadow-[0_0_15px_rgba(59,130,246,0.15)]">
            <CardHeader className="border-b border-white/5 py-3 md:pb-4">
              <div className="flex items-center gap-2 md:gap-3">
                <div className="w-8 h-8 md:w-12 md:h-12 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0">
                  <Upload className="w-4 h-4 md:w-6 md:h-6 text-blue-400" />
                </div>
                <div>
                  <CardTitle className="text-sm md:text-base text-white">Unggah Video</CardTitle>
                  <p className="text-[11px] md:text-xs text-gray-400 mt-0.5">Upload video transaksi Livin' Merchant</p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-3 md:pt-5 space-y-3 md:space-y-5">
              {/* File Upload Area — compact on mobile */}
              <div className="border-2 border-dashed border-white/20 rounded-lg p-4 md:p-12 text-center bg-[#1a1f35]/30 hover:border-blue-500/50 transition-colors relative">
                <div className="flex flex-col items-center gap-2 md:gap-4">
                  <div className="w-10 h-10 md:w-16 md:h-16 rounded-full bg-blue-500/10 flex items-center justify-center">
                    <Upload className="w-5 h-5 md:w-8 md:h-8 text-blue-400" />
                  </div>
                  <div>
                    <p className="text-sm md:text-base text-white font-medium mb-0.5">Drag &amp; drop file video di sini</p>
                    <p className="text-xs text-gray-400">atau klik untuk memilih file</p>
                  </div>

                  {/* Custom File Button */}
                  <label htmlFor="video-upload" className="cursor-pointer">
                    <div className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm rounded-md transition-colors">
                      Pilih File Video
                    </div>
                    <input
                      id="video-upload"
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
                      className="hidden"
                    />
                  </label>

                  {file && (
                    <p className="text-xs text-green-400 font-medium">✓ {file.name}</p>
                  )}
                </div>
              </div>

              <p className="text-[11px] text-gray-500">Format: MP4/MOV/MKV/WEBM • Maks. 500MB • Durasi maks. 10 menit</p>

              {/* Form Fields — 2 cols on mobile, 4 on desktop */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 md:gap-4">
                <div>
                  <label className="text-xs block mb-1 text-gray-300 font-medium">Tanggal Transaksi</label>
                  <div className="relative">
                    <svg className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <Input
                      type="date"
                      value={transactionDate}
                      onChange={(e) => setTransactionDate(e.target.value)}
                      disabled={processing}
                      className="bg-[#1a1f35] border-white/10 text-white text-xs focus:border-blue-500/50 pl-8 h-9
                      [&::-webkit-calendar-picker-indicator]:filter
                      [&::-webkit-calendar-picker-indicator]:invert
                      [&::-webkit-calendar-picker-indicator]:brightness-100
                      [&::-webkit-calendar-picker-indicator]:contrast-100
                      [&::-webkit-calendar-picker-indicator]:cursor-pointer
                      [&::-webkit-calendar-picker-indicator]:opacity-70
                      [&::-webkit-calendar-picker-indicator]:hover:opacity-100
                      [&::-webkit-calendar-picker-indicator]:absolute
                      [&::-webkit-calendar-picker-indicator]:right-2"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs block mb-1 text-gray-300 font-medium">Zona Waktu HP</label>
                  <select
                    className="w-full h-9 rounded-md border border-white/10 bg-[#1a1f35] px-2.5 text-xs text-white focus:border-blue-500/50 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                    value={videoTz}
                    onChange={(e) => setVideoTz(e.target.value as "WIB" | "WITA")}
                    disabled={processing}
                  >
                    <option value="WIB">WIB (sama dgn resi)</option>
                    <option value="WITA">WITA (-1 jam ke WIB)</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs block mb-1 text-gray-300 font-medium">Crop atas (%)</label>
                  <div className="relative">
                    <Input
                      type="number"
                      value={cropTop}
                      onChange={(e) => setCropTop(Number(e.target.value) || 0)}
                      disabled={processing}
                      className="bg-[#1a1f35] border-white/10 text-white text-xs focus:border-blue-500/50 pr-7 h-9"
                    />
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">%</span>
                  </div>
                </div>
                <div>
                  <label className="text-xs block mb-1 text-gray-300 font-medium">Crop bawah (%)</label>
                  <div className="relative">
                    <Input
                      type="number"
                      value={cropBottom}
                      onChange={(e) => setCropBottom(Number(e.target.value) || 0)}
                      disabled={processing}
                      className="bg-[#1a1f35] border-white/10 text-white text-xs focus:border-blue-500/50 pr-7 h-9"
                    />
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">%</span>
                  </div>
                </div>
              </div>

              {/* Info Box — compact */}
              <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-500/5 border border-blue-500/20">
                <Info className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
                <p className="text-[11px] text-gray-400 leading-relaxed">
                  Crop atas: abaikan header/tab. Crop bawah: abaikan overlay filter tanggal. Kalau 0 terdeteksi, naikkan crop atas ke 32–35%.
                </p>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  onClick={onProcess}
                  disabled={!file || processing}
                  className="flex-1 sm:flex-none bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 text-white shadow-lg shadow-purple-500/20 h-9 text-sm"
                >
                  {processing ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Proses Sekarang
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 mr-2" />
                      Proses Sekarang
                    </>
                  )}
                </Button>
                {processing && (
                  <Button
                    variant="outline"
                    onClick={() => abortRef.current?.abort()}
                    className="h-9 bg-[#1a1f35] border-white/20 text-gray-300 hover:bg-white/10 text-sm"
                  >
                    Batal
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={() => navigate("/admin/auto-matching")}
                  className="flex-1 sm:flex-none h-9 bg-transparent border-purple-500/30 text-purple-400 hover:bg-purple-500/10 text-sm"
                >
                  <Sparkles className="w-4 h-4 mr-2" />
                  Buka Auto Matching
                </Button>
              </div>

              {/* Progress */}
              {processing && (
                <div className="space-y-2">
                  <Progress value={progress} className="bg-[#1a1f35] h-2" />
                  <p className="text-xs text-gray-400 flex items-center gap-2">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    {phase} ({Math.round(progress)}%)
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Results Table */}
          {results.length > 0 && (
            <Card className="bg-[#0f1424] border-white/5">
              <CardHeader className="border-b border-white/5">
                <CardTitle className="text-base text-white">Hasil OCR ({results.length} transaksi unik)</CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                {ingestSummary && (
                  <div className="mb-4 p-4 rounded-lg bg-gradient-to-r from-green-500/10 to-blue-500/10 border border-green-500/20">
                    <p className="text-sm text-gray-300">
                      Tersimpan: <span className="text-green-400 font-bold text-lg">{ingestSummary.inserted}</span> · 
                      Duplikat: <span className="text-orange-400 font-bold">{ingestSummary.duplicates_skipped}</span>
                    </p>
                  </div>
                )}
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-[#1a1f35] hover:bg-[#1a1f35] border-b border-white/5">
                        <TableHead className="text-gray-300">Jam</TableHead>
                        <TableHead className="text-gray-300">Nominal</TableHead>
                        <TableHead className="text-gray-300">Kode</TableHead>
                        <TableHead className="text-gray-300">Conf</TableHead>
                        <TableHead className="text-gray-300">Raw</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {results.map((r, i) => (
                        <TableRow key={i} className="border-b border-white/5 hover:bg-white/5">
                          <TableCell className="text-white font-medium">{r.transaction_time}</TableCell>
                          <TableCell className="text-white">Rp {r.nominal.toLocaleString("id-ID")}</TableCell>
                          <TableCell className="font-mono text-xs text-gray-300">{r.kode_transaksi || "-"}</TableCell>
                          <TableCell className="text-gray-300">{r.confidence}%</TableCell>
                          <TableCell className="text-xs text-gray-400 max-w-[300px] truncate">{r.raw}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </main>
      </div>
    </div>
  );
};

export default TransaksiUpload;
