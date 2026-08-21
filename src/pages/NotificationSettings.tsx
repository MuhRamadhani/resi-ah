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

type NotifMode = "message" | "reaction";

const APPROVED_EMOJIS = ["❤️", "👍", "✅", "🎉", "💚", "🙏", "⭐", "💯"];
const REJECTED_EMOJIS = ["❌", "👎", "🚫", "😔", "💔", "⛔", "🙅", "🔴"];

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
              {/* ── Mode selector ── */}
              <div className="grid grid-cols-2 gap-3">
                {/* Pesan Teks */}
                <button
                  onClick={() => setMode("message")}
                  className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-all ${
                    mode === "message"
                      ? "border-purple-500/50 bg-purple-500/10"
                      : "border-white/10 bg-white/5 hover:border-white/20"
                  }`}
                >
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                    mode === "message" ? "bg-purple-500/20" : "bg-white/5"
                  }`}>
                    <MessageSquare className={`w-4 h-4 ${mode === "message" ? "text-purple-400" : "text-gray-400"}`} />
                  </div>
                  <div className="text-center">
                    <p className={`text-xs font-semibold ${mode === "message" ? "text-purple-300" : "text-white"}`}>
                      Pesan Teks
                    </p>
                    <p className="text-[10px] text-gray-500 mt-0.5">Reply teks ke chat</p>
                  </div>
                  {mode === "message" && (
                    <div className="w-4 h-4 rounded-full bg-purple-500 flex items-center justify-center">
                      <Check className="w-2.5 h-2.5 text-white" />
                    </div>
                  )}
                </button>

                {/* Reaction Emoji */}
                <button
                  onClick={() => setMode("reaction")}
                  className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-all ${
                    mode === "reaction"
                      ? "border-pink-500/50 bg-pink-500/10"
                      : "border-white/10 bg-white/5 hover:border-white/20"
                  }`}
                >
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                    mode === "reaction" ? "bg-pink-500/20" : "bg-white/5"
                  }`}>
                    <Smile className={`w-4 h-4 ${mode === "reaction" ? "text-pink-400" : "text-gray-400"}`} />
                  </div>
                  <div className="text-center">
                    <p className={`text-xs font-semibold ${mode === "reaction" ? "text-pink-300" : "text-white"}`}>
                      Reaction Emoji
                    </p>
                    <p className="text-[10px] text-gray-500 mt-0.5">React ke pesan asli</p>
                  </div>
                  {mode === "reaction" && (
                    <div className="w-4 h-4 rounded-full bg-pink-500 flex items-center justify-center">
                      <Check className="w-2.5 h-2.5 text-white" />
                    </div>
                  )}
                </button>
              </div>

              {/* ── Pesan Teks: custom text fields ── */}
              {mode === "message" && (
                <Card className="bg-[#0f1424] border-white/5">
                  <CardHeader className="p-4 pb-3 border-b border-white/5">
                    <CardTitle className="text-sm font-semibold text-white flex items-center gap-2">
                      <MessageSquare className="w-4 h-4 text-purple-400" />
                      Template Pesan
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 space-y-4">
                    <p className="text-[11px] text-gray-500">
                      Gunakan <code className="text-purple-300 bg-purple-500/10 px-1 rounded">{"{nominal}"}</code> untuk menyisipkan jumlah transfer secara otomatis.
                    </p>

                    {/* Approved */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-gray-300 flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-green-400 inline-block" />
                        Pesan Approved
                      </label>
                      <Textarea
                        value={messageApproved}
                        onChange={(e) => setMessageApproved(e.target.value)}
                        rows={2}
                        className="bg-[#1a1f35] border-white/10 text-white text-sm resize-none focus:border-green-500/40 focus:ring-green-500/10"
                        placeholder="Resi Sebesar {nominal} Masuk ✅"
                      />
                    </div>

                    {/* Rejected */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-gray-300 flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-red-400 inline-block" />
                        Pesan Rejected
                      </label>
                      <Textarea
                        value={messageRejected}
                        onChange={(e) => setMessageRejected(e.target.value)}
                        rows={2}
                        className="bg-[#1a1f35] border-white/10 text-white text-sm resize-none focus:border-red-500/40 focus:ring-red-500/10"
                        placeholder="Resi Sebesar {nominal} Tidak Masuk ❌"
                      />
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* ── Reaction Emoji picker ── */}
              {mode === "reaction" && (
                <Card className="bg-[#0f1424] border-white/5">
                  <CardHeader className="p-4 pb-3 border-b border-white/5">
                    <CardTitle className="text-sm font-semibold text-white flex items-center gap-2">
                      <Smile className="w-4 h-4 text-pink-400" />
                      Pilih Emoji Reaction
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 space-y-5">
                    {/* Approved */}
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

                    <div className="h-px bg-white/5" />

                    {/* Rejected */}
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
