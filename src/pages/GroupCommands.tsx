import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Loader2, Plus, Trash2, Save, RefreshCw } from "lucide-react";
import ThemeToggle from "@/components/ThemeToggle";

interface GroupSetting {
  id: string;
  group_id: string;
  group_name: string | null;
  welcome_message: string | null;
  open_message: string | null;
  close_message: string | null;
  left_message: string | null;
  is_open: boolean;
}

interface Blacklist {
  id: string;
  phone: string;
  reason: string | null;
  created_at: string;
}

const GroupCommands = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState<GroupSetting[]>([]);
  const [blacklist, setBlacklist] = useState<Blacklist[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string>("");
  const [draft, setDraft] = useState<Partial<GroupSetting>>({});
  const [newGroupId, setNewGroupId] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newReason, setNewReason] = useState("");

  useEffect(() => {
    const checkAuth = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
    
      if (!session) {
        navigate("/admin/login");
        return;
      }
    
      const { data: roleData } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", session.user.id)
        .eq("role", "admin")
        .maybeSingle();
    
      if (!roleData) {
        navigate("/admin/login");
        return;
      }
    
      loadAll();
    };
  
    checkAuth();
  }, [navigate]);

  const loadAll = async () => {
    setLoading(true);
    const [g, b] = await Promise.all([
      (supabase.from as any)("group_settings").select("*").order("created_at", { ascending: false }),
      (supabase.from as any)("group_blacklist").select("*").order("created_at", { ascending: false }),
    ]);
    if (g.data) setGroups(g.data);
    if (b.data) setBlacklist(b.data);
    setLoading(false);
  };

  const selectGroup = (id: string) => {
    setSelectedGroupId(id);
    const g = groups.find((x) => x.id === id);
    setDraft(g || {});
  };

  const addGroup = async () => {
    if (!newGroupId.trim()) {
      toast({ title: "Group ID wajib diisi", variant: "destructive" });
      return;
    }
    const gid = newGroupId.trim().endsWith("@g.us") ? newGroupId.trim() : `${newGroupId.trim()}@g.us`;
    const { error } = await (supabase.from as any)("group_settings").insert({
      group_id: gid,
      group_name: newGroupName.trim() || null,
      is_open: true,
    });
    if (error) {
      toast({ title: "Gagal", description: error.message, variant: "destructive" });
      return;
    }
    setNewGroupId("");
    setNewGroupName("");
    toast({ title: "Grup ditambahkan" });
    await loadAll();
  };

  const saveDraft = async () => {
    if (!selectedGroupId) return;
    const { error } = await (supabase.from as any)("group_settings")
      .update({
        group_name: draft.group_name ?? null,
        welcome_message: draft.welcome_message ?? null,
        open_message: draft.open_message ?? null,
        close_message: draft.close_message ?? null,
        left_message: draft.left_message ?? null,
        is_open: draft.is_open ?? true,
      })
      .eq("id", selectedGroupId);
    if (error) {
      toast({ title: "Gagal simpan", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Tersimpan" });
    await loadAll();
  };

  const deleteGroup = async (id: string) => {
    if (!confirm("Hapus pengaturan grup ini?")) return;
    await (supabase.from as any)("group_settings").delete().eq("id", id);
    if (selectedGroupId === id) {
      setSelectedGroupId("");
      setDraft({});
    }
    await loadAll();
  };

  const addBlacklist = async () => {
    const phone = newPhone.replace(/[^0-9]/g, "");
    if (!phone) {
      toast({ title: "Nomor wajib diisi", variant: "destructive" });
      return;
    }
    const { error } = await (supabase.from as any)("group_blacklist").insert({
      phone,
      reason: newReason.trim() || null,
    });
    if (error) {
      toast({ title: "Gagal", description: error.message, variant: "destructive" });
      return;
    }
    setNewPhone("");
    setNewReason("");
    toast({ title: "Nomor di-blacklist" });
    await loadAll();
  };

  const removeBlacklist = async (id: string) => {
    await (supabase.from as any)("group_blacklist").delete().eq("id", id);
    await loadAll();
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/admin/dashboard")}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-xl font-bold">Group Commands</h1>
              <p className="text-sm text-muted-foreground">Atur pesan & blacklist grup WhatsApp</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={loadAll} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        <Tabs defaultValue="messages" className="space-y-4">
          <TabsList>
            <TabsTrigger value="messages">Pesan Grup</TabsTrigger>
            <TabsTrigger value="blacklist">Blacklist</TabsTrigger>
            <TabsTrigger value="help">Daftar Command</TabsTrigger>
          </TabsList>

          <TabsContent value="messages" className="space-y-4">
            <Card>
              <CardHeader><CardTitle className="text-base">Tambah Grup</CardTitle></CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
                <Input placeholder="Group ID (xxx@g.us)" value={newGroupId} onChange={(e) => setNewGroupId(e.target.value)} />
                <Input placeholder="Nama grup (opsional)" value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} />
                <Button onClick={addGroup}><Plus className="h-4 w-4 mr-1" />Tambah</Button>
              </CardContent>
            </Card>

            <div className="grid gap-4 md:grid-cols-[300px_1fr]">
              <Card>
                <CardHeader><CardTitle className="text-base">Grup Tersimpan ({groups.length})</CardTitle></CardHeader>
                <CardContent className="space-y-1 max-h-[500px] overflow-auto">
                  {groups.length === 0 && <p className="text-sm text-muted-foreground">Belum ada grup</p>}
                  {groups.map((g) => (
                    <div
                      key={g.id}
                      className={`p-2 rounded cursor-pointer text-sm flex items-center justify-between gap-2 ${
                        selectedGroupId === g.id ? "bg-accent" : "hover:bg-accent/50"
                      }`}
                      onClick={() => selectGroup(g.id)}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{g.group_name || g.group_id}</div>
                        <div className="truncate text-xs text-muted-foreground">{g.group_id}</div>
                      </div>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); deleteGroup(g.id); }}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-base">Pengaturan Pesan</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {!selectedGroupId ? (
                    <p className="text-sm text-muted-foreground">Pilih grup di kiri untuk mengatur pesan</p>
                  ) : (
                    <>
                      <div>
                        <label className="text-sm font-medium">Nama Grup</label>
                        <Input value={draft.group_name ?? ""} onChange={(e) => setDraft({ ...draft, group_name: e.target.value })} />
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch checked={draft.is_open ?? true} onCheckedChange={(v) => setDraft({ ...draft, is_open: v })} />
                        <span className="text-sm">Status: {draft.is_open ? "Open" : "Closed"}</span>
                      </div>
                      <div>
                        <label className="text-sm font-medium">Welcome Message (saat member join)</label>
                        <Textarea rows={3} value={draft.welcome_message ?? ""} onChange={(e) => setDraft({ ...draft, welcome_message: e.target.value })} placeholder="Selamat datang @user di grup..." />
                      </div>
                      <div>
                        <label className="text-sm font-medium">Left Message (saat member keluar)</label>
                        <Textarea rows={2} value={draft.left_message ?? ""} onChange={(e) => setDraft({ ...draft, left_message: e.target.value })} placeholder="@user telah keluar grup" />
                      </div>
                      <div>
                        <label className="text-sm font-medium">Pesan .open</label>
                        <Textarea rows={2} value={draft.open_message ?? ""} onChange={(e) => setDraft({ ...draft, open_message: e.target.value })} />
                      </div>
                      <div>
                        <label className="text-sm font-medium">Pesan .close</label>
                        <Textarea rows={2} value={draft.close_message ?? ""} onChange={(e) => setDraft({ ...draft, close_message: e.target.value })} />
                      </div>
                      <Button onClick={saveDraft}><Save className="h-4 w-4 mr-1" />Simpan</Button>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="blacklist" className="space-y-4">
            <Card>
              <CardHeader><CardTitle className="text-base">Tambah Blacklist</CardTitle></CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
                <Input placeholder="Nomor (628xxx)" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
                <Input placeholder="Alasan (opsional)" value={newReason} onChange={(e) => setNewReason(e.target.value)} />
                <Button onClick={addBlacklist}><Plus className="h-4 w-4 mr-1" />Tambah</Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Daftar Blacklist ({blacklist.length})</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nomor</TableHead>
                      <TableHead>Alasan</TableHead>
                      <TableHead>Tanggal</TableHead>
                      <TableHead className="w-16" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {blacklist.length === 0 && (
                      <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Kosong</TableCell></TableRow>
                    )}
                    {blacklist.map((b) => (
                      <TableRow key={b.id}>
                        <TableCell className="font-mono text-sm">{b.phone}</TableCell>
                        <TableCell className="text-sm">{b.reason || "-"}</TableCell>
                        <TableCell className="text-sm">{new Date(b.created_at).toLocaleString("id-ID")}</TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" onClick={() => removeBlacklist(b.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="help">
            <Card>
              <CardHeader><CardTitle className="text-base">Command Grup (hanya admin)</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p><code className="bg-muted px-1.5 py-0.5 rounded">.open</code> — buka grup (kirim pesan open)</p>
                <p><code className="bg-muted px-1.5 py-0.5 rounded">.close</code> — tutup grup (kirim pesan close)</p>
                <p><code className="bg-muted px-1.5 py-0.5 rounded">.setopen &lt;pesan&gt;</code> — set pesan .open untuk grup ini</p>
                <p><code className="bg-muted px-1.5 py-0.5 rounded">.setclose &lt;pesan&gt;</code> — set pesan .close untuk grup ini</p>
                <p><code className="bg-muted px-1.5 py-0.5 rounded">.setwelcome &lt;pesan&gt;</code> — set pesan welcome saat member join</p>
                <p><code className="bg-muted px-1.5 py-0.5 rounded">.setleft &lt;pesan&gt;</code> — set pesan saat member keluar</p>
                <p><code className="bg-muted px-1.5 py-0.5 rounded">.totag</code> — reply pesan, tag semua member</p>
                <p><code className="bg-muted px-1.5 py-0.5 rounded">.h &lt;pesan&gt;</code> — kirim pesan + tag semua</p>
                <p><code className="bg-muted px-1.5 py-0.5 rounded">.sync</code> — sync member grup</p>
                <p><code className="bg-muted px-1.5 py-0.5 rounded">.blacklist &lt;nomor&gt;</code> — tambah nomor ke blacklist</p>
                <p><code className="bg-muted px-1.5 py-0.5 rounded">.help</code> — tampilkan bantuan</p>
                <p className="text-muted-foreground pt-2">Member yang join dan ada di blacklist akan otomatis dikeluarkan.</p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default GroupCommands;
