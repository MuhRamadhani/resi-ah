import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Menu, Bell, MessageSquare, Smile, Loader2, LogOut, Check, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import AdminSidebar from "@/components/AdminSidebar";

// mode:
// "message"             → Approve & Reject pakai pesan teks
// "reaction"            → Approve & Reject pakai reaction emoji
// "hybrid_react_approve" → Approve = Reaction, Reject = Pesan Teks
// "hybrid_react_reject"  → Approve = Pesan Teks, Reject = Reaction
type NotifMode = "message" | "reaction" | "hybrid_react_approve" | "hybrid_react_reject";

const APPROVED_EMOJIS = ["❤️", "👍", "✅", "🎉", "💚", "🙏", "⭐", "💯"];
const REJECTED_EMOJIS = ["❌", "👎", "🚫", "😔", "💔", "⛔", "🙅", "🔴"];

const MODES: { value: NotifMode; label: string; sub: string; icon: string; color: string; border: string }[] = [
  {
    value: "message",
    label: "Pesan Teks",
    sub: "Approve & Reject pakai teks",
    icon: "💬",
    color: "border-purple-500/50 bg-purple-500/10",
    border: "border-purple-500/50",
  },
  {
    value: "reaction",
    label: "Reaction Emoji",
    sub: "Approve & Reject pakai reaction",
    icon: "😊",
    color: "border-pink-500/50 bg-pink-500/10",
    border: "border-pink-500/50",
  },
  {
    value: "hybrid_react_approve",
    label: "Hybrid (✅ Reaksi)",
    sub: "Approve = Reaction · Reject = Teks",
    icon: "⚡",
    color: "border-green-500/50 bg-green-500/10",
    border: "border-green-500/50",
  },
  {
    value: "hybrid_react_reject",
    label: "Hybrid (❌ Reaksi)",
    sub: "Approve = Teks · Reject = Reaction",
    icon: "🔀",
    color: "border-orange-500/50 bg-orange-500/10",
    border: "border-orange-500/50",
  },
];

const NotificationSettings = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<NotifMode>("message");
  const [reactionApproved, setReactionApproved] = useState("❤️");
  const [reactionRejected, setReactionRejected] = useState("❌");
  const [messageApproved, setMessageApproved] = useState("Resi Sebesar {nominal} Masuk ✅");
  const [messageRejected, setMessageRejected] = useState("Resi Sebesar {nominal} Tidak Masuk ❌");

  useEffect(() => {
    supabase
      .from("notification_settings")
      .select("mode, reaction_approved, reaction_rejected, message_approved, message_rejected")
      .eq("id", "default")
      .single()
      .then(({ data }) => {
        if (data) {
          setMode((data.mode as NotifMode) || "message");
          setReactionApproved(data.reaction_approved || "❤️");
          setReactionRejected(data.reaction_rejected || "❌");
          setMessageApproved((data as any).message_approved || "Resi Sebesar {nominal} Masuk ✅");
          setMessageRejected((data as any).message_rejected || "Resi Sebesar {nominal} Tidak Masuk ❌");
        }
        setLoading(false);
      });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("notification_settings")
      .upsert({
        id: "default",
        mode,
        reaction_approved: reactionApproved,
        reaction_rejected: reactionRejected,
        message_approved: messageApproved,
        message_rejected: messageRejected,
        updated_at: new Date().toISOString(),
      } as any);
    if (error) {
      toast({ title: "Gagal menyimpan", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Tersimpan!", description: "Pengaturan notifikasi berhasil diupdate." });
    }
    setSaving(false);
  };

  const logout = async () => {
    await supabase.auth.signOut();
    navigate("/admin/login");
  };

  // Tentukan apa yang perlu ditampilkan berdasarkan mode
  const showReactionApproved = mode === "reaction" || mode === "hybrid_react_approve";
  const showReactionRejected = mode === "reaction" || mode === "hybrid_react_reject";
  const showMsgApproved      = mode === "message"  || mode === "hybrid_react_reject";
  const showMsgRejected      = mode === "message"  || mode === "hybrid_react_approve";

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
          <span className="text-sm font-semibold text-white">Notifikasi WA</span>
          <Button variant="ghost" size="sm" className="text-gray-400 hover:text-red-400" onClick={logout}>
            <LogOut className="w-4 h-4" />
          </Button>
        </header>

        <main className="flex-1 p-4 md:p-6 space-y-4 max-w-xl mx-auto w-full">
          {/* Header */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-purple-500/10 flex items-center justify-center">
              <Bell className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">Pengaturan Notifikasi WA</h1>
              <p className="text-xs text-gray-400">Pilih cara notifikasi saat resi di-approve / reject</p>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : (
            <>
              {/* ── Mode selector: 2x2 grid ── */}
              <div className="grid grid-cols-2 gap-3">
                {MODES.map((m) => {
                  const active = mode === m.value;
                  return (
                    <button
                      key={m.value}
                      onClick={() => setMode(m.value)}
                      className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-all text-center ${
                        active ? m.color : "border-white/10 bg-white/5 hover:border-white/20"
                      }`}
                    >
                      <span className="text-2xl leading-none">{m.icon}</span>
                      <div>
                        <p className={`text-xs font-semibold ${active ? "text-white" : "text-gray-300"}`}>
                          {m.label}
                        </p>
                        <p className="text-[10px] text-gray-500 mt-0.5 leading-tight">{m.sub}</p>
                      </div>
                      {active && (
                        <div className="w-4 h-4 rounded-full bg-white/20 flex items-center justify-center">
                          <Check className="w-2.5 h-2.5 text-white" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* ── Ringkasan mode aktif ── */}
              <div className="rounded-lg bg-white/5 border border-white/10 px-4 py-3 text-xs text-gray-400 space-y-1">
                <p className="font-semibold text-white text-sm">Mode: {MODES.find(m => m.value === mode)?.label}</p>
                {mode === "message" && <p>Approve & Reject → kirim pesan teks ke chat</p>}
                {mode === "reaction" && <p>Approve & Reject → kirim reaction emoji ke pesan resi</p>}
                {mode === "hybrid_react_approve" && (
                  <>
                    <p>✅ <span className="text-green-400">Approve</span> → Reaction emoji</p>
                    <p>❌ <span className="text-red-400">Reject</span> → Pesan teks (member tahu kenapa ditolak)</p>
                  </>
                )}
                {mode === "hybrid_react_reject" && (
                  <>
                    <p>✅ <span className="text-green-400">Approve</span> → Pesan teks</p>
                    <p>❌ <span className="text-red-400">Reject</span> → Reaction emoji</p>
                  </>
                )}
              </div>

              {/* ── Reaction picker ── */}
              {(showReactionApproved || showReactionRejected) && (
                <Card className="bg-[#0f1424] border-white/5">
                  <CardHeader className="p-4 pb-3 border-b border-white/5">
                    <CardTitle className="text-sm font-semibold text-white flex items-center gap-2">
                      <Smile className="w-4 h-4 text-pink-400" />
                      Pilih Emoji Reaction
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 space-y-5">
                    {showReactionApproved && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-medium text-gray-400">
                            Saat <span className="text-green-400">Approved</span>
                          </p>
                          <span className="text-xs text-gray-500">
                            Terpilih: <span className="text-lg leading-none">{reactionApproved}</span>
                          </span>
                        </div>
                        <div className="flex gap-2">
                          {APPROVED_EMOJIS.map((emoji) => (
                            <button
                              key={emoji}
                              onClick={() => setReactionApproved(emoji)}
                              className={`flex-1 h-10 rounded-xl text-xl transition-all ${
                                reactionApproved === emoji
                                  ? "bg-green-500/20 ring-2 ring-green-500/50 scale-105"
                                  : "bg-white/5 hover:bg-white/10 border border-white/10"
                              }`}
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {showReactionApproved && showReactionRejected && <div className="h-px bg-white/5" />}

                    {showReactionRejected && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-medium text-gray-400">
                            Saat <span className="text-red-400">Rejected</span>
                          </p>
                          <span className="text-xs text-gray-500">
                            Terpilih: <span className="text-lg leading-none">{reactionRejected}</span>
                          </span>
                        </div>
                        <div className="flex gap-2">
                          {REJECTED_EMOJIS.map((emoji) => (
                            <button
                              key={emoji}
                              onClick={() => setReactionRejected(emoji)}
                              className={`flex-1 h-10 rounded-xl text-xl transition-all ${
                                reactionRejected === emoji
                                  ? "bg-red-500/20 ring-2 ring-red-500/50 scale-105"
                                  : "bg-white/5 hover:bg-white/10 border border-white/10"
                              }`}
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* ── Pesan Teks template ── */}
              {(showMsgApproved || showMsgRejected) && (
                <Card className="bg-[#0f1424] border-white/5">
                  <CardHeader className="p-4 pb-3 border-b border-white/5">
                    <CardTitle className="text-sm font-semibold text-white flex items-center gap-2">
                      <MessageSquare className="w-4 h-4 text-purple-400" />
                      Template Pesan Teks
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 space-y-4">
                    <p className="text-[11px] text-gray-500">
                      Gunakan <code className="text-purple-300 bg-purple-500/10 px-1 rounded">{"{nominal}"}</code> untuk menyisipkan jumlah transfer secara otomatis.
                    </p>

                    {showMsgApproved && (
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-gray-300 flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-green-400 inline-block" />
                          Pesan Approved
                        </label>
                        <Textarea
                          value={messageApproved}
                          onChange={(e) => setMessageApproved(e.target.value)}
                          rows={2}
                          className="bg-[#1a1f35] border-white/10 text-white text-sm resize-none focus:border-green-500/40"
                          placeholder="Resi Sebesar {nominal} Masuk ✅"
                        />
                      </div>
                    )}

                    {showMsgRejected && (
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-gray-300 flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-red-400 inline-block" />
                          Pesan Rejected
                        </label>
                        <Textarea
                          value={messageRejected}
                          onChange={(e) => setMessageRejected(e.target.value)}
                          rows={2}
                          className="bg-[#1a1f35] border-white/10 text-white text-sm resize-none focus:border-red-500/40"
                          placeholder="Resi Sebesar {nominal} Tidak Masuk ❌"
                        />
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Save button */}
              <Button
                onClick={handleSave}
                disabled={saving}
                className="w-full h-11 bg-purple-600 hover:bg-purple-700 text-white gap-2"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Simpan Pengaturan
              </Button>
            </>
          )}
        </main>
      </div>
    </div>
  );
};

export default NotificationSettings;
