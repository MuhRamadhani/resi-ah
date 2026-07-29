# Panduan Migrasi: WasenderAPI → Evolution Manager

## Ringkasan Perubahan

| File | Status |
|------|--------|
| `supabase/functions/_shared/evolution.ts` | ✅ Dibuat baru |
| `supabase/functions/wa-webhook/index.ts` | ✅ Diupdate |
| `supabase/functions/wa-queue-worker/index.ts` | ✅ Diupdate |
| `supabase/functions/create-groups/index.ts` | ✅ Diupdate |
| `.env` | ✅ Ditambah config Evolution |

---

## Step 1: Set Secrets di Supabase

Supabase Edge Functions membaca env dari secrets, **bukan** dari `.env`. Jalankan perintah ini di terminal:

```bash
cd resi-ah

# Set secrets Evolution API
supabase secrets set EVOLUTION_BASE_URL="https://your-evolution-api.com"
supabase secrets set EVOLUTION_API_KEY="your-api-key-here"
supabase secrets set EVOLUTION_INSTANCE_NAME="your-instance-name"
supabase secrets set EVOLUTION_WEBHOOK_SECRET="isi-jika-ingin-validasi-secret"
supabase secrets set EVOLUTION_BOT_PHONE="628xxxxxxxxxx"

# Verifikasi secrets sudah tersimpan
supabase secrets list
```

> **Catatan:** Ganti nilai di atas dengan data Evolution API Anda yang sebenarnya.

---

## Step 2: Deploy Edge Functions

```bash
cd resi-ah

# Deploy semua function sekaligus
supabase functions deploy wa-webhook
supabase functions deploy wa-queue-worker
supabase functions deploy create-groups
```

---

## Step 3: Konfigurasi Webhook di Evolution Manager

1. Buka dashboard Evolution Manager Anda
2. Pilih instance yang aktif
3. Masuk ke menu **Webhook** / **Settings**
4. Set Webhook URL ke:
   ```
   https://ytsvvbbsrnoxwlsbaoja.supabase.co/functions/v1/wa-webhook
   ```
5. Aktifkan events berikut:
   - ✅ `messages.upsert`
   - ✅ `group-participants.update`
6. Jika menggunakan webhook secret, isi field **Secret/Token** dengan nilai `EVOLUTION_WEBHOOK_SECRET`
7. Simpan konfigurasi

---

## Step 4: Konfigurasi Webhook Header (Opsional)

Jika Evolution API Anda dikonfigurasi dengan webhook secret, pastikan header yang dikirim adalah salah satu dari:
- `x-evolution-token: <secret>`
- `Authorization: Bearer <secret>`

---

## Perbedaan Teknis: WasenderAPI vs Evolution API

### Endpoint Mapping

| Fungsi | WasenderAPI | Evolution API |
|--------|-------------|---------------|
| Send text | `POST /send-message` | `POST /message/sendText/{instance}` |
| Send image | `POST /send-message` | `POST /message/sendMedia/{instance}` |
| Send mentions | `POST /send-message` | `POST /message/sendText/{instance}` |
| Decrypt media | `POST /decrypt-media` | `POST /chat/getBase64FromMediaMessage/{instance}` |
| Create group | `POST /groups` | `POST /group/create/{instance}` |
| Group metadata | `GET /groups/{jid}/metadata` | `GET /group/findGroupById/{instance}?id={jid}` |
| Group participants | `GET /groups/{jid}/participants` | `GET /group/findGroupById/{instance}?id={jid}` |
| Add participant | `POST /groups/{jid}/participants/add` | `POST /group/updateParticipant/{instance}` |
| Remove participant | `POST /groups/{jid}/participants/remove` | `POST /group/updateParticipant/{instance}` |
| Promote participant | `PUT /groups/{jid}/participants/update` | `POST /group/updateParticipant/{instance}` |
| Group settings | `PUT /groups/{jid}/settings` | `PATCH /group/updateSetting/{instance}` |

### Autentikasi

| WasenderAPI | Evolution API |
|-------------|---------------|
| `Authorization: Bearer <key>` | `apikey: <key>` |

### Format Data Pesan Webhook

**WasenderAPI** (array di `data.messages`):
```json
{
  "event": "messages.upsert",
  "data": {
    "messages": [
      {
        "key": { "id": "...", "remoteJid": "...", "fromMe": false, "participant": "..." },
        "message": { "conversation": "teks pesan" },
        "pushName": "Nama",
        "messageBody": "teks pesan",
        "cleanedSenderPn": "628xxx"
      }
    ]
  }
}
```

**Evolution API** (single object di `data`):
```json
{
  "event": "messages.upsert",
  "instance": "nama-instance",
  "data": {
    "key": { "id": "...", "remoteJid": "...", "fromMe": false, "participant": "628xxx@s.whatsapp.net" },
    "message": { "conversation": "teks pesan" },
    "pushName": "Nama",
    "messageType": "conversation",
    "messageTimestamp": 1234567890
  }
}
```

### Format Data Peserta Grup

**WasenderAPI:**
```json
{
  "cleanedParticipantPn": "628xxx",
  "pn": "628xxx@s.whatsapp.net",
  "admin": "superadmin"
}
```

**Evolution API:**
```json
{
  "id": "628xxx@s.whatsapp.net",
  "admin": "superadmin"
}
```

### Perbedaan Media Handling

- **WasenderAPI:** `decryptMedia` mengembalikan URL publik yang bisa di-fetch
- **Evolution API:** `getBase64FromMediaMessage` mengembalikan data base64

Perubahan ini sudah ditangani di `wa-webhook/index.ts` — gambar langsung dikonversi dari base64 ke `Uint8Array` tanpa perlu download URL terpisah.

---

## Environment Variables Lengkap

### Yang Dibutuhkan (wajib diset via `supabase secrets set`):

```
EVOLUTION_BASE_URL       = URL server Evolution API Anda (contoh: https://evo.myserver.com)
EVOLUTION_API_KEY        = API Key dari Evolution Manager
EVOLUTION_INSTANCE_NAME  = Nama instance WhatsApp di Evolution Manager
SUPABASE_URL             = (sudah ada)
SUPABASE_SERVICE_ROLE_KEY = (sudah ada)
```

### Opsional:

```
EVOLUTION_WEBHOOK_SECRET = Secret untuk validasi webhook (kosongkan jika tidak dipakai)
EVOLUTION_BOT_PHONE      = Nomor HP bot format internasional (628xxx) untuk filter mention
```

---

## Verifikasi Migrasi

1. **Test webhook aktif:**
   ```
   GET https://ytsvvbbsrnoxwlsbaoja.supabase.co/functions/v1/wa-webhook
   ```
   Response: `{ "status": "active", "service": "wa-webhook-evolution" }`

2. **Kirim pesan ke grup** → pastikan resi diterima di dashboard

3. **Test command bot** (ketik di grup WhatsApp):
   - `.refreshgroup` → sync member
   - `.h test` → hidden tag semua member

4. **Cek Supabase Function Logs** di dashboard Supabase untuk melihat log detail

---

## Rollback (Jika Perlu)

Jika ada masalah, file `_shared/wasender.ts` masih ada. Untuk rollback:

1. Ubah kembali semua import dari `evolution.ts` ke `wasender.ts`
2. Set kembali secrets WasenderAPI:
   ```bash
   supabase secrets set WASENDER_API_KEY="..."
   supabase secrets set WASENDER_WEBHOOK_SECRET="..."
   ```
3. Ubah URL webhook di panel WasenderAPI kembali ke URL Supabase Anda