import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Loader2, Users } from "lucide-react";
import ThemeToggle from "@/components/ThemeToggle";

const pad = (n: number, width: number) => String(n).padStart(width, "0");

const CreateGroup = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [prefix, setPrefix] = useState("K.AH");
  const [startNum, setStartNum] = useState("");
  const [endNum, setEndNum] = useState("");

  useEffect(() => {
    const last = localStorage.getItem("LAST_END_NUM");

    if (last) {
      const n = parseInt(last);

      setStartNum(String(n));
      setEndNum(String(n + 5));
    }
  }, []);

  const [participantsRaw, setParticipantsRaw] = useState("081545081942, 082352476245");
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<any[] | null>(null);


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
    try {
      const groups = groupNames.map((subject) => ({ subject, participants }));
      const { data, error } = await supabase.functions.invoke("create-groups", { body: { groups } });
      if (error) throw error;
      setResults(data?.results || []);

      localStorage.setItem("LAST_END_NUM", endNum);

      const nextStart = parseInt(endNum);
      const nextEnd = nextStart + 5;

      setStartNum(String(nextStart));
      setEndNum(String(nextEnd));

      const okCount = (data?.results || []).filter((r: any) => r.ok).length;
      toast({ title: "Selesai", description: `${okCount}/${groups.length} grup berhasil dibuat.` });
    } catch (e: any) {
      toast({ title: "Gagal", description: e.message || String(e), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/admin/dashboard")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              <h1 className="text-lg font-semibold">Bulk Create Group</h1>
            </div>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 max-w-2xl space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Generator Nama Grup</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label>Prefix Nama</Label>
              <Input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="K.AH" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Nomor Awal</Label>
                <Input value={startNum} onChange={(e) => setStartNum(e.target.value.replace(/[^0-9]/g, ""))} />
              </div>
              <div className="space-y-1.5">
                <Label>Nomor Akhir</Label>
                <Input value={endNum} onChange={(e) => setEndNum(e.target.value.replace(/[^0-9]/g, ""))} />
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              {groupNames.length > 0 ? (
                <>Akan dibuat <strong>{groupNames.length}</strong> grup: <span className="font-mono">{groupNames[0]} … {groupNames[groupNames.length - 1]}</span></>
              ) : (
                "Range tidak valid"
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Member (sama untuk semua grup)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Textarea
              rows={6}
              placeholder={"08123456789\n08987654321\natau pisah dengan koma"}
              value={participantsRaw}
              onChange={(e) => setParticipantsRaw(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{participants.length} nomor terdeteksi</p>
          </CardContent>
        </Card>

        <Button onClick={handleSubmit} disabled={submitting} className="w-full">
          {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Users className="h-4 w-4 mr-2" />}
          Buat {groupNames.length} Grup
        </Button>

        {results && (
          <Card>
            <CardHeader><CardTitle className="text-base">Hasil</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {results.map((r, i) => (
                <div key={i} className={`p-2 rounded text-sm ${r.ok ? "bg-green-500/10 text-green-700 dark:text-green-400" : "bg-destructive/10 text-destructive"}`}>
                  <strong>{r.subject}</strong> — {r.ok ? `✅ Berhasil (${r.participantCount} member)` : `❌ Gagal: ${r.error || r.status}`}
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
};

export default CreateGroup;
