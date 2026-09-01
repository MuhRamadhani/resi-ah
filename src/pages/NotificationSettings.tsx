import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Menu, Bell, MessageSquare, Smile, Loader2, LogOut, Check, Save, ShieldAlert, Phone } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import AdminSidebar from "@/components/AdminSidebar";

type NotifMode = "message" | "reaction" | "hybrid_react_approve" | "hybrid_react_reject";

const APPROVED_EMOJIS = ["❤️", "👍", "✅", "🎉", "💚", "🙏", "⭐", "💯"];
const REJECTED_EMOJIS = ["❌", "👎", "🚫", "😔", "💔", "⛔", "🙅", "🔴"];

const MODES: { value: NotifMode; label: string; sub: string; icon: string; color: string }[] = [
  { value: "message",              label: "Pesan Teks",       sub: "Approve & Reject pakai teks",           icon: "💬", color: "border-purple-500/50 bg-purple-500/10" },
  { value: "reaction",             label: "Reaction Emoji",   sub: "Approve & Reject pakai reaction",       icon: "😊", color: "border-pink-500/50 bg-pink-500/10" },
  { value: "hybrid_react_approve", label: "Hybrid (✅ Reaksi)", sub: "Approve = Reaction · Reject = Teks", icon: "⚡", color: "border-green-500/50 bg-green-500/10" },
  { value: "hybrid_react_reject",  label: "Hybrid (❌ Reaksi)", sub: "Approve = Teks · Reject = Reaction",  icon: "🔀", color: "border-orange-500/50 bg-orange-500/10" },
];

/* ── Reusable emoji row ── */
function EmojiRow({ emojis, selected, onSelect, activeRing }: {
  emojis: string[]; selected: string; onSelect: (e: string) => void; activeRing: string;
}) {
  return (
    <div className="flex gap-1.5">
      {emojis.map((emoji) => (
        <button
          key={emoji}
          onClick={() => onSelect(emoji)}
          className={`flex-1 h-9 rounded-xl text-lg transition-all ${
            selected === emoji
              ? `${activeRing} ring-2 scale-110`
              : "bg-white/5 hover:bg-white/10 border border-white/10"
          }`}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

const NotificationSettings = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Notif biasa
  const [mode, setMode] = useState<NotifMode>("message");
  const [reactionApproved, setReactionApproved] = useState("❤️");
  const [reactionRejected, setReactionRejected] = useState("❌");
  const [messageApproved, setMessageApproved] = useState("Resi Sebesar {nominal} Masuk ✅");
  const [messageRejected, setMessageRejected] = useState("Resi Sebesar {nominal} Tidak Masuk ❌");

  // Auto Reject Duplikat
  const [arNotifyType, setArNotifyType] = useState<"message" | "reaction">("message");
  const [arReaction, setArReaction] = useState("❌");
  const [arMessage, setArMessage] = useState("Resi {nominal} kamu ditolak otomatis karena resi ini sudah pernah digunakan sebelumnya.");
  const [arAdminPhone, setArAdminPhone] = useState("");

  useEffect(() => {
    supabase
      .from("notification_settings")
      .select("mode, reaction_approved, reaction_rejected, message_approved, message_rejected, auto_reject_notify_type, auto_reject_reaction, auto_reject_message, auto_reject_admin_phone")
      .eq("id", "default")
      .single()
      .then(({ data }) => {
        if (data) {
          setMode((data.mode as NotifMode) || "message");
          setReactionApproved(data.reaction_approved || "❤️");
          setReactionRejected(data.reaction_rejected || "❌");
          setMessageApproved(data.message_approved || "Resi Sebesar {nominal} Masuk ✅");
          setMessageRejected(data.message_rejected || "Resi Sebesar {nominal} Tidak Masuk ❌");
          setArNotifyType((data.auto_reject_notify_type as "message" | "reaction") || "message");
          setArReaction(data.auto_reject_reaction || "❌");
          setArMessage(data.auto_reject_message || "Resi {nominal} kamu ditolak otomatis karena resi ini sudah pernah digunakan sebelumnya.");
          setArAdminPhone(data.auto_reject_admin_phone || "");
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
        auto_reject_notify_type: arNotifyType,
        auto_reject_reaction: arReaction,
        auto_reject_message: arMessage,
        auto_reject_admin_phone: arAdminPhone,
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

        <main className="flex-1 p-4 md:p-6 space-y-5 max-w-5xl mx-auto w-full">
          {/* Header */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-purple-500/10 flex items-center justify-center">
              <Bell className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">Pengaturan Notifikasi WA</h1>
              <p className="text-xs text-gray-400">Konfigurasi cara notifikasi Approve/Reject & Auto Reject duplikat</p>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : (
            /* ── 2-column layout ── */
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 items-start">

              {/* ══════════ KIRI: Notif Approve / Reject ══════════ */}
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Bell className="w-4 h-4 text-purple-400" />
                  <h2 className="text-sm font-semibold text-white">Notif Approve / Reject</h2>
                </div>

                {/* Mode selector */}
                <div className="grid grid-cols-2 gap-2">
                  {MODES.map((m) => {
                    const active = mode === m.value;
                    return (
                      <button
                        key={m.value}
                        onClick={() => setMode(m.value)}
                        className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all text-center ${
                          active ? m.color : "border-white/10 bg-white/5 hover:border-white/20"
                        }`}
                      >
                        <span className="text-xl leading-none">{m.icon}</span>
                        <p className={`text-xs font-semibold leading-tight ${active ? "text-white" : "text-gray-300"}`}>{m.label}</p>
                        <p className="text-[10px] text-gray-500 leading-tight">{m.sub}</p>
                        {active && <Check className="w-3 h-3 text-white/60" />}
                      </button>
                    );
                  })}
                </div>

                {/* Mode summary */}
                <div className="rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 text-xs text-gray-400 space-y-0.5">
                  {mode === "message" && <p>✉️ Semua notifikasi dikirim sebagai pesan teks</p>}
                  {mode === "reaction" && <p>😊 Semua notifikasi dikirim sebagai reaction emoji</p>}
                  {mode === "hybrid_react_approve" && <>
                    <p>✅ <span className="text-green-400">Approve</span> → Reaction emoji</p>
                    <p>❌ <span className="text-red-400">Reject</span> → Pesan teks</p>
                  </>}
                  {mode === "hybrid_react_reject" && <>
                    <p>✅ <span className="text-green-400">Approve</span> → Pesan teks</p>
                    <p>❌ <span className="text-red-400">Reject</span> → Reaction emoji</p>
                  </>}
                </div>

                {/* Emoji picker */}
                {(showReactionApproved || showReactionRejected) && (
                  <Card className="bg-[#0f1424] border-white/5">
                    <CardHeader className="p-3 pb-2 border-b border-white/5">
                      <CardTitle className="text-xs font-semibold text-white flex items-center gap-2">
                        <Smile className="w-3.5 h-3.5 text-pink-400" />
                        Pilih Emoji Reaction
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-3 space-y-3">
                      {showReactionApproved && (
                        <div className="space-y-1.5">
                          <p className="text-[11px] text-gray-500">Saat <span className="text-green-400">Approved</span> — terpilih: <span className="text-base">{reactionApproved}</span></p>
                          <EmojiRow emojis={APPROVED_EMOJIS} selected={reactionApproved} onSelect={setReactionApproved} activeRing="bg-green-500/20 ring-green-500/50" />
                        </div>
                      )}
                      {showReactionApproved && showReactionRejected && <div className="h-px bg-white/5" />}
                      {showReactionRejected && (
                        <div className="space-y-1.5">
                          <p className="text-[11px] text-gray-500">Saat <span className="text-red-400">Rejected</span> — terpilih: <span className="text-base">{reactionRejected}</span></p>
                          <EmojiRow emojis={REJECTED_EMOJIS} selected={reactionRejected} onSelect={setReactionRejected} activeRing="bg-red-500/20 ring-red-500/50" />
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* Pesan template */}
                {(showMsgApproved || showMsgRejected) && (
                  <Card className="bg-[#0f1424] border-white/5">
                    <CardHeader className="p-3 pb-2 border-b border-white/5">
                      <CardTitle className="text-xs font-semibold text-white flex items-center gap-2">
                        <MessageSquare className="w-3.5 h-3.5 text-purple-400" />
                        Template Pesan Teks
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-3 space-y-3">
                      <p className="text-[10px] text-gray-500">
                        Gunakan <code className="text-purple-300 bg-purple-500/10 px-1 rounded">{"{nominal}"}</code> untuk jumlah transfer.
                      </p>
                      {showMsgApproved && (
                        <div className="space-y-1">
                          <label className="text-[11px] font-medium text-gray-400 flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" /> Pesan Approved
                          </label>
                          <Textarea value={messageApproved} onChange={(e) => setMessageApproved(e.target.value)} rows={2}
                            className="bg-[#1a1f35] border-white/10 text-white text-xs resize-none focus:border-green-500/40" />
                        </div>
                      )}
                      {showMsgRejected && (
                        <div className="space-y-1">
                          <label className="text-[11px] font-medium text-gray-400 flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-400 inline-block" /> Pesan Rejected
                          </label>
                          <Textarea value={messageRejected} onChange={(e) => setMessageRejected(e.target.value)} rows={2}
                            className="bg-[#1a1f35] border-white/10 text-white text-xs resize-none focus:border-red-500/40" />
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}
              </div>

              {/* ══════════ KANAN: Auto Reject Duplikat ══════════ */}
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-orange-400" />
                  <h2 className="text-sm font-semibold text-white">Auto Reject Duplikat</h2>
                </div>

                <Card className="bg-[#0f1424] border-orange-500/20">
                  <CardHeader className="p-3 pb-2 border-b border-white/5">
                    <CardTitle className="text-xs font-semibold text-white">Notifikasi ke Member</CardTitle>
                    <p className="text-[10px] text-gray-500 mt-1 leading-relaxed">
                      Dikirim saat resi ditolak otomatis — nomor HP + nominal + jam transfer sama dengan resi yang sudah di-Approve sebelumnya.
                    </p>
                  </CardHeader>
                  <CardContent className="p-3 space-y-4">

                    {/* Tipe */}
                    <div className="space-y-1.5">
                      <p className="text-[11px] font-medium text-gray-400">Tipe Notifikasi</p>
                      <div className="grid grid-cols-2 gap-2">
                        {(["reaction", "message"] as const).map((t) => (
                          <button
                            key={t}
                            onClick={() => setArNotifyType(t)}
                            className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-medium transition-all ${
                              arNotifyType === t
                                ? t === "reaction"
                                  ? "border-pink-500/50 bg-pink-500/10 text-white"
                                  : "border-purple-500/50 bg-purple-500/10 text-white"
                                : "border-white/10 bg-white/5 text-gray-400 hover:border-white/20"
                            }`}
                          >
                            {t === "reaction" ? <Smile className="w-3.5 h-3.5" /> : <MessageSquare className="w-3.5 h-3.5" />}
                            {t === "reaction" ? "Reaction" : "Pesan Teks"}
                            {arNotifyType === t && <Check className="w-3 h-3 ml-1" />}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Emoji picker */}
                    {arNotifyType === "reaction" && (
                      <div className="space-y-1.5">
                        <p className="text-[11px] text-gray-500">Emoji — terpilih: <span className="text-base">{arReaction}</span></p>
                        <EmojiRow emojis={REJECTED_EMOJIS} selected={arReaction} onSelect={setArReaction} activeRing="bg-orange-500/20 ring-orange-500/50" />
                      </div>
                    )}

                    {/* Pesan */}
                    {arNotifyType === "message" && (
                      <div className="space-y-1">
                        <label className="text-[11px] font-medium text-gray-400 flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-orange-400 inline-block" /> Pesan ke Member
                        </label>
                        <Textarea value={arMessage} onChange={(e) => setArMessage(e.target.value)} rows={3}
                          className="bg-[#1a1f35] border-white/10 text-white text-xs resize-none focus:border-orange-500/40"
                          placeholder="Resi {nominal} kamu ditolak otomatis..." />
                        <p className="text-[10px] text-gray-600">
                          Gunakan <code className="text-orange-300 bg-orange-500/10 px-1 rounded">{"{nominal}"}</code> untuk jumlah transfer.
                        </p>
                      </div>
                    )}

                    <div className="h-px bg-white/5" />

                    {/* Admin phone */}
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-medium text-gray-300 flex items-center gap-1.5">
                        <Phone className="w-3 h-3 text-orange-400" />
                        No HP Admin (Tag di Group)
                      </label>
                      <Input
                        value={arAdminPhone}
                        onChange={(e) => setArAdminPhone(e.target.value)}
                        className="bg-[#1a1f35] border-white/10 text-white text-xs h-8 focus:border-orange-500/40"
                        placeholder="628123456789 (kosongkan jika tidak perlu)"
                      />
                      <p className="text-[10px] text-gray-600">
                        Jika diisi, admin akan di-mention di group saat ada resi duplikat masuk.
                      </p>
                    </div>

                  </CardContent>
                </Card>

                {/* Info box */}
                <div className="rounded-xl bg-orange-500/5 border border-orange-500/20 p-3 space-y-1.5 text-[11px] text-gray-400">
                  <p className="font-semibold text-orange-300">Auto Reject aktif jika:</p>
                  <p>• Nomor HP sama</p>
                  <p>• Nominal sama</p>
                  <p>• Jam transfer sama persis</p>
                  <p>• Resi sudah di-Approve di hari sebelumnya</p>
                </div>
              </div>

            </div>
          )}

          {/* Save button */}
          {!loading && (
            <Button
              onClick={handleSave}
              disabled={saving}
              className="w-full h-11 bg-purple-600 hover:bg-purple-700 text-white gap-2"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Simpan Semua Pengaturan
            </Button>
          )}
        </main>
      </div>
    </div>
  );
};

export default NotificationSettings;
