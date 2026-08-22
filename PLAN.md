# Kana Product Maturity Plan

Dokumen ini adalah roadmap dari foundation MVP Kana menuju produk lokal yang
stabil dan nyaman dipakai setiap hari. Sumber kebenaran untuk batas arsitektur
tetap berada di `AGENTS.md`; roadmap ini menjelaskan urutan produk, quality
gate, dan pekerjaan berikutnya.

Terakhir diperbarui: 2026-08-22.

## Posisi Kana sekarang

Fondasi utama sudah tersedia:

- koneksi nyata ke Hermes melalui `hermes serve`, termasuk sesi, event,
  approval, clarification, reconnect, dan katalog slash command dinamis;
- riwayat percakapan lokal berbasis IndexedDB yang mempertahankan subtitle
  persis seperti saat ditampilkan;
- Qwen3-TTS lokal dengan playback WAV, pembatalan request, dan lip sync;
- Live2D nyata dengan Haru dan Mao resmi sebagai contoh berbeda, impor model
  pengguna, serta binding per model;
- mock agent, voice, avatar, dan conversation store untuk pengembangan;
- UI putih minimal, avatar di tengah, serta layout desktop dan mobile;
- build standalone, metadata installable, dan offline application shell.

Kana sudah melewati foundation MVP dan hardening internal utama, tetapi belum
boleh disebut beta sebelum validasi target-host selesai. Quality gate,
diagnostics, onboarding, recovery adapter, model library, security, backup,
migration, browser journeys, dan proses rilis sekarang sudah tersedia. Gap
terbesar tersisa memerlukan lingkungan nyata: restart Hermes pada turn dan
protected input aktif, benchmark Qwen di hardware target, dua package Live2D
pengguna, serta dogfood minimal satu minggu. Restart Hermes saat idle sekarang
sudah diuji otomatis terhadap binary terpasang dengan home yang sepenuhnya
terisolasi.

## Hasil maturity pass 2026-08-22

- `npm run quality` lulus dengan lint, TypeScript, 42 unit/integration test,
  16 perjalanan Playwright desktop/mobile, satu audit installability/offline
  production, build, dan package assembly.
- Audit live Hermes 0.20.1 berhasil membaca `gateway.ready`, 6 kategori, 165
  command pada instalasi saat itu, 15 completion, status sesi, dan close sesi
  test tanpa mengirim prompt LLM. Angka registry bukan konstanta aplikasi.
- Paket standalone dijalankan dari direktori sementara di luar checkout dan
  merespons HTTP 200 dengan CSP produksi aktif.
- `npm audit --omit=dev --audit-level=high` melaporkan 0 vulnerability.
- Heavy Qwen inference sengaja tidak diulang pada laptop ini. Prosedur,
  benchmark otomatis p50/p95/RTF/cancellation, expected output, dan success
  criteria VPS berada di
  `docs/QWEN3_TTS_VPS_ACCEPTANCE.md`.
- Restart idle nyata berhasil melewati stop/start server, reconnect, resume ID
  persisten, rekonstruksi adapter seperti page refresh, dan `/status`
  menggunakan temporary `HERMES_HOME` tanpa menyentuh data Hermes pengguna.
  Kasus turn/protected input aktif tetap gate manual.
- Haru dan Mao dari koleksi sampel resmi dapat dimuat, diganti, disimpan,
  direload, lalu diganti kembali dengan binding mulut berbeda
  (`ParamMouthOpenY` dan `ParamA`). Uji ini juga menjaga lifecycle satu renderer
  WebGL per canvas agar pergantian model tidak membekukan tab.
- Manifest production, installability Chrome, service worker application shell,
  dan reload offline pada profil mobile sudah diuji otomatis. Service worker
  tidak mencegat origin eksternal maupun endpoint `/api`.
- Opsi sentence chunk Qwen eksperimental menjaga teks dan urutan, prefetch,
  cancellation, serta replay tanpa request Hermes kedua. Complete WAV tetap
  default sampai benchmark target mendukung perubahan.
- Jurnal dogfood dan matrix beta sekarang dapat divalidasi dengan
  `npm run dogfood:check`; 7 dari 13 kasus sudah memiliki bukti. Gate tetap
  gagal sampai enam kasus target-environment dan tujuh hari pemakaian selesai.
- Pencatatan hari dan matrix dogfood kini memakai perintah tervalidasi yang
  menolak hari duplikat, ID salah, dan bentuk credential umum. Lima kasus
  restart aktif Hermes memiliki evidence schema dan validator tersendiri;
  seluruh gate eksternal dirangkum di `docs/BETA_ACCEPTANCE_HANDOFF.md`.
- Gate beta tetap terbuka sampai semua item Phase 6 yang belum dicentang selesai.

## Definisi “matang”

Kana layak disebut matang apabila:

1. pengguna dapat memasang, menghubungkan, dan mendiagnosis Hermes/Qwen tanpa
   membaca source code;
2. restart, disconnect, cancel, resume, dan kegagalan layanan tidak membuat
   pesan ganda, kehilangan riwayat, atau meninggalkan UI dalam kondisi palsu;
3. semua kontrol Hermes yang relevan tersedia melalui RPC resmi atau slash
   command hidup, tanpa meniru konteks Telegram/Discord yang tidak ada;
4. suara dan avatar bisa diganti, diuji, dihentikan, dan dipulihkan secara
   aman;
5. percakapan, preferensi, subtitle historis, dan model lokal tahan terhadap
   reload serta migrasi versi;
6. desktop dan mobile dapat digunakan dengan keyboard, sentuhan, dan pembaca
   layar pada alur utama;
7. paket rilis dapat dibuat ulang, di-upgrade, dan di-rollback tanpa menyentuh
   instalasi Hermes milik pengguna;
8. mock mode tetap berfungsi ketika Hermes, Qwen3-TTS, internet, atau WebGL
   tidak tersedia.

## Prinsip pelaksanaan

- Hermes tetap satu-satunya agent. Tidak ada Kana LLM, translator LLM, agent
  loop, tool runner, MCP implementation, atau memory system kedua.
- Integrasi nyata tetap melalui interface publik Hermes dan adapter Kana.
  Hermes tidak boleh dipatch atau dibundel ke dalam Kana.
- `speech_ja` selalu bahasa Jepang. Perubahan bahasa subtitle hanya berlaku
  untuk respons baru dan tidak menulis ulang histori.
- Reliability dan recovery dikerjakan sebelum visual polish lanjutan.
- Setiap fitur nyata harus memiliki fallback atau status gagal yang jujur.
- Dependency baru hanya ditambahkan setelah kebutuhan dan alternatif bawaan
  browser/proyek diperiksa.
- Data lokal dan nilai rahasia harus memiliki skema, migrasi, dan batas umur
  yang eksplisit.

## Urutan prioritas

| Prioritas | Hasil yang dicari | Alasan |
| --- | --- | --- |
| P0 | Quality gate, diagnostics, dan automated user journeys | Membuat regresi terlihat sebelum fitur bertambah |
| P1 | Hermes yang tahan restart/disconnect dan mudah dikendalikan | Hermes adalah jalur kritis Kana |
| P2 | Voice yang terukur, dapat dibatalkan, dan mudah disiapkan | Saat ini nyata tetapi CPU masih lambat |
| P3 | Library dan validasi model Live2D | Impor sudah ada, lifecycle aset belum lengkap |
| P4 | Onboarding, accessibility, dan UX harian | Mengubah fondasi teknis menjadi produk yang mudah dipakai |
| P5 | Packaging, security, migration, dan release discipline | Diperlukan sebelum beta yang bisa di-upgrade |

Estimasi kasar untuk satu pengembang adalah 12–18 minggu hingga beta yang
solid. Ini adalah urutan kerja, bukan janji tanggal; beberapa fase dapat
berjalan paralel setelah P0 selesai.

## Phase 0 — Baseline kualitas dan observability

Target: setiap kegagalan penting dapat direproduksi, terlihat, dan diuji tanpa
membaca log internal Hermes secara manual.

### Pekerjaan

- [x] Buat matriks user journey utama: mock chat, koneksi Hermes, membuat dan
      melanjutkan sesi, slash command, approval, clarification, stop, reconnect,
      ganti subtitle, voice, serta avatar.
- [x] Tambahkan automated browser tests untuk alur kritis pada viewport desktop
      dan mobile. Pilih runner setelah memeriksa kemampuan proyek yang sudah
      ada; jangan menambah dependency hanya karena kebiasaan.
- [x] Tambahkan test fixture untuk WebSocket Hermes agar error, event terlambat,
      duplicate event, out-of-order event, dan reconnect dapat diuji deterministik.
- [x] Satukan kategori error internal: connection, authentication, protocol,
      session, model response, storage, voice, avatar, dan user cancellation.
- [x] Buat panel diagnostics yang aman untuk menyalin status versi, mode aktif,
      kesehatan provider, dan error terakhir tanpa token, password, secret,
      prompt pribadi, atau isi tool yang sensitif.
- [x] Catat metrik lokal yang berguna: waktu connect, waktu respons Hermes,
      waktu sintesis TTS, durasi audio, waktu load avatar, dan jumlah reconnect.
      Jangan kirim telemetry keluar secara default.
- [x] Tambahkan satu perintah quality gate yang menjalankan lint, TypeScript,
      unit/integration tests, TTS tests yang sesuai, build, dan package check.
- [x] Jalankan pemeriksaan aksesibilitas dasar serta cek horizontal overflow
      pada lebar 360, 390, 768, dan 1440 px.

### Exit criteria

- Semua user journey P0 memiliki test atau checklist manual yang dapat diulang.
- Kegagalan provider terlihat sebagai status yang jelas dan tidak disamarkan
  sebagai sukses.
- Diagnostics tidak menyimpan atau mengekspos credential.
- `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build`, dan
  `npm run package:local` lulus.

## Phase 1 — Hermes reliability dan control surface

Target: Kana terasa seperti client Hermes resmi yang tahan terhadap penggunaan
harian, bukan sekadar WebSocket yang kebetulan tersambung.

### Pekerjaan

- [x] Buat state machine koneksi yang eksplisit: idle, connecting, connected,
      reconnecting, authentication failed, incompatible, dan disconnected.
- [x] Terapkan reconnect backoff dengan cancel manual serta pesan status yang
      tidak menutupi transcript.
- [x] Uji restart nyata `hermes serve` ketika idle dengan binary terpasang,
      temporary home, reconnect adapter, resume durable ID, dan `/status`.
- [ ] Selesaikan matrix restart ketika agent sedang berpikir, menunggu
      approval, menunggu secret, setelah jawaban tersedia tetapi event akhir
      belum diterima, dan sesaat setelah completion. Ikuti
      `docs/HERMES_RESTART_ACCEPTANCE.md` dan jangan gunakan secret produksi.
- [x] Pastikan resume tidak menghasilkan assistant message ganda dan tidak
      mengirim prompt pengguna dua kali.
- [x] Selesaikan reconciliation untuk sesi Hermes yang dihapus, di-branch,
      di-rename, atau dikompres dari client lain.
- [x] Audit katalog Hermes pada versi terpasang untuk kontrol yang pantas diberi
      UI khusus, terutama model, profile, usage, reasoning, context, agent,
      memory, dan session management. Tetap gunakan RPC resmi dan registry
      hidup sebagai sumber kebenaran.
- [x] Buat tampilan session picker yang membedakan conversation lokal, linked
      Hermes session, sesi yang hilang, dan branch.
- [x] Perjelas command yang messaging-only atau platform-only dengan status
      unavailable dan alasan, tanpa membuat identitas Telegram/Discord palsu.
- [x] Tambahkan integration harness terhadap server Hermes sementara pada port
      non-default. Gunakan hanya sesi test `source: "kana"` dan bersihkan hanya
      data test tersebut.
- [x] Tambahkan pemeriksaan kompatibilitas protocol agar perubahan Hermes yang
      tidak dikenali menghasilkan pesan upgrade yang jelas, bukan crash.

### Exit criteria

- Skenario restart/disconnect/resume lulus tanpa kehilangan atau menggandakan
  pesan.
- Approval, clarification, sudo, dan secret dapat dipulihkan atau dibatalkan
  dengan status yang benar.
- Slash command dan skill baru tetap muncul tanpa perubahan source Kana.
- Kana dapat menjelaskan apakah masalah berasal dari koneksi, token, versi,
  sesi, atau respons model.

## Phase 2 — Voice maturity dan latency

Target: Qwen3-TTS mudah disiapkan dan perilakunya dapat diprediksi pada hardware
lemah maupun kuat.

### Pekerjaan

- [x] Tambahkan setup check untuk versi service, ruang disk, model cache,
      speaker catalog, device, dan estimasi kondisi CPU/GPU.
- [x] Tampilkan lifecycle voice dengan jelas: offline, loading model,
      synthesizing, playing, stopping, ready, dan failed.
- [ ] Ukur p50/p95 waktu sintesis berdasarkan panjang teks pada mesin target;
      simpan hasil sebagai baseline dokumentasi, bukan janji realtime.
- [x] Pastikan stop membatalkan request server, playback browser, analyser, dan
      status talking avatar secara idempotent.
- [x] Tambahkan replay audio terakhir tanpa memanggil Hermes atau menghasilkan
      terjemahan baru.
- [x] Tambahkan kebijakan antrean: respons lama tidak boleh mulai berbicara
      setelah pengguna sudah berpindah conversation atau menghentikannya.
- [x] Lakukan spike streaming TTS yang terbatas waktu. Service terpasang
      menerima waveform lengkap dari `generate_custom_voice` lalu mengirim
      `Response` WAV utuh; tidak ada stream PCM stabil pada kontrak v1. Streaming
      ditunda, bukan ditiru dengan buffering palsu. Lihat ADR-002.
- [x] Jika streaming belum layak, evaluasi chunking per kalimat dengan tetap
      menjaga urutan, cancellation, dan satu respons Hermes. Jangan menambah LLM.
      Implementasi tersedia sebagai opsi eksperimental; complete WAV tetap
      default sampai bukti target-host tersedia.
- [x] Dokumentasikan profil hardware yang realistis serta degraded mode saat
      Qwen tidak tersedia.

### Exit criteria

- Bahasa yang dikirim ke Qwen tetap `ja` dan teks selalu berasal dari
  `speech_ja` pada respons yang sama.
- Stop dan perpindahan conversation tidak meninggalkan audio atau lip sync
  berjalan.
- Pengguna mengetahui apakah lambat disebabkan model loading, CPU inference,
  antrean, download, atau playback.
- Keputusan streaming dicatat sebagai ADR singkat: diterapkan, ditunda, atau
  ditolak beserta hasil pengukurannya.

## Phase 3 — Live2D model library dan robustness

Target: pengguna dapat mengelola beberapa avatar tanpa asumsi bahwa semuanya
memiliki struktur Haru.

### Pekerjaan

- [x] Buat model library untuk melihat, memilih, mengganti nama lokal, dan
      menghapus model URL/folder yang pernah diimpor.
- [x] Validasi `.model3.json` dan seluruh referensi aset sebelum model dijadikan
      aktif; tampilkan daftar file yang hilang secara manusiawi.
- [x] Tambahkan preview/test untuk mouth parameter, setiap emotion expression,
      motion group, talking state, dan lip sync.
- [x] Tampilkan ukuran IndexedDB per model dan pastikan delete benar-benar
      melepaskan blob yang tidak lagi digunakan.
- [x] Tangani quota exceeded, context loss WebGL, model corrupt, cross-origin
      URL, remote asset hilang, dan reload saat proses impor.
- [x] Pastikan pergantian model membersihkan Pixi texture, audio binding, event
      listener, object URL, dan WebGL resources lama.
- [x] Tambahkan export/import konfigurasi binding tanpa menyalin aset model
      berlisensi secara tidak sengaja.
- [x] Pertahankan Haru hanya sebagai sample resmi development beserta notice;
      jangan jadikan ID parameter Haru sebagai default universal.

### Exit criteria

- Sedikitnya dua package model dengan struktur/binding berbeda dapat dipakai
  bergantian dan tetap aktif setelah reload.
- Model rusak tidak merusak model aktif sebelumnya.
- Delete model menghapus aset lokal yang tepat dan tidak menghapus binding
  model lain.
- Mock avatar tetap menjadi fallback ketika WebGL/Core/model gagal.

## Phase 4 — Onboarding dan UX harian

Target: pengguna non-teknis dapat memahami mode yang sedang dipakai dan pulih
dari masalah umum langsung dari UI.

### Pekerjaan

- [x] Buat first-run setup ringkas: pilih mock/Hermes, tes koneksi, pilih bahasa
      subtitle, pilih voice, dan konfirmasi avatar.
- [x] Buat status provider yang selalu dapat ditemukan tetapi tidak bersaing
      dengan avatar dan percakapan di viewport utama.
- [x] Lengkapi empty, loading, offline, reconnecting, permission, storage-full,
      dan incompatible-version states.
- [x] Tambahkan pencarian conversation, rename, delete confirmation, serta
      penanda percakapan dengan linked/missing Hermes session.
- [x] Polish composer untuk keyboard virtual, safe-area mobile, multiline,
      slash completion, queued prompt, stop, dan draft per conversation.
- [x] Pastikan fokus dialog kembali ke elemen asal, semua command bisa dipakai
      via keyboard, status dibaca screen reader, dan animasi mengikuti
      `prefers-reduced-motion`.
- [x] Verifikasi contrast, ukuran target sentuh, zoom 200%, serta layout pada
      orientasi portrait dan landscape.
- [x] Tambahkan halaman bantuan singkat untuk arsitektur lokal, cara menjalankan
      Hermes/Qwen, arti mock mode, dan lokasi data browser.

### Exit criteria

- Pengguna baru dapat masuk mock mode tanpa setup eksternal dan dapat
  menghubungkan Hermes melalui petunjuk UI setelah server siap.
- Tidak ada horizontal overflow atau composer tertutup keyboard pada ukuran
  mobile target.
- Semua alur utama dapat diselesaikan tanpa mouse.
- Pergantian subtitle hanya memengaruhi respons baru; test histori lama tetap
  byte-for-byte sama.

## Phase 5 — Security, data lifecycle, dan packaging

Target: beta dapat di-upgrade, dipindahkan, dan didiagnosis dengan risiko data
serta credential yang terkendali.

### Pekerjaan

- [x] Threat-model localhost: WebSocket origin, CORS Qwen, XSS dari markdown/
      tool output, URL model, file import, object URL, dan diagnostic export.
- [x] Terapkan Content Security Policy yang kompatibel dengan Cubism Core,
      model remote yang diizinkan, WebSocket lokal, dan TTS lokal tanpa membuka
      origin secara berlebihan.
- [x] Audit ulang bahwa Hermes token, sudo password, secret tool, dan protected
      input tidak pernah masuk localStorage, IndexedDB, transcript, log, URL,
      atau diagnostics.
- [x] Versikan semua schema persisten dan buat migration tests menggunakan
      fixture dari versi aplikasi sebelumnya.
- [x] Buat backup/export-import untuk conversation dan preference yang aman.
      Exclude credential serta aset avatar berlisensi secara default.
- [x] Tambahkan recovery sebelum destructive migration dan pesan yang jelas
      ketika storage tidak dapat dibaca.
- [x] Bekukan proses release: version bump, changelog, license/notice audit,
      dependency audit, build, smoke test, package, checksum, dan rollback note.
- [x] Verifikasi paket standalone di lingkungan bersih tanpa source checkout.
      Hermes dan Qwen tetap dependency eksternal.
- [x] Tulis ADR sebelum menambah desktop wrapper. Wrapper hanya layak jika ada
      kebutuhan nyata untuk process supervision, keychain, auto-start, atau
      native update; ia tetap tidak boleh memodifikasi Hermes.

### Exit criteria

- Upgrade dari dua schema fixture sebelumnya mempertahankan conversation dan
  subtitle historis.
- Security checklist dan license notices lulus.
- Paket dapat dijalankan dan dihapus tanpa mengubah instalasi/config Hermes.
- Prosedur backup, restore, upgrade, dan rollback telah diuji.

## Phase 6 — Beta dan release readiness

Target: Kana siap dipakai rutin oleh pengguna awal dengan scope dan batasan
yang terdokumentasi.

### Pekerjaan

- [ ] Jalankan dogfood minimal satu minggu dengan jurnal issue: frekuensi,
      severity, reproduksi, provider terkait, dan apakah ada data hilang.
- [ ] Uji matrix minimum: mock-only, Hermes-only, Hermes+Qwen, offline avatar,
      custom Live2D, refresh, restart service, dan mobile installable web app.
- [ ] Triage semua issue P0/P1; jangan rilis beta dengan risiko credential leak,
      data loss, prompt ganda, atau sesi salah.
- [x] Dokumentasikan supported environment, kebutuhan storage, kebutuhan
      hardware Qwen, known limitations, dan cara mengumpulkan diagnostics.
- [x] Siapkan changelog pengguna dan migration note untuk setiap rilis.
- [x] Tetapkan kanal alpha/beta/stable serta aturan kompatibilitas minimum
      terhadap versi Hermes yang benar-benar telah diuji.

### Release gate

Beta hanya boleh dirilis apabila:

- tidak ada issue P0/P1 terbuka;
- quality gate penuh lulus dari checkout bersih;
- reconnect/resume, protected input, history migration, voice cancellation,
  dan avatar fallback lulus;
- mobile dan keyboard flows lulus;
- paket bersih dapat terhubung ke instalasi Hermes yang tidak dimodifikasi;
- mock mode tetap dapat dipakai tanpa Hermes dan Qwen.

## Sprint berikutnya yang direkomendasikan

Fondasi reliability sudah selesai. Sprint berikutnya adalah acceptance dan
dogfood 7–10 hari, bukan penambahan fitur besar:

1. jalankan `npm run tts:acceptance` pada VPS, dengarkan satu WAV, dan simpan
   JSON baseline;
2. jalankan matrix restart Hermes aktif (thinking, approval, secret, answer
   boundary), isi `acceptance/hermes-active-restart.json`, dan pastikan
   `npm run hermes:active-check` lulus;
3. impor dua package Live2D legal dengan binding berbeda, reload, ganti model,
   uji fallback, lalu hapus salah satunya;
4. mulai jurnal harian melalui `npm run dogfood:record`, selesaikan semua
   matrix provider, dan masukkan setiap issue dengan severity;
5. jalankan `npm run quality`, `npm run dogfood:check`, audit dependency, dan
   release checklist setelah semua P0/P1 terverifikasi.

Hasil sprint yang benar adalah bukti target environment dan daftar defect yang
jujur. Jangan mencentang gate hardware atau tujuh hari berdasarkan test mock.

## Keputusan yang harus berbasis bukti

Keputusan berikut tidak perlu dibuat sekarang:

- **Streaming TTS:** putuskan setelah latency spike membuktikan manfaat nyata
  dan cancellation tetap benar.
- **Desktop wrapper:** tunda sampai process supervision, keychain, atau
  auto-start menjadi kebutuhan pengguna yang jelas.
- **Cloud sync:** jangan dikerjakan sebelum ada kebutuhan multi-device dan
  model keamanan/privasi yang disepakati.
- **Telemetry cloud:** tidak aktif secara default; gunakan diagnostics lokal
  lebih dahulu.
- **Live2D marketplace:** model library lokal didahulukan. Kana tidak boleh
  mendistribusikan model pihak ketiga tanpa hak yang sesuai.
- **UI visual lanjutan:** polish hanya setelah reliability, accessibility, dan
  mobile flows memenuhi gate.

## Hal yang sengaja bukan scope Kana

- Mengganti atau mem-fork agent loop Hermes.
- Menjalankan tool, shell, filesystem, MCP, memory, subagent, atau compaction
  secara mandiri.
- Membuat model tambahan untuk persona atau subtitle.
- Menyimpan credential Hermes secara permanen di browser.
- Mengemas model Qwen multi-gigabyte atau source Hermes ke paket web Kana.
- Meniru identity/topic/platform context milik Telegram, Discord, atau Slack.

## Cara memelihara roadmap ini

- Centang pekerjaan hanya setelah exit criteria terkait terbukti.
- Tambahkan tautan issue/ADR/test report di bawah item yang memerlukan keputusan.
- Jika kontrak Hermes, Qwen, atau Live2D berubah, perbarui `AGENTS.md` terlebih
  dahulu sebagai handoff arsitektur, lalu sesuaikan roadmap ini.
- Setelah setiap rilis, pindahkan pekerjaan selesai ke changelog dan pertahankan
  `PLAN.md` sebagai daftar langkah yang masih relevan.
