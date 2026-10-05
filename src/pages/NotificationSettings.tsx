import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Menu, Bell, MessageSquare, Smile, Loader2, LogOut, Check, Save, ShieldAlert, Phone, WifiOff, RefreshCw, SendHorizonal, AlertTriangle } from "lucide-react";
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

  // Alert disconnect WA
  const [adminAlertPhone, setAdminAlertPhone] = useState("");

  // ── Notifikasi Nyangkut ──────────────────────────────────────────────────
  type StuckReceipt = { id: string; nama: string | null; nominal: number | null; approved_at: string | null; msg_count: number };
  const [stuckReceipts, setStuckReceipts] = useState<StuckReceipt[]>([]);
  const [stuckLoading, setStuckLoading] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryProgress, setRetryProgress] = useState(0);
  const [retryDone, setRetryDone] = useState<{ sent: number; failed: number } | null>(null);

  const loadStuck = useCallback(async () => {
    setStuckLoading(true);
    setRetryDone(null);
    try {
      // Query langsung: wa_messages yang reacted_at IS NULL + receipt masih Approved
      // Batasi ke 4 hari terakhir (sama dengan window cleanup otomatis)
      const since = new Date();
      since.setDate(since.getDate() - 4);
      since.setHours(0, 0, 0, 0);

      const { data: msgs } = await supabase
        .from("receipt_wa_messages")
        .select("receipt_id")
        .is("reacted_at", null)
        .gte("created_at", since.toISOString());

      if (!msgs || msgs.length === 0) { setStuckReceipts([]); setStuckLoading(false); return; }

      // Group by receipt_id untuk hitung jumlah msg nyangkut
      const countMap = new Map<string, number>();
      for (const m of msgs) countMap.set(m.receipt_id, (countMap.get(m.receipt_id) ?? 0) + 1);
      const receiptIds = Array.from(countMap.keys());

      const { data: receipts } = await supabase
        .from("receipts")
        .select("id, nama, nominal, approved_at")
        .in("id", receiptIds)
        .eq("status", "Approved")
        .order("approved_at", { ascending: false })
        .limit(30);

      if (!receipts) { setStuckReceipts([]); setStuckLoading(false); return; }

      setStuckReceipts(receipts.map((r: any) => ({
        id: r.id,
        nama: r.nama,
        nominal: r.nominal,
        approved_at: r.approved_at,
        msg_count: countMap.get(r.id) ?? 0,
      })));
    } catch (e) {
      console.error("loadStuck error", e);
    }
    setStuckLoading(false);
  }, []);

  const handleRetryAll = async () => {
    if (stuckReceipts.length === 0 || retrying) return;
    setRetrying(true);
    setRetryProgress(0);
    setRetryDone(null);

    let totalSent = 0;
    let totalFailed = 0;

    for (let i = 0; i < stuckReceipts.length; i++) {
      const r = stuckReceipts[i];
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        const SUPABASE_URL = (supabase as any).supabaseUrl as string;
        const res = await fetch(`${SUPABASE_URL}/functions/v1/send-wa-notification`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ status: "Approved", receipt_id: r.id }),
        });
        const json = await res.json().catch(() => ({}));
        totalSent   += json.sent   ?? 0;
        totalFailed += json.failed ?? 0;
      } catch {
        totalFailed++;
      }
      setRetryProgress(Math.round(((i + 1) / stuckReceipts.length) * 100));
    }

    setRetryDone({ sent: totalSent, failed: totalFailed });
    setRetrying(false);
  };

  useEffect(() => {
    supabase
      .from("notification_settings")
      .select("mode, reaction_approved, reaction_rejected, message_approved, message_rejected, auto_reject_notify_type, auto_reject_reaction, auto_reject_message, auto_reject_admin_phone, admin_alert_phone")
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
          setAdminAlertPhone((data as any).admin_alert_phone || "");
        }
        setLoading(false);
      });
  }, []);

  useEffect(() => { loadStuck(); }, [loadStuck]);

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
        admin_alert_phone: adminAlertPhone,
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
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Bell className="w-4 h-4 text-purple-400" />
                  <h2 className="text-sm font-semibold text-white">Notif Approve / Reject</h2>
                </div>

                <Card className="bg-[#0f1424] border-white/5">
                  <CardContent className="p-4 space-y-4">

                    {/* Mode selector — horizontal pill list */}
                    <div className="grid grid-cols-2 gap-2">
                      {MODES.map((m) => {
                        const active = mode === m.value;
                        return (
                          <button
                            key={m.value}
                            onClick={() => setMode(m.value)}
                            className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-left transition-all ${
                              active ? m.color : "border-white/10 bg-white/5 hover:border-white/20"
                            }`}
                          >
                            <span className="text-lg leading-none shrink-0">{m.icon}</span>
                            <div className="min-w-0">
                              <p className={`text-xs font-semibold truncate ${active ? "text-white" : "text-gray-300"}`}>{m.label}</p>
                              <p className="text-[10px] text-gray-500 truncate">{m.sub}</p>
                            </div>
                            {active && <Check className="w-3.5 h-3.5 text-white/70 ml-auto shrink-0" />}
                          </button>
                        );
                      })}
                    </div>

                    {/* Mode summary pill */}
                    <div className="flex flex-wrap gap-2 text-[11px]">
                      {mode === "message" && <span className="px-2 py-1 rounded-full bg-purple-500/10 text-purple-300 border border-purple-500/20">✉️ Semua pakai pesan teks</span>}
                      {mode === "reaction" && <span className="px-2 py-1 rounded-full bg-pink-500/10 text-pink-300 border border-pink-500/20">😊 Semua pakai reaction emoji</span>}
                      {mode === "hybrid_react_approve" && <>
                        <span className="px-2 py-1 rounded-full bg-green-500/10 text-green-300 border border-green-500/20">✅ Approve → Reaction</span>
                        <span className="px-2 py-1 rounded-full bg-red-500/10 text-red-300 border border-red-500/20">❌ Reject → Teks</span>
                      </>}
                      {mode === "hybrid_react_reject" && <>
                        <span className="px-2 py-1 rounded-full bg-green-500/10 text-green-300 border border-green-500/20">✅ Approve → Teks</span>
                        <span className="px-2 py-1 rounded-full bg-red-500/10 text-red-300 border border-red-500/20">❌ Reject → Reaction</span>
                      </>}
                    </div>

                    {/* Emoji picker */}
                    {(showReactionApproved || showReactionRejected) && (
                      <div className="space-y-3 pt-1 border-t border-white/5">
                        <p className="text-[11px] font-medium text-gray-400 flex items-center gap-1.5 pt-1">
                          <Smile className="w-3.5 h-3.5 text-pink-400" /> Pilih Emoji Reaction
                        </p>
                        {showReactionApproved && (
                          <div className="space-y-1.5">
                            <p className="text-[10px] text-gray-500">Approved — terpilih: <span className="text-sm">{reactionApproved}</span></p>
                            <EmojiRow emojis={APPROVED_EMOJIS} selected={reactionApproved} onSelect={setReactionApproved} activeRing="bg-green-500/20 ring-green-500/50" />
                          </div>
                        )}
                        {showReactionRejected && (
                          <div className="space-y-1.5">
                            <p className="text-[10px] text-gray-500">Rejected — terpilih: <span className="text-sm">{reactionRejected}</span></p>
                            <EmojiRow emojis={REJECTED_EMOJIS} selected={reactionRejected} onSelect={setReactionRejected} activeRing="bg-red-500/20 ring-red-500/50" />
                          </div>
                        )}
                      </div>
                    )}

                    {/* Pesan template */}
                    {(showMsgApproved || showMsgRejected) && (
                      <div className="space-y-3 pt-1 border-t border-white/5">
                        <p className="text-[11px] font-medium text-gray-400 flex items-center gap-1.5 pt-1">
                          <MessageSquare className="w-3.5 h-3.5 text-purple-400" /> Template Pesan Teks
                          <span className="ml-auto text-[10px] text-gray-600 font-normal">
                            Gunakan <code className="text-purple-300 bg-purple-500/10 px-1 rounded">{"{nominal}"}</code>
                          </span>
                        </p>
                        {showMsgApproved && (
                          <div className="space-y-1">
                            <label className="text-[10px] text-gray-500 flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" /> Pesan Approved
                            </label>
                            <Textarea value={messageApproved} onChange={(e) => setMessageApproved(e.target.value)} rows={2}
                              className="bg-[#1a1f35] border-white/10 text-white text-xs resize-none focus:border-green-500/40" />
                          </div>
                        )}
                        {showMsgRejected && (
                          <div className="space-y-1">
                            <label className="text-[10px] text-gray-500 flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-red-400 inline-block" /> Pesan Rejected
                            </label>
                            <Textarea value={messageRejected} onChange={(e) => setMessageRejected(e.target.value)} rows={2}
                              className="bg-[#1a1f35] border-white/10 text-white text-xs resize-none focus:border-red-500/40" />
                          </div>
                        )}
                      </div>
                    )}

                  </CardContent>
                </Card>
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

          {/* ── Alert Disconnect WA ── */}
          {!loading && (
            <div className="pt-2">
              <div className="flex items-center gap-2 mb-3">
                <div className="h-px flex-1 bg-white/10" />
                <span className="text-[11px] text-gray-500 uppercase tracking-widest font-semibold">Alert Koneksi WA</span>
                <div className="h-px flex-1 bg-white/10" />
              </div>

              <Card className="bg-[#0f1424] border-red-500/20">
                <CardHeader className="p-4 pb-3 border-b border-white/5">
                  <CardTitle className="text-sm font-semibold text-white flex items-center gap-2">
                    <WifiOff className="w-4 h-4 text-red-400" />
                    Notif saat WA Instance Terputus
                  </CardTitle>
                  <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">
                    Saat koneksi WA instance terputus, sistem akan otomatis mengirim pesan peringatan ke nomor HP di bawah.
                  </p>
                </CardHeader>
                <CardContent className="p-4 space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-gray-300 flex items-center gap-1.5">
                      <Phone className="w-3 h-3 text-red-400" />
                      No HP Admin (penerima alert)
                    </label>
                    <Input
                      value={adminAlertPhone}
                      onChange={(e) => setAdminAlertPhone(e.target.value)}
                      className="bg-[#1a1f35] border-white/10 text-white text-sm h-9 focus:border-red-500/40"
                      placeholder="628123456789 (kosongkan untuk nonaktifkan)"
                    />
                  </div>
                  {adminAlertPhone && (
                    <div className="rounded-lg bg-red-500/5 border border-red-500/20 p-3 text-[11px] text-gray-400 space-y-1">
                      <p className="text-red-300 font-semibold">Preview pesan yang dikirim:</p>
                      <p className="text-gray-300 whitespace-pre-line leading-relaxed">
                        {`⚠️ WA Instance Alert\n\nInstance [nama] mengalami gangguan koneksi.\nStatus: Terputus ❌\n\nSilakan cek halaman WA Connection di dashboard.`}
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
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

          {/* ── Notifikasi Nyangkut ── */}
          {!loading && (
            <div className="pt-2">
              <div className="flex items-center gap-2 mb-3">
                <div className="h-px flex-1 bg-white/10" />
                <span className="text-[11px] text-gray-500 uppercase tracking-widest font-semibold">Notifikasi Nyangkut</span>
                <div className="h-px flex-1 bg-white/10" />
              </div>

              <Card className="bg-[#0f1424] border-yellow-500/20">
                <CardHeader className="p-4 pb-3 border-b border-white/5">
                  <CardTitle className="text-sm font-semibold text-white flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-yellow-400" />
                    Ulangi Notif WA yang Belum Terkirim
                  </CardTitle>
                  <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">
                    Daftar resi Approved yang punya pesan WA terdaftar — klik tombol untuk kirim ulang reaksi/pesan ke semua grup.
                  </p>
                </CardHeader>
                <CardContent className="p-4 space-y-4">

                  {/* Header row: jumlah + refresh */}
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-400">
                      {stuckLoading ? "Memuat…" : `${stuckReceipts.length} resi ditemukan`}
                    </span>
                    <button
                      onClick={loadStuck}
                      disabled={stuckLoading || retrying}
                      className="text-gray-500 hover:text-gray-300 transition-colors disabled:opacity-40"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${stuckLoading ? "animate-spin" : ""}`} />
                    </button>
                  </div>

                  {/* List */}
                  {!stuckLoading && stuckReceipts.length > 0 && (
                    <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                      {stuckReceipts.map((r) => (
                        <div key={r.id} className="flex items-center justify-between rounded-lg bg-white/5 border border-white/5 px-3 py-2 text-xs">
                          <div className="min-w-0">
                            <p className="text-white font-medium truncate">{r.nama ?? "—"}</p>
                            <p className="text-gray-500">
                              Rp {Number(r.nominal ?? 0).toLocaleString("id-ID")}
                              {r.approved_at && (
                                <> · {new Date(r.approved_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}</>
                              )}
                            </p>
                          </div>
                          <span className="ml-3 shrink-0 text-[10px] text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 rounded-full px-2 py-0.5">
                            {r.msg_count} msg
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {!stuckLoading && stuckReceipts.length === 0 && (
                    <p className="text-xs text-gray-600 text-center py-3">Tidak ada notifikasi nyangkut 🎉</p>
                  )}

                  {/* Progress bar */}
                  {retrying && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs text-gray-400">
                        <span>Mengirim ulang notifikasi…</span>
                        <span className="font-medium text-yellow-400">{retryProgress}%</span>
                      </div>
                      <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-yellow-500 transition-all duration-300 ease-out"
                          style={{ width: `${retryProgress}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Result */}
                  {retryDone && !retrying && (
                    <div className={`rounded-lg border px-3 py-2 text-xs ${retryDone.failed === 0 ? "bg-green-500/10 border-green-500/20 text-green-300" : "bg-yellow-500/10 border-yellow-500/20 text-yellow-300"}`}>
                      ✅ Terkirim: <strong>{retryDone.sent}</strong>
                      {retryDone.failed > 0 && <> · ❌ Gagal: <strong>{retryDone.failed}</strong></>}
                    </div>
                  )}

                  {/* Button */}
                  <Button
                    onClick={handleRetryAll}
                    disabled={retrying || stuckLoading || stuckReceipts.length === 0}
                    className="w-full h-10 bg-yellow-600 hover:bg-yellow-700 text-white gap-2 text-sm"
                  >
                    {retrying
                      ? <><Loader2 className="w-4 h-4 animate-spin" /> Mengirim… {retryProgress}%</>
                      : <><SendHorizonal className="w-4 h-4" /> Kirim Ulang Reaksi Semua</>}
                  </Button>

                </CardContent>
              </Card>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default NotificationSettings;
