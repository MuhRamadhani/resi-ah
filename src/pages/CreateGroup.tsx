import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Loader2, Users, Menu, CheckCircle } from "lucide-react";
import ThemeToggle from "@/components/ThemeToggle";
import AdminSidebar from "@/components/AdminSidebar";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

const pad = (n: number, width: number) => String(n).padStart(width, "0");

const CreateGroup = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [prefix, setPrefix] = useState("K.AH");
  const [startNum, setStartNum] = useState("");
  const [endNum, setEndNum] = useState("");

  useEffect(() => {
    const last = localStorage.getItem("LAST_END_NUM");
    if (last) {
      const n = parseInt(last);
      setStartNum(String(n + 1));
      setEndNum(String(n + 5));
    }
  }, []);

  const [participantsRaw, setParticipantsRaw] = useState("081545081942, 082352476245");
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<any[] | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);


  const parseParticipants = (raw: string): string[] =>
    raw.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);

  const participants = useMemo(() => parseParticipants(participantsRaw), [participantsRaw]);

  const groupNames = useMemo(() => {
    const s = parseInt(startNum);
    const e = parseInt(endNum);
    if (isNaN(s) || isNaN(e) || e < s) return [] as string[];
    const width = Math.max(startNum.length, endNum.length);
    const out: string[] = [];
    for (let i = s; i <= e; i++) out.push(`${prefix}${pad(i, width)}`);
    return out;
  }, [prefix, startNum, endNum]);

  const handleSubmit = async () => {
    if (groupNames.length === 0) {
      toast({ title: "Range tidak valid", variant: "destructive" });
      return;
    }
    if (participants.length === 0) {
      toast({ title: "Isi minimal 1 nomor member", variant: "destructive" });
      return;
    }
    if (groupNames.length > 50) {
      toast({ title: "Maksimal 50 grup sekaligus", variant: "destructive" });
      return;
    }

    setSubmitting(true);
    setResults(null);
    setProgress({ done: 0, total: groupNames.length });

    try {
      const allResults: any[] = [];
      for (let i = 0; i < groupNames.length; i++) {
        const subject = groupNames[i];
        const { data, error } = await supabase.functions.invoke("create-groups", {
          body: { groups: [{ subject, participants }] },
        });
        const r = error
          ? { subject, ok: false, error: error.message }
          : (data?.results?.[0] || { subject, ok: false, error: "No response" });
        allResults.push(r);
        setProgress({ done: i + 1, total: groupNames.length });
      }

      setResults(allResults);
      localStorage.setItem("LAST_END_NUM", endNum);

      const nextStart = parseInt(endNum) + 1;
      const nextEnd = nextStart + 4;
      setStartNum(String(nextStart));
      setEndNum(String(nextEnd + (groupNames.length - 1)));

      const okCount = allResults.filter((r) => r.ok).length;
      toast({ title: "Selesai", description: `${okCount}/${groupNames.length} grup berhasil dibuat.` });
    } catch (e: any) {
      toast({ title: "Gagal", description: e.message || String(e), variant: "destructive" });
    } finally {
      setSubmitting(false);
      setProgress(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0e1a] flex overflow-x-hidden">
      <AdminSidebar />

      {/* Main Content */}
      <div className="flex-1 min-w-0 lg:ml-56">
        <header className="bg-[#0f1424] border-b border-white/5 sticky top-0 z-10">
          <div className="px-4 py-3 md:px-6 md:py-4 flex items-center gap-3">
            {/* Hamburger + Logo (mobile) */}
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

            <div className="lg:hidden shrink-0 w-9 h-9 rounded-lg bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center">
              <CheckCircle className="w-5 h-5 text-white" />
            </div>

            {/* Back button (mobile only) */}
            <Button variant="ghost" size="icon" className="lg:hidden shrink-0 text-gray-400 hover:text-white hover:bg-white/10 w-9 h-9" onClick={() => navigate("/admin/dashboard")}>
              <ArrowLeft className="h-5 w-5" />
            </Button>

            <div className="flex-1 min-w-0">
              <h1 className="text-base md:text-xl font-bold text-white truncate">Bulk Create Group</h1>
              <p className="text-[11px] md:text-sm text-gray-400 mt-0.5 truncate">Buat grup WhatsApp secara otomatis</p>
            </div>

            <div className="lg:hidden shrink-0">
              <ThemeToggle />
            </div>
          </div>
        </header>

        <main className="px-3 py-3 md:px-6 md:py-6 max-w-3xl mx-auto space-y-3 md:space-y-5">
          <Card className="bg-[#0f1424] border-2 border-blue-500/30 shadow-[0_0_15px_rgba(59,130,246,0.15)]">
            <CardHeader className="border-b border-white/5 py-3 md:pb-4">
              <div className="flex items-center gap-2 md:gap-3">
                <div className="w-8 h-8 md:w-12 md:h-12 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0">
                  <Users className="w-4 h-4 md:w-6 md:h-6 text-blue-400" />
                </div>
                <div>
                  <CardTitle className="text-sm md:text-base text-white">Generator Nama Grup</CardTitle>
                  <p className="text-[11px] md:text-xs text-gray-400 mt-0.5">Buat banyak grup sekaligus dengan penomoran otomatis.</p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-3 md:pt-5 space-y-3 md:space-y-4">
              {/* Prefix */}
              <div className="space-y-1">
                <Label className="text-gray-300 text-xs font-medium">Prefix Nama</Label>
                <div className="relative">
                  <div className="absolute left-2.5 top-1/2 -translate-y-1/2 flex items-center justify-center w-6 h-6 rounded bg-blue-500/10">
                    <svg className="w-3.5 h-3.5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                    </svg>
                  </div>
                  <Input
                    value={prefix}
                    onChange={(e) => setPrefix(e.target.value)}
                    placeholder="KAH"
                    className="bg-[#1a1f35] border-white/10 text-white focus:border-blue-500/50 pl-10 h-9"
                  />
                </div>
              </div>

              {/* Nomor Awal & Akhir */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-gray-300 text-xs font-medium">Nomor Awal</Label>
                  <div className="relative">
                    <div className="absolute left-2.5 top-1/2 -translate-y-1/2 flex items-center justify-center w-6 h-6 rounded bg-blue-500/10">
                      <span className="text-blue-400 text-sm font-bold">#</span>
                    </div>
                    <Input
                      value={startNum}
                      onChange={(e) => setStartNum(e.target.value.replace(/[^0-9]/g, ""))}
                      placeholder="1245"
                      className="bg-[#1a1f35] border-white/10 text-white focus:border-blue-500/50 pl-10 h-9"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-gray-300 text-xs font-medium">Nomor Akhir</Label>
                  <div className="relative">
                    <div className="absolute left-2.5 top-1/2 -translate-y-1/2 flex items-center justify-center w-6 h-6 rounded bg-blue-500/10">
                      <span className="text-blue-400 text-sm font-bold">#</span>
                    </div>
                    <Input
                      value={endNum}
                      onChange={(e) => setEndNum(e.target.value.replace(/[^0-9]/g, ""))}
                      placeholder="1250"
                      className="bg-[#1a1f35] border-white/10 text-white focus:border-blue-500/50 pl-10 h-9"
                    />
                  </div>
                </div>
              </div>

              {groupNames.length > 0 && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-500/5 border border-blue-500/20">
                  <svg className="w-4 h-4 text-blue-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-xs text-gray-300">
                    Akan dibuat <span className="text-blue-400 font-bold">{groupNames.length} grup</span>:{" "}
                    <span className="text-blue-400 font-mono">{groupNames[0]}</span>
                    {groupNames.length > 1 && (
                      <> – <span className="text-blue-400 font-mono">{groupNames[groupNames.length - 1]}</span></>
                    )}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="bg-[#0f1424] border-2 border-green-500/30 shadow-[0_0_15px_rgba(34,197,94,0.15)]">
            <CardHeader className="border-b border-white/5 py-3 md:pb-4">
              <div className="flex items-center gap-2 md:gap-3">
                <div className="w-8 h-8 md:w-12 md:h-12 rounded-full bg-green-500/10 flex items-center justify-center shrink-0">
                  <svg className="w-4 h-4 md:w-6 md:h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                </div>
                <div>
                  <CardTitle className="text-sm md:text-base text-white">Member (sama untuk semua grup)</CardTitle>
                  <p className="text-[11px] md:text-xs text-gray-400 mt-0.5">Pisahkan dengan koma atau baris baru.</p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-3 md:pt-5 space-y-3">
              <Textarea
                value={participantsRaw}
                onChange={(e) => setParticipantsRaw(e.target.value)}
                rows={3}
                placeholder="081545081942, 082352476245"
                className="bg-[#1a1f35] border-white/10 text-white focus:border-green-500/50 font-mono text-sm resize-none"
              />
              {participants.length > 0 && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/20">
                  <svg className="w-4 h-4 text-green-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-xs text-green-400 font-medium">{participants.length} nomor terdeteksi</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Button
            onClick={handleSubmit}
            disabled={submitting || groupNames.length === 0 || participants.length === 0}
            className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white h-10 text-sm font-semibold shadow-lg shadow-blue-500/20"
          >
            {submitting && progress ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Membuat grup {progress.done}/{progress.total}...
              </>
            ) : (
              <>
                <Users className="w-4 h-4 mr-2" />
                Buat {groupNames.length} Grup
              </>
            )}
          </Button>

          {/* Progress bar */}
          {submitting && progress && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-gray-400">
                <span>Progress</span>
                <span className="font-semibold text-blue-400">
                  {Math.round((progress.done / progress.total) * 100)}%
                </span>
              </div>
              <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-500 to-blue-400 rounded-full transition-all duration-300"
                  style={{ width: `${(progress.done / progress.total) * 100}%` }}
                />
              </div>
              <p className="text-[11px] text-gray-500 text-center">
                {progress.done === progress.total
                  ? "Selesai ✅"
                  : `Membuat ${groupNames[progress.done] || "..."}...`}
              </p>
            </div>
          )}

          {results && results.length > 0 && (
            <Card className="bg-[#0f1424] border-white/5">
              <CardHeader className="border-b border-white/5 py-3">
                <CardTitle className="text-sm text-white">Hasil</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 pt-3">
                {results.map((r, i) => (
                  <div key={i} className={`px-3 py-2 rounded-lg text-xs border flex items-center gap-2 ${r.ok ? "bg-green-500/10 text-green-400 border-green-500/30" : "bg-red-500/10 text-red-400 border-red-500/30"}`}>
                    {r.ok ? (
                      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    )}
                    <div className="flex-1 min-w-0">
                      <strong className="font-semibold">{r.subject}</strong>
                      <span className="mx-1">—</span>
                      <span>{r.ok ? `Berhasil (${r.participantCount} member)` : `Gagal: ${r.error || r.status}`}</span>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </main>
      </div>
    </div>
  );
};

export default CreateGroup;
