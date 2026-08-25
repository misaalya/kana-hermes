# Kana Remediation Plan

Dokumen ini menggantikan roadmap produk lama. Sumbernya adalah audit menyeluruh
2026-08-25 atas seluruh codebase (controller, agent client, bridge server,
runtime Hermes, TTS relay, auth/persistence, React layer) yang diverifikasi
silang dengan source Hermes terpasang di `/home/kenobu/.hermes/hermes-agent`.

Konteks: pemilik menambal kode sepanjang hari dan banyak bug tersisa, sebagian
muncul setelah pindah mesin. Aplikasi didesain untuk di-deploy di VPS (satu
user), sehingga bug akibat perbedaan mesin harus minimal. Keluhan utama:
resume sering mengembalikan transcript kosong/error, caching sisa bermasalah,
dan pemanfaatan React (state management) masih lemah.

Terakhir diperbarui: 2026-08-25.

---

## 1. Ringkasan eksekutif — root cause terkonfirmasi

| ID | Root cause | Bukti | Dampak |
| --- | --- | --- | --- |
| RC-1 | `fetchHistory` mengirim **durable key** ke `session.history`, padahal Hermes hanya menerima **runtime session id** (`_sessions` map berisi uuid acak) | `lib/agent/hermes/hermes-agent-client.ts:395-418`, `use-kana-controller.ts:383`; Hermes: `tui_gateway/server.py:2386` + `methods_session.py:2444` | Resume hampir selalu error 4001 "session not found", `.catch` menelannya → **transcript kosong** |
| RC-2 | Proyeksi `_history_to_messages` Hermes **tidak memuat timestamp**; Kana mengalikan `row.timestamp * 1000` yang selalu undefined → fallback `Date.now()` | Hermes `server.py:7254-7267`; Kana `use-kana-controller.ts:412-415` | Anchor aktivitas hasil rekonstruksi ≠ anchor live turn → blok tool duplikat/misposisi antar browser |
| RC-3 | Data dir terpecah 3 root (`$CWD/data`, `$HOME/.kana`, XDG) tanpa `KANA_DATA_DIR` yang diteruskan launcher | `password-store.ts:12-18`, `session.ts:24-34`, `activity-store.ts:29-35`, `bin/kana.mjs:100-107` | Pindah mesin/redeploy = password hash tertinggal, JWT regenerasi, **activities.db hilang** (terbukti: `~/.kana` tidak ada di mesin ini) |
| RC-4 | Auth bisa silent-off: `.env.production` kosong & ter-commit, tanpa `auth.json` → `isAuthEnabled()` false | `password-store.ts:27-29`, `proxy.ts:49-59` | VPS publik terbuka tanpa login. Bonus: `.env.development` berisi password asli di git |
| RC-5 | Relay TTS tidak punya route cancel; abort browser tidak diteruskan upstream; delete voice clone salah mapping path/query | provider `qwen3-tts-provider.ts:248-254`; `app/api/voice/tts/` (tanpa `[voiceId]`); `speech/route.ts:20-25` | Stop tidak menghentikan sintesis CPU (sampai 300 s), fitur delete voice mati total |
| RC-6 | God-hook 1.931 baris dengan ref paralel, subscription stale, cache module-level, debug overlay di production | `use-kana-controller.ts` (60, 895-925, 946-985), `memory-conversation-store.ts:22-38`, `kana-app.tsx:153-164, 291-295` | Bug stale-state halus, keystroke me-re-run seluruh hook, cache basi antar mesin |

Fakta kunci yang membuat fix RC-1 mudah: **`session.resume` sudah
mengembalikan seluruh transcript** (`messages`) dalam responsnya
(`methods_session.py:556-572`). Tidak perlu RPC kedua.

---

## 2. Aturan main (tidak bisa ditawar)

Sumber lengkap: `AGENTS.md`. Poin kritis untuk pekerjaan ini:

1. Tidak memodifikasi `/home/kenobu/.local/bin/hermes` maupun
   `/home/kenobu/.hermes/hermes-agent`. Semua fix dilakukan di sisi Kana.
2. Hermes tetap satu-satunya agent. Tidak ada LLM/loop/tool runner kedua.
3. `speech_ja` selalu Jepang; subtitle historis tidak pernah diretranslate.
4. Integrasi gagal secara jujur saat service eksternal tidak ada.
5. Sebelum coding, baca guide Next.js terpasang di `node_modules/next/dist/docs/`.
6. Test Hermes memakai `hermes serve` temporary di port non-default,
   session test `source: "kana"`, bersihkan hanya data test sendiri.
7. Handoff wajib lulus: `npm run lint && npx tsc --noEmit && npm run build`.

---

## 3. Peta workstream & paralelisasi

Empat track yang saling lepas berdasarkan **file yang disentuh**. Track dalam
kolom yang sama aman dikerjakan subagent berbeda secara bersamaan.

```
Track 1 (Hermes/resume) : R1 -> A1 -> A2 -> A3 -> A4     [use-kana-controller.ts,
                                                          hermes-agent-client.ts]
Track 2 (TTS/voice)     : D1 .. D9 (bebas urut)           [lib/voice/*, app/api/voice/*,
                                                          lib/server/local-qwen3-tts-runtime.ts]
Track 3 (Server/data)   : B1 -> B2 -> C1 -> C2 -> C3      [lib/server/auth/*, activity-store.ts,
                                                          proxy.ts, .env*, bin/kana.mjs, docs]
Track 4 (React refactor): E1 -> E2 -> E3 -> E4 -> E5 -> E6 [components/kana/*, lib/state/*]

Aturan dependensi antar track:
- Track 4 HARUS menunggu Track 1 selesai (sama-sama menulis
  use-kana-controller.ts; refactor di atas bug = refactor bug).
- Track 2 dan Track 3 bebas paralel dengan semua track.
- R1 (quick wins lintas file kecil) dikerjakan paling awal, sendirian.
```

Estimasi ukuran: XS < 30 menit, S < 2 jam, M < 1 hari, L > 1 hari.

---

## 4. R — Rapid fixes (sebelum semuanya, satu PR kecil)

### R1 — Guard init race & turnActivitiesRef per-instance `[XS]`
- **Masalah**: promise `initializationRef` tanpa flag "sudah fallback 30 dtk"
  dapat menimpa state live ketika resolve belakangan
  (`use-kana-controller.ts:946-985`). `turnActivitiesRef` module-level
  (`:60`) dibagi semua instance hook.
- **Fix**: tambah boolean `fellBack` di closure effect; pindahkan
  `turnActivitiesRef` menjadi `useRef` di dalam hook (masih dibagikan lewat
  closure handler sampai E2 merapikannya).
- **Verifikasi**: `npx tsc --noEmit`, manual refresh halaman.
- **Sentuh**: `use-kana-controller.ts` saja.

---

## 5. Track 1 — Resume, history, dan activity log (prioritas tertinggi)

### A1 — Fix fetchHistory: runtime id + restore dari session.resume `[M]`
Bug utama pemilik. Dua perubahan saling melengkapi:

1. **Sumber transcript utama = respons `session.resume`.**
   - `openSession` di `hermes-agent-client.ts` sudah menerima `response.messages`.
     Emit event baru `{ type: "history.restored", messages }` (atau simpan di
     client dan expose `getResumedMessages()`) agar controller bisa memakainya.
   - `loadHermesTranscript` (`use-kana-controller.ts:378-504`) diubah: jika
     transcript belum ada lokal, parse `messages` hasil resume; panggil
     `session.history` HANYA sebagai fallback.
2. **fetchHistory memakai runtime session id.**
   - Ganti signature menjadi `fetchHistory()` tanpa argumen durable key;
     di dalamnya pakai `this.session.sessionId` (runtime) dan tolak jika
     `!this.session` ("open the session first").
   - Pemanggil lama dengan durable key dihapus; kalau butuh history sesi yang
     BELUM dibuka, alurnya: `ensureAgent(conversation)` dulu (yang melakukan
     `session.resume` dengan durable key — itu valid, resume memang resolve
     durable key via `db.get_session`), baru ambil `messages`.

- **Kontrak Hermes yang dipakai** (terverifikasi di source terpasang):
  - `session.resume { session_id: <durable>, source: "kana",
    close_on_disconnect: false }` → `{ session_id: <runtime>, resumed:
    <durable>, session_key: <durable>, messages: [...], running, inflight }`.
  - `session.history { session_id: <runtime> }` → `{ count, messages }`;
    durable key → error 4001.
- **Verifikasi**:
  1. Unit test adapter: mock relay — resume mengembalikan messages → event
     history.restored membawa isi sama; fetchHistory tanpa openSession reject.
  2. Live: `npm run dev`, kirim 1 pesan, refresh halaman → transcript harus
     muncul otomatis; cek overlay debug tidak lagi menampilkan
     "transcript restore failed".
  3. Live: buka percakapan lain dari sidebar → transcript termuat.
- **Sentuh**: `hermes-agent-client.ts`, `agent/types.ts` (event baru),
  `use-kana-controller.ts`.

### A2 — Timestamp & anchor strategi rekonstruksi `[M]`
- **Masalah**: RC-2. Barisan rekonstruksi tidak punya timestamp nyata;
  anchor ms antar-browser tidak konsisten.
- **Desain**:
  - Rekonstruksi dari resume/history TIDAK lagi mensintesis anchor ms dari
    `Date.now()`. Anchor untuk PUT `/api/kana/activities` hasil rekonstruksi
    memakai skema deterministik: index pasangan (user→assistant) ke-N →
    anchor sintetis stabil, ATAU lebih baik: ubah kontrak penyimpanan menjadi
    **per-turn ordinal** (`turn_index`) sebagai kunci sekunder, bukan ms.
  - Skema baru SQLite: kolom `turn_index INTEGER` + UNIQUE
    `(hermes_session_key, turn_index)`; `turn_anchor_ms` tetap disimpan untuk
    sorting tapi bukan kunci identitas. Live turn menghitung `turn_index` =
    jumlah assistant message sebelumnya di conversation.
  - Migrasi: tabel `schema_version` / `PRAGMA user_version`; migrasi v1→v2
    idempoten (lihat juga B3).
- **Verifikasi**: dua browser (atau window normal + incognito) melihat blok
  tool di posisi sama setelah refresh; PUT ulid tidak menduplikasi baris.
- **Sentuh**: `activity-store.ts`, `app/api/kana/activities/route.ts`,
  `use-kana-controller.ts` (live PUT + loadHermesTranscript),
  `live-chat-feed.tsx` (splice by ordinal).

### A3 — Dedup live-vs-reconstructed activities `[S]`
- **Masalah**: PUT live (`use-kana-controller.ts:585-594`) dan PUT
  rekonstruksi (`:490-501`) bisa menulis dua baris untuk turn yang sama
  (anchor berbeda). Setelah A2 (ordinal) ini hilang by-construction, tapi
  tambahkan guard: GET activities → merge by `turn_index`, reconstructed row
  kalah jika live row sudah ada.
- **Verifikasi**: refresh 2× pada conversation ber-tool → jumlah baris SQLite
  konstan (cek via sqlite3 read-only).
- **Sentuh**: `use-kana-controller.ts`, `activity-store.ts`.

### A4 — Stale connectAgent pada auto-retry + dedup assistant `[S]`
- **Masalah**: efek retry di `kana-app.tsx:153-164` menangkap `connectAgent`
  basi (eslint-disable) → bisa menciptakan conversation duplikat kosong.
  Dedup assistant message (`updateConversationFromEvent:546-558`) membandingkan
  hanya message terakhir — rapuh terhadap race history-load vs live event.
- **Fix**: ganti pola retry dengan `useRef` ke fungsi terkini (latest-ref) atau
  pindahkan logika retry ke dalam controller (E4 akan memindahkan ini permanen
  ke hermes-session-manager). Untuk dedup: bandingkan juga `timestamp` dalam
  toleransi + abaikan dedup saat restore sedang berjalan (flag ref).
- **Verifikasi**: throttle network (DevTools), toggle connect/disconnect,
  pastikan tidak ada conversation baru tak terduga dan tidak ada pesan ganda.
- **Sentuh**: `kana-app.tsx`, `use-kana-controller.ts`.

### Exit criteria Track 1
- Refresh / pindah browser / reconnect → transcript SELALU termuat atau error
  eksplisit yang terlihat user (tidak pernah kosong diam-diam).
- Aktivitas tool tampil tepat sekali per turn, posisi benar, di semua browser.
- `npm run test:hermes:restart` tetap lulus.

---

## 6. Track 2 — TTS relay & voice (paralel penuh)

### D1 — Route cancel + propagasi abort `[S]` `P0`
- Tambah route `app/api/voice/tts/requests/[requestId]/cancel/route.ts`
  (POST) meneruskan ke Python `POST /v1/requests/{id}/cancel`.
- Di `speech/route.ts`: gabungkan `AbortSignal.any([request.signal,
  AbortSignal.timeout(...)])` sehingga abort browser memutus fetch upstream
  → `request.is_disconnected()` Python aktif.
- Hapus `.catch(() => undefined)` penelan di provider stop; laporkan gagal
  cancel sebagai status, bukan diam.
- **Verifikasi**: mulai sintesis kalimat panjang, tekan stop ≤ 2 dtk → log
  Python menunjukkan cancel; CPU turun.

### D2 — Delete voice clone: samakan kontrak `[XS]` `P0`
- Pilih satu bentuk: dynamic route `[voiceId]` ATAU query param di
  `voices/route.ts` + ubah contract builder (`qwen3-tts-contract.ts:347-350`)
  agar konsisten. Query param paling murah (tidak perlu route baru).
- Tambahkan test kontrak sederhana (URL builder ↔ route parsing).

### D3 — Single-flight start guard `[S]` `P1`
- `/control` POST & `/status` POST memanggil `startLocalQwen3TtsRuntime`
  langsung tanpa mutex → race double-spawn (`local-qwen3-tts-runtime.ts`,
  `control/route.ts:37`, `status/route.ts:30`).
- Bungkus dengan promise single-flight yang sama dipakai
  `ensureQwen3TTSService`; status POST tidak boleh fire-and-forget tanpa
  pelaporan error (sekarang `.catch(() => {})`).

### D4 — PROJECT_DIR & uv resolution portable `[S]` `P1`
- `path.resolve(process.cwd(), "services/qwen3-tts")` gagal di standalone/
  systemd dengan WorkingDirectory lain. Urutan resolusi: env
  `KANA_QWEN3_TTS_PROJECT_DIR` → path relatif module (import.meta.url) → cwd.
- Windows: tangani PATHEXT untuk `uv` (best effort; target utama Linux).

### D5 — Health cold-start jujur `[S]` `P1`
- `waitUntilReady` menganggap HTTP 200 = siap; Python balas 200 dengan
  `status:"loading"` → UI "unavailable" 5 detik lalu flip. Perbaiki:
  - probe membaca payload `/v1/health` dan menunggu `status==="ready"`;
  - health route relay TIDAK men-trigger spawn (hanya probe); spawn hanya via
    ensure-on-use speech/control eksplisit; UI punya state "loading model".

### D6 — Adopt probe validasi `[XS]` `P2`
- `probe()` menerima 200 apa pun di port 7860 (Gradio/A1111 default). Wajib
  validasi payload `/v1/health` (field service/version Kana) sebelum adopt.

### D7 — Analyser/AudioContext lifecycle `[S]` `P2`
- `audio-lip-sync.ts`: disconnect analyser di `finishPlayback`; close()
  AudioContext pada cleanup; `context.resume()` diberi timeout + pesan
  "ketuk untuk mengaktifkan audio" (autoplay policy) alih-alih hang diam.

### D8 — Verifikasi zombie grandchild (butuh mesin nyata) `[S]` `P2`
- Node spawn `uv run` → Python cucu. Uji: start via Kana → stop →
  `ss -ltnp | grep 7860`. Jika masih hidup, spawn langsung ke venv python
  atau `uv run --no-sync` + process group kill (`detached: false` +
  kill `-pid`). Catat hasil di docs.

### D9 — Sentence-mode replay & canReplay `[XS]` `P3`
- `qwen3-tts-provider.ts:105,119,143`: promosikan chunk ke `lastAudio`
  incrementally; `canReplay` mencerminkan utterance berjalan, bukan sebelumnya.

### Exit criteria Track 2
- Stop benar-benar menghentikan inferensi; delete clone berfungsi; dua start
  bersamaan menghasilkan tepat satu proses; status loading jujur.
- `npm run tts:acceptance` tetap lulus di mesin target (gate terpisah).

---

## 7. Track 3 — Data dir, deploy VPS, security (paralel penuh)

### B1 — Satukan data dir di `KANA_DATA_DIR` `[S]` `P0`
- Satu resolver bersama `lib/server/data-dir.ts`:
  `KANA_DATA_DIR` → error jelas jika unset di production (fail-loud), default
  dev `~/.local/share/kana` (XDG), BUKAN cwd.
- Dipakai oleh: `password-store.ts`, `session.ts` (jwt-secret),
  `activity-store.ts`. Migrasi kecil: jika file lama ditemukan di lokasi lama
  (`$CWD/data`, `$HOME/.kana`) dan lokasi baru kosong → pindahkan + log.
- **Verifikasi**: jalankan standalone dari direktori lain → auth & activities
  tetap menemukan data.

### B2 — Launcher meneruskan env data dir `[XS]` `P1`
- `bin/kana.mjs` men-set `KANA_DATA_DIR` (dan `HOME` eksplisit) untuk child
  Next server; dokumentasikan unit systemd contoh
  (`Environment=KANA_DATA_DIR=/var/lib/kana`, `User=non-root`).

### B3 — SQLite migration versioning `[XS]` `P2`
- `PRAGMA user_version`; v2 untuk skema ordinal A2. Tulis migrasi idempoten +
  test dengan fixture DB v1.

### C1 — Hygiene credential git `[XS]` `P0`
- Hapus nilai asli dari `.env.development`; ganti placeholder; rotasi
  password tersebut di mana pun dipakai. Pastikan `.env.production` di
  `.gitignore` (atau tetap tracked tapi tanpa nilai).

### C2 — Fail-loud auth production `[S]` `P0`
- Production (`NODE_ENV=production`): jika auth disabled DAN tidak ada
  flag eksplisit `KANA_ALLOW_NO_AUTH=1` → log warning besar + tampilkan
  banner di UI "AUTH OFF"; idealnya tolak start kecuali flag diset.
- Bootstrap: `KANA_ACCESS_PASSWORD` di production otomatis menulis
  `auth.json` saat pertama kali (sehingga .env cukup untuk first-run).

### C3 — Trusted-proxy & cookie hardening `[S]` `P1`
- `loopback.ts:26-29`: `x-kana-trusted-proxy: 1` bisa di-spoof kecuali nginx
  mem-blank header. Ganti menjadi shared secret env
  (`KANA_TRUSTED_PROXY_SECRET`) ATAU minimal dokumentasikan wajib
  `proxy_set_header X-Kana-Trusted-Proxy "";` di docs deploy.
- Cookie: dokumen/contoh nginx wajib `X-Forwarded-Proto`; rekomendasikan
  `AUTH_COOKIE_SECURE=true` di VPS checklist.
- Simulasi spoof: curl dengan header palsu harus 403 tanpa secret.

### C4 — CSP loopback cleanup `[XS]` `P3`
- `next.config.ts:8,12`: hole `connect-src`/`img-src` http://127.0.0.1 sudah
  tidak diperlukan era relay — evaluasi & kecilkan.

### Exit criteria Track 3
- Redeploy/migrasi mesin tidak lagi menghilangkan data; fresh VPS dengan
  checklist di §10 menghasilkan auth aktif sejak request pertama.

---

## 8. Track 4 — Refactor React/state (setelah Track 1)

Prinsip: inkremental, tiap langkah shippable, fitur tidak berubah. zustand v5
sudah ada di `package.json` — dipakai, bukan dependency baru.

### E1 — Buang dead code & debug dari production `[S]`
- Hapus/nonaktifkan (dev-only): `FetchDebugOverlay`, `FetchIndicator`
  (`kana-app.tsx:291-295`), state `fetchDebugRecords` unbounded
  (`use-kana-controller.ts:313-321`).
- Dead plumbing: props avatar-model yang tidak dipakai SettingsDialog
  (`settings-dialog.tsx:138-148` vs `kana-app.tsx:496-503`),
  `gateInputClass`, `selectedCommandIndexRef`, `replayVoice`/`voiceCanReplay`
  tanpa konsumen, `recreateVoice` tak terpakai.
- Duplikat: satukan `formatTime` (3×), pertimbangkan merge
  `DialogueHistory` ke `LiveChatFeed` (satu renderer, mode modal).

### E2 — Activity slice `[S]`
- Pindahkan log turn (eks `turnActivitiesRef`) + `serverActivityTurns` +
  `activities` ke zustand slice `activity-store`. Identitas per-mount aman.

### E3 — UI store (keystroke decoupling) `[M]`
- Draft per conversation, modals (settings/onboarding/dialogue), gate phase,
  slash-menu index → `ui-store`. Efek: mengetik tidak lagi me-re-run body
  god-hook. Fix inline-arrow `onAdopt` (`kana-app.tsx:422`) dengan action
  store (stabil by design).

### E4 — hermes-session-manager singleton `[L]` (inti refactor)
- Class non-React pemilik `HermesAgentClient`: connect/reconnect, subscribe
  SEKALI, dispatch event ke slices. Menuntaskan class bug stale-subscription
  (`use-kana-controller.ts:895-925`) secara struktural. Controller hook tinggal
  selector + aksi tipis.

### E5 — Conversation slice & pembunuhan cache module `[M]`
- Conversations + activeId + messages → `conversation-store` (zustand);
  hapus `MemoryConversationStore` module Map (cache remnant RC-6).
  Ref paralel (`conversationsRef` dll) dihapus; single source of truth.
- Tambah token monotonik untuk fetch activities/sessions (pola
  `completionRequestRef`) — anti out-of-order.
- **Backup regression** ikut fix di sini: export membaca dari slice yang
  kini selalu memuat messages ter-restor; tambah guard "backup dengan N
  conversation tapi 0 message total → warning".

### E6 — Slices sisa & slim-down kana-app `[M]`
- `command-store` (suggestions+token), `input-request-store`,
  `preferences-store` (persist middleware), `error-store` (dedup di store,
  bukan ref). Target: `kana-app.tsx` ≈ layout+komposisi (~150 baris),
  controller hook tinggil orkestrasi tipis atau terdecomposisi penuh.

### Exit criteria Track 4
- `npm run quality` lulus; perilaku user tidak berubah; tidak ada module-level
  mutable cache tersisa; mengetik di composer tidak memicu re-render sidebar
  list (profiler check).

---

## 9. Urutan eksekusi yang disarankan

```
1. [x] R1                                  (selesai 2026-08-25)
2. [x] Paralel:  Track 1 (A1→A4)           (selesai — event-driven restore,
                                            schema v2 ordinal, dedup, retry fix)
        [x] Track 2 (D1..D7, D9)           (selesai — cancel relay route,
                                            single-flight spawn, portable dir,
                                            honest health, adoption guard)
        [x] Track 3 (B1→B2, C1→C3)         (selesai — KANA_DATA_DIR resolver +
                                            migrasi legacy, launcher env,
                                            placeholder credentials, fail-loud
                                            flag insecureNoAuth, trusted-proxy
                                            secret; C4 skip dengan alasan)
   [ ] B3-lite menyusul: rewire activity-store.ts dbPath ke
       lib/server/data-dir.ts + adopsi legacy activities.db
3. [ ] Setelah Track 1 merge: Track 4 (E1..E5 — keputusan pemilik: berhenti di E5)
4. [ ] Final: verifikasi menyeluruh §11 + live-test resume/TTS pada mesin &
      VPS + update AGENTS.md (arsitektur relay, KANA_DATA_DIR, store slices)

Hotfix pasca-merge (2026-08-25, di luar task awal):
- [x] Gate "Menghubungkan…" abadi → first-connect failure kini mendarat di
      state error; tangga retry otomatis diperbaiki; attempt terakhir
      menjalankan smart-flow (auto-start hermes serve). Test regresi ditambah.
- [x] Resume kosong saat memilih conversation → selectConversation kini
      membuka sesi terlink (pemicu history.restored); connectAgent mengadopsi
      sesi Hermes terakhir yang berisi pesan sebagai landing conversation
      (bukan membuat sesi kosong baru tiap refresh).
```

Status verifikasi gabungan pasca-merge (2026-08-25): `tsc --noEmit` bersih,
79/79 unit test lulus, lint tanpa error baru (1 error pre-existing React
Compiler di kana-app.tsx), `npm run build` sukses, `npm run package:local`
sukses.

Subagent per track diberikan: bagian plan ini + daftar file yang boleh
disentuh + larangan menyentuh file track lain (hindari konflik merge).

---

## 10. Checklist deploy VPS (hasil akhir Track 3)

```bash
# Environment (systemd Environment= atau .env.production TIDAK di-commit):
KANA_ACCESS_PASSWORD=<bootstrap>   # atau pre-seed auth.json
KANA_JWT_SECRET=<64-hex>           # bertahan antar redeploy
KANA_DATA_DIR=/var/lib/kana        # SATU root: auth.json, jwt-secret, activities.db
AUTH_COOKIE_SECURE=true            # jika nginx tidak set X-Forwarded-Proto

# nginx wajib:
proxy_set_header Host $host;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Kana-Trusted-Proxy "";   # blank kecuali memang sengaja

# Runtime: non-root user pemilik KANA_DATA_DIR;
# node .next/standalone/server.js dengan HOSTNAME=127.0.0.1 PORT=3000.
```

---

## 11. Verifikasi menyeluruh (definition of done remediation)

1. **Resume**: kirim pesan → refresh → transcript + activities muncul; ulangi
   di window incognito; ulangi setelah restart `hermes serve`.
2. **Aktivitas**: conversation ber-tool → blok tool tepat 1× per turn di dua
   browser; `sqlite3 $KANA_DATA_DIR/activities.db "SELECT COUNT(*)"` konstan
   setelah refresh berulang.
3. **TTS**: stop ≤ 2 dtk menghentikan CPU; delete clone sukses; double-start
   aman; cold-start menampilkan "loading model" bukan "unavailable".
4. **Auth**: fresh VPS simulasi (env kosong) → banner/fail-loud; login works;
   spoof trusted-proxy ditolak.
5. **Refactor**: `npm run lint && npx tsc --noEmit && npm run build &&
   npm run package:local`; e2e critical journeys lulus; tidak ada regresi
   subtitle historis (byte-for-byte).
6. **AGENTS.md** diperbarui: arsitektur relay, KANA_DATA_DIR, store slices,
   kontrak session.resume-messages.

---

## 12. Terbuka — butuh keputusan pemilik

(Semua sudah diputuskan 2026-08-25:)

- **A2 skema anchor**: ✅ ordinal `turn_index` — sudah diimplementasikan Track 1.
- **C2 kekerasan fail-loud**: ✅ warning keras + flag `insecureNoAuth`
  (bukan tolak-start) — sudah diimplementasikan Track 3.
- **E6 skala refactor**: ✅ berhenti di E5; E6 tidak dikerjakan untuk saat ini.
- **D8 zombie uv**: ✅ boleh diuji di mesin ini — **belum dieksekusi**, masuk
  daftar sisa kerja (§13).
