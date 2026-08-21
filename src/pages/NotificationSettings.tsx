import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Menu, Bell, MessageSquare, Smile, Loader2, LogOut, Check, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import AdminSidebar from "@/components/AdminSidebar";

type NotifMode = "message" | "reaction";

const REACTION_OPTIONS = ["❤️","👍","✅","🎉","💚","🙏","⭐","🔥","💯","😍","🥰","👏"];

const NotificationSettings = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<NotifMode>("message");
  const [reactionApproved, setReactionApproved] = useState("❤️");
  const [reactionRejected, setReactionRejected] = useState("❌");

  useEffect(() => {
    supabase
      .from("notification_settings")
      .select("mode, reaction_approved, reaction_rejected")
      .eq("id", "default")
      .single()
      .then(({ data }) => {
        if (data) {
          setMode((data.mode as NotifMode) || "message");
          setReactionApproved(data.reaction_approved || "❤️");
          setReactionRejected(data.reaction_rejected || "❌");
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
        updated_at: new Date().toISOString(),
      });
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

        <main className="flex-1 p-4 md:p-6 space-y-6 max-w-xl mx-auto w-full">
          {/* Header */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-purple-500/10 flex items-center justify-center">
              <Bell className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">Pengaturan Notifikasi WA</h1>
              <p className="text-xs text-gray-400">Pilih cara notifikasi dikirim saat resi di-approve / reject</p>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : (
            <>
              {/* Mode selector */}
              <Card className="bg-[#0f1424] border-white/5">
                <CardHeader className="p-4 pb-3 border-b border-white/5">
                  <CardTitle className="text-sm font-semibold text-white">Mode Pengiriman</CardTitle>
                </CardHeader>
                <CardContent className="p-4 space-y-3">
                  {/* Pesan */}
                  <button
                    onClick={() => setMode("message")}
                    className={`w-full flex items-start gap-3 p-4 rounded-xl border transition-all ${
                      mode === "message"
                        ? "border-purple-500/40 bg-purple-500/10"
                        : "border-white/10 bg-white/5 hover:border-white/20"
                    }`}
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                      mode === "message" ? "bg-purple-500/20" : "bg-white/5"
                    }`}>
                      <MessageSquare className={`w-4 h-4 ${mode === "message" ? "text-purple-400" : "text-gray-400"}`} />
                    </div>
                    <div className="flex-1 text-left">
                      <p className={`font-semibold text-sm ${mode === "message" ? "text-purple-300" : "text-white"}`}>
                        Kirim Pesan Teks
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Reply ke pesan asli dengan teks, misal "Resi Sebesar Rp 29.700 Masuk ✅"
                      </p>
                      <div className="mt-2 flex gap-2">
                        <span className="text-[11px] bg-green-500/10 text-green-400 px-2 py-0.5 rounded-full">Approved → teks ✅</span>
                        <span className="text-[11px] bg-red-500/10 text-red-400 px-2 py-0.5 rounded-full">Rejected → teks ❌</span>
                      </div>
                    </div>
                    {mode === "message" && <Check className="w-4 h-4 text-purple-400 shrink-0 mt-1" />}
                  </button>

                  {/* Reaction */}
                  <button
                    onClick={() => setMode("reaction")}
                    className={`w-full flex items-start gap-3 p-4 rounded-xl border transition-all ${
                      mode === "reaction"
                        ? "border-pink-500/40 bg-pink-500/10"
                        : "border-white/10 bg-white/5 hover:border-white/20"
                    }`}
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                      mode === "reaction" ? "bg-pink-500/20" : "bg-white/5"
                    }`}>
                      <Smile className={`w-4 h-4 ${mode === "reaction" ? "text-pink-400" : "text-gray-400"}`} />
                    </div>
                    <div className="flex-1 text-left">
                      <p className={`font-semibold text-sm ${mode === "reaction" ? "text-pink-300" : "text-white"}`}>
                        Kirim Reaction Emoji
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        React ke pesan asli dengan emoji. Lebih simpel, tidak spam chat.
                      </p>
                      <div className="mt-2 flex gap-2">
                        <span className="text-[11px] bg-green-500/10 text-green-400 px-2 py-0.5 rounded-full">Approved → {reactionApproved}</span>
                        <span className="text-[11px] bg-red-500/10 text-red-400 px-2 py-0.5 rounded-full">Rejected → {reactionRejected}</span>
                      </div>
                    </div>
                    {mode === "reaction" && <Check className="w-4 h-4 text-pink-400 shrink-0 mt-1" />}
                  </button>
                </CardContent>
              </Card>

              {/* Reaction emoji picker — only show if mode = reaction */}
              {mode === "reaction" && (
                <Card className="bg-[#0f1424] border-white/5">
                  <CardHeader className="p-4 pb-3 border-b border-white/5">
                    <CardTitle className="text-sm font-semibold text-white flex items-center gap-2">
                      <Smile className="w-4 h-4 text-pink-400" />
                      Pilih Emoji Reaction
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 space-y-4">
                    {/* Approved */}
                    <div>
                      <p className="text-xs font-medium text-gray-400 mb-2">Saat <span className="text-green-400">Approved</span></p>
                      <div className="flex flex-wrap gap-2">
                        {REACTION_OPTIONS.map(emoji => (
                          <button
                            key={emoji}
                            onClick={() => setReactionApproved(emoji)}
                            className={`w-10 h-10 rounded-xl text-lg flex items-center justify-center transition-all ${
                              reactionApproved === emoji
                                ? "bg-green-500/20 border-2 border-green-500/50 scale-110"
                                : "bg-white/5 border border-white/10 hover:bg-white/10"
                            }`}
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Rejected */}
                    <div>
                      <p className="text-xs font-medium text-gray-400 mb-2">Saat <span className="text-red-400">Rejected</span></p>
                      <div className="flex flex-wrap gap-2">
                        {["❌","👎","🚫","😔","💔","⛔","🙅","😢","❓","🤔","😐","🔴"].map(emoji => (
                          <button
                            key={emoji}
                            onClick={() => setReactionRejected(emoji)}
                            className={`w-10 h-10 rounded-xl text-lg flex items-center justify-center transition-all ${
                              reactionRejected === emoji
                                ? "bg-red-500/20 border-2 border-red-500/50 scale-110"
                                : "bg-white/5 border border-white/10 hover:bg-white/10"
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
