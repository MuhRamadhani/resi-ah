/**
 * wa-instance — Proxy ke WasenderAPI untuk manajemen session WhatsApp.
 *
 * Actions (body._action):
 *   "state"          → GET  /api/status                            (status session aktif)
 *   "fetchInstances" → GET  /api/whatsapp-sessions                 (list semua session)
 *   "connect"        → POST /api/whatsapp-sessions/{id}/connect    (+ QR string → image base64)
 *   "qrcode"         → GET  /api/whatsapp-sessions/{id}/qrcode     (refresh QR)
 *   "restart"        → POST /api/whatsapp-sessions/{id}/restart
 *   "logout"         → POST /api/whatsapp-sessions/{id}/disconnect (Wasender tidak punya logout)
 *   "delete"/"create" → tetap manual via dashboard WasenderAPI
 *
 * Auth: endpoint /api/whatsapp-sessions/* itu account-level → butuh Personal
 * Access Token (secret WASENDER_PAT). /api/status terikat ke session → pakai
 * session API key (WASENDER_API_KEY). Kalau WASENDER_PAT belum di-set, fallback
 * ke WASENDER_API_KEY dan 401-nya dilaporkan apa adanya ke dashboard.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { qrcode } from "https://deno.land/x/qrcode@v2.0.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BASE_URL = "https://www.wasenderapi.com";

const API_KEY = Deno.env.get("WASENDER_API_KEY") || "";
const RAW_PAT = Deno.env.get("WASENDER_PAT") || "";
const PAT = RAW_PAT || API_KEY;

const PAT_HINT =
  "Endpoint manajemen session butuh Personal Access Token. Tambahkan secret " +
  "WASENDER_PAT di Supabase (Edge Functions → Secrets), tokennya dari " +
  "WasenderAPI → Settings → Personal Access Token.";

// Session id di-cache per isolate biar tidak list ulang tiap request.
let cachedSessionId: string | number | null = null;

type WsRes = { status: number; ok: boolean; json: any };

async function wsFetch(
  path: string,
  opts: { method?: string; token?: string; body?: unknown } = {},
): Promise<WsRes> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: opts.method || "GET",
    headers: {
      "Authorization": `Bearer ${opts.token ?? PAT}`,
      "Content-Type": "application/json",
    },
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
  });
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, ok: res.ok, json };
}

/** Pesan error yang kebaca manusia dari response WasenderAPI. */
function wsError(r: WsRes, fallback: string): string {
  const j = r.json || {};
  const msg = String(j.message || j.error || (typeof j.raw === "string" ? j.raw.slice(0, 200) : ""))
    .trim().replace(/\.+$/, "");
  const base = msg || `${fallback} (HTTP ${r.status})`;
  if (r.status === 401 && !RAW_PAT) return `${base}. ${PAT_HINT}`;
  return base;
}

function envelope(data: unknown, status = 200) {
  return new Response(
    JSON.stringify({ evolutionStatus: status, data }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

function fail(message: string, status = 400) {
  return envelope({ message }, status);
}

async function listSessions(): Promise<{ sessions: any[]; err?: string }> {
  const r = await wsFetch("/api/whatsapp-sessions");
  if (!r.ok) return { sessions: [], err: wsError(r, "Gagal ambil daftar session") };
  const raw = r.json?.data ?? r.json;
  return { sessions: Array.isArray(raw) ? raw : raw ? [raw] : [] };
}

/** Resolve id session aktif (pakai session pertama di akun). */
async function resolveSessionId(): Promise<{ id?: string | number; err?: string }> {
  if (cachedSessionId !== null) return { id: cachedSessionId };
  const { sessions, err } = await listSessions();
  if (err) return { err };
  const id = sessions[0]?.id;
  if (id === undefined || id === null) {
    return { err: "Tidak ada WhatsApp session di akun WasenderAPI ini." };
  }
  cachedSessionId = id;
  return { id };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (!API_KEY && !RAW_PAT) {
    return fail("WASENDER_API_KEY / WASENDER_PAT belum dikonfigurasi.", 500);
  }

  const body = await req.json().catch(() => ({}));
  const action = body._action || "state";

  try {
    // ── Status session aktif ──
    if (action === "state") {
      const r = await wsFetch("/api/status", { token: API_KEY || PAT });
      let raw = typeof r.json?.status === "string" ? r.json.status : "";

      // /api/status butuh session yang sudah pernah di-init. Kalau kosong,
      // jatuh ke status dari daftar session.
      if (!raw) {
        const { sessions, err } = await listSessions();
        if (!sessions.length) return fail(err || wsError(r, "Gagal cek status"), 502);
        raw = String(sessions[0]?.status || "");
      }

      return envelope({ state: raw.toLowerCase(), raw: r.json });
    }

    // ── Daftar semua session ──
    if (action === "fetchInstances") {
      const { sessions, err } = await listSessions();
      if (err) return fail(err, 502);
      return envelope({
        instances: sessions.map((s: any) => {
          const st = String(s.status || "unknown").toLowerCase();
          return {
            // frontend baca `name` + `connectionStatus`
            name: s.name || s.phone_number || `session-${s.id}`,
            connectionStatus: st,
            phone_number: s.phone_number || "",
            id: s.id,
          };
        }),
      });
    }

    // ── Connect / ambil QR ──
    if (action === "connect" || action === "qrcode") {
      const { id, err } = await resolveSessionId();
      if (err) return fail(err, 502);

      let status = "";
      let qrString = "";

      if (action === "connect") {
        const r = await wsFetch(`/api/whatsapp-sessions/${id}/connect`, {
          method: "POST",
          body: { linkMethod: "qr" },
        });
        if (!r.ok) return fail(wsError(r, "Gagal connect session"), r.status);
        status = String(r.json?.data?.status || "");
        qrString = String(r.json?.data?.qrCode || "");
      }

      // QR belum ikut di response connect → tarik dari endpoint qrcode.
      if (!qrString) {
        const q = await wsFetch(`/api/whatsapp-sessions/${id}/qrcode`);
        if (q.ok) qrString = String(q.json?.data?.qrCode || "");
        else if (action === "qrcode") return fail(wsError(q, "Gagal ambil QR code"), q.status);
      }

      if (!qrString) {
        const s = status.toLowerCase();
        if (s === "connected") return fail("Session sudah terhubung, tidak perlu scan QR.", 409);
        if (s === "need_passkey") return fail("Session minta Passkey, bukan QR. Approve lewat Device Link Helper.", 409);
        return fail(`QR code belum tersedia${status ? ` (status: ${status})` : ""}. Coba lagi beberapa detik.`, 502);
      }

      // qrCode dari WasenderAPI itu string QR mentah → render jadi image.
      const dataUrl = await qrcode(qrString, { size: 400 });
      return envelope({ base64: dataUrl, qrCode: qrString, status });
    }

    // ── Restart (soft restart, session harus connected) ──
    if (action === "restart") {
      const { id, err } = await resolveSessionId();
      if (err) return fail(err, 502);
      const r = await wsFetch(`/api/whatsapp-sessions/${id}/restart`, { method: "POST" });
      if (!r.ok) return fail(wsError(r, "Gagal restart session"), r.status);
      return envelope({ message: r.json?.message || "Session di-restart.", raw: r.json });
    }

    // ── Logout → WasenderAPI pakai disconnect ──
    if (action === "logout") {
      const { id, err } = await resolveSessionId();
      if (err) return fail(err, 502);
      const r = await wsFetch(`/api/whatsapp-sessions/${id}/disconnect`, { method: "POST" });
      if (!r.ok) return fail(wsError(r, "Gagal disconnect session"), r.status);
      return envelope({
        message: r.json?.data?.message || "Session di-disconnect.",
        status: r.json?.data?.status || "disconnected",
      });
    }

    // ── Masih manual via dashboard (jangan pura-pura sukses) ──
    if (action === "delete" || action === "create") {
      return fail(
        `Action "${action}" dikelola manual lewat dashboard WasenderAPI: https://www.wasenderapi.com`,
        501,
      );
    }

    return fail(`Unknown action: ${action}`, 400);
  } catch (e) {
    console.error(`[wa-instance] ${action} error:`, e);
    return fail(e instanceof Error ? e.message : "unknown error", 500);
  }
});
