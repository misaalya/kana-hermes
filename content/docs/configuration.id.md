# Panduan konfigurasi

> Kana dapat berjalan tanpa `config.json`. Halaman ini hanya untuk saat Anda ingin mengubah satu hal; Anda tidak perlu menyalin semua contoh.

File konfigurasinya adalah `config.json` di folder data Kana. Pada instalasi ini:

```kana-config-path
~/.kana/config.json
```

Jalankan `kana config` untuk membukanya, atau `npm run config` dari kode sumber. Apabila file belum ada, Kana membuatnya lebih dulu dan tidak pernah menimpa file yang sudah ada. File dibuka dengan editor yang Anda tetapkan pada `VISUAL` atau `EDITOR`; apabila keduanya kosong, nilai editor mengandung argumen (misalnya `code -w`), atau tidak ada terminal interaktif, Kana hanya menampilkan lokasinya.

Perubahan berlaku pada balasan berikutnya tanpa memulai ulang Kana. Satu-satunya pengecualian adalah bagian `hermes`, yang baru dibaca saat Kana dimulai. Apabila ada kunci yang salah, **Pengaturan → Koneksi** menampilkan kesalahannya beserta bagian yang perlu diperbaiki. Blok `guardrails` memiliki pemeriksa sendiri; bila tidak dapat dipakai, statusnya dilaporkan di halaman ini.

## Mulai dari sini {#quickstart}

**Tidak perlu mengubah apa pun** apabila Kana sudah terbuka, Hermes ditemukan otomatis, dan suara yang Anda inginkan sudah tersedia. Pengaturan bawaan sudah cukup untuk pemakaian biasa; jangan membuat `config.json` hanya karena halaman ini ada.

Jika ada satu hal yang ingin diubah, temukan kebutuhannya di tabel ini:

| Kebutuhan | Baca bagian |
| --- | --- |
| Mengganti atau memasang suara | Suara lokal (Irodori) atau Pollinations |
| Hermes tidak ditemukan, port bentrok, atau folder kerja berbeda | Menghubungkan Hermes |
| Hermes berada di mesin lain | Menghubungkan Hermes → Hermes di mesin lain |
| Mesin Instabox yang pause saat menganggur | Menghubungkan Hermes → Bangunkan Instabox |
| Kana dibuka dari HP atau VPS | Membuka Kana dari jaringan |
| Kana dijalankan sebagai service | Menjalankan di server |
| Membatasi permintaan dengan Jev | Membatasi permintaan dengan Jev |
| Memindahkan data dari versi lama | Dari versi lama |
| Ada yang tidak berjalan | Jika ada masalah |

Setiap bagian di bawah dimulai dengan penjelasan kapan Anda boleh melewatinya.

## Memilih suara {#voice}

Kana memakai salah satu dari dua mesin suara. **Lewati bagian ini jika suara bawaan sudah cocok.**

| Pilihan | Cocok jika | Internet | Biaya |
| --- | --- | --- | --- |
| Suara lokal (Irodori) | Anda ingin suara tanpa internet dan tidak masalah memakai CPU | Tidak | Gratis |
| Pollinations | Komputer Anda lemah atau Anda ingin suara dari layanan daring | Ya | Berbayar sesuai pemakaian |

`tts.provider` boleh dihilangkan. Kana memilih `"pollinations"` apabila hanya blok `pollinations` yang Anda tulis, dan `"irodori-local"` untuk kondisi lainnya. Isi `provider` secara tegas apabila Anda menulis blok `irodoriLocal` dan `pollinations` bersamaan.

Hanya blok milik mesin yang sedang dipilih yang dibaca, sehingga Anda dapat menyimpan pengaturan kedua mesin dalam satu file dan berpindah cukup dengan mengubah `provider`.

`timeoutSeconds` (bawaan `900`, rentang 1–3600) membatasi pembuatan satu suara, termasuk waktu tunggu antrean. Naikkan nilainya apabila suara untuk balasan panjang habis waktu. Apabila Kana berada di balik Nginx atau proxy lain, atur batas waktu baca proxy sedikit di atasnya, misalnya 910 detik untuk nilai bawaan 900.

Jika suara gagal dibuat, balasan tetap muncul sebagai teks disertai pesan kesalahan. Kana tidak beralih ke mesin suara lain dengan sendirinya.

## Suara lokal (Irodori) {#irodori}

**Lewati jika Anda memakai Pollinations.** Suara dibuat di CPU komputer Anda dengan model [Irodori-TTS v4.1 Anime](https://huggingface.co/phasefield-audio/Irodori-TTS-v4.1-Anime). Tidak perlu GPU, dan teks balasan tidak dikirim ke layanan lain.

Persyaratannya Linux 64-bit (x86-64) dengan glibc 2.35 atau lebih baru, misalnya Ubuntu 22.04, serta CPU yang mendukung AVX2 dan FMA.

Untuk memasangnya, buka **Pengaturan → Suara** dan tekan **Unduh mesin suara**. Ukuran unduhan dan ruang disk ditampilkan sebelum unduhan dimulai, dan Kana tidak mengunduh apa pun sebelum tombol itu ditekan. Apabila unduhan terputus, tekan tombol yang sama untuk melanjutkan dari posisi terakhir. Model yang sudah ada di cache Hugging Face langsung dipakai tanpa diunduh ulang.

Pengaturan berikut ditulis di dalam `tts.irodoriLocal` dan semuanya opsional.

| Kunci | Nilai bawaan | Keterangan |
| --- | --- | --- |
| `steps` | `16` | Jumlah langkah sampling, 1–200. Nilai kecil lebih cepat, nilai besar lebih halus. `8` adalah yang tercepat; `40` setara dengan kualitas standar mesin. |
| `threads` | Jumlah inti fisik CPU | Jumlah thread CPU, 1–256. Kurangi apabila komputer menjadi lambat saat Kana berbicara. |
| `precision` | `"auto"` | `"auto"`, `"int8"`, atau `"fp32"`. `"auto"` memilih yang tercepat untuk CPU Anda; `"int8"` memerlukan AVX-512 VNNI. |
| `modelPath` | Tidak ada | Path absolut ke `model.safetensors` Irodori v4.1 yang sudah Anda miliki. |
| `installDirectory` | `<folder data>/irodori` | Path absolut folder pemasangan mesin suara. |

Pada komputer berspesifikasi rendah, cukup ubah `steps`; tidak perlu menulis ulang seluruh konfigurasi:

```json
{
  "tts": {
    "irodoriLocal": {
      "steps": 8
    }
  }
}
```

## Pollinations {#pollinations}

**Lewati jika Anda memakai suara lokal.** Suara dibuat layanan daring [Pollinations](https://gen.pollinations.ai/docs), dengan pilihan model ElevenLabs, Qwen, xAI, dan penyedia lain melalui satu API key. Komputer Anda tidak dibebani.

API key dibuat di [enter.pollinations.ai](https://enter.pollinations.ai/keys); pakai key rahasia berawalan `sk_`. Seluruh model suara berbayar dan menggunakan saldo pollen. Daftar model dan suara yang tersedia ada di [gen.pollinations.ai/audio/models](https://gen.pollinations.ai/audio/models).

Konfigurasi minimalnya hanya memerlukan API key. Model dan suara akan memakai nilai bawaan Pollinations:

```json
{
  "tts": {
    "provider": "pollinations",
    "pollinations": {
      "apiKey": "sk_YOUR_POLLINATIONS_KEY"
    }
  }
}
```

Pengaturan berikut ditulis di dalam `tts.pollinations`.

| Kunci | Keterangan |
| --- | --- |
| `apiKey` | API key Pollinations. Hanya disimpan di komputer atau server yang menjalankan Kana dan tidak pernah dikirim ke browser. |
| `model` | ID model, misalnya `elevenlabs/eleven-v3` atau `qwen/qwen3-tts-instruct-flash`. Apabila kosong, Pollinations memilih model bawaannya. |
| `voice` | Nama suara yang tersedia pada model tersebut, atau ID suara ElevenLabs milik Anda. Apabila kosong, Pollinations memilih suara bawaannya. |
| `instructions` | Arahan gaya bicara untuk model yang mendukungnya, misalnya `qwen/qwen3-tts-instruct-flash`. |
| `format` | `"mp3"` (bawaan), `"opus"`, `"aac"`, `"flac"`, atau `"wav"`. |

Model yang umum dipakai adalah `elevenlabs/eleven-v3`, `elevenlabs/eleven-flash-v2.5`, `qwen/qwen3-tts-instruct-flash`, `qwen/qwen3-tts-flash`, `x-ai/grok-tts`, dan `hexgrad/kokoro-82m`.

Satu permintaan suara ke Pollinations maksimal 10.000 karakter. Pada pengiriman utuh (bawaan), balasan yang lebih panjang tidak dikirim ke Pollinations dan ditampilkan sebagai teks disertai pesan kesalahan.

## Menghubungkan Hermes {#hermes}

**Biasanya tidak perlu diisi.** Kana menemukan dan menjalankan Hermes sendiri. Gunakan bagian ini hanya jika salah satu kondisi berikut berlaku.

| Kondisi | Hanya isi kunci ini |
| --- | --- |
| Hermes tidak ditemukan | `executable` |
| Port 9119 sudah dipakai program lain | `port` |
| Hermes harus bekerja di folder lain | `workingDirectory` |

Jangan menyalin semua kunci sekaligus. Jika hanya port yang bentrok:

```json
{ "hermes": { "port": 9120 } }
```

Jika hanya folder kerja yang berbeda:

```json
{ "hermes": { "workingDirectory": "/home/you/projects" } }
```

Jika Hermes tidak ditemukan, tulis `{"hermes":{"executable":"/home/you/.local/bin/hermes"}}`.

| Kunci | Nilai bawaan | Keterangan |
| --- | --- | --- |
| `executable` | Dicari otomatis | Path absolut program `hermes`. Isi hanya apabila `kana doctor` tetap tidak menemukannya. |
| `port` | `9119` | Port Hermes yang dijalankan Kana, 1024–65535. |
| `workingDirectory` | Folder home pengguna | Path absolut folder kerja awal Hermes. Path relatif pada alat file dan terminal Hermes mengacu ke folder ini, dan hanya berlaku untuk Hermes yang dijalankan Kana. |

Perubahan pada bagian `hermes` baru berlaku setelah Kana dimulai ulang.

### Gateway Hermes yang sudah berjalan

Di Linux, apabila `hermes serve` sudah mendengarkan port, Kana mengadopsinya hanya jika proses tersebut dijalankan dengan `HERMES_DASHBOARD_SESSION_TOKEN` pada lingkungannya. Tanpa variabel itu, Hermes membuat token acak yang hanya diketahui prosesnya sendiri, sehingga program lain tidak dapat terhubung. Layar koneksi Kana menyebutkan keadaan ini dan meminta Anda menghentikan proses tersebut di terminal asalnya (Ctrl+C), lalu memilih "Hubungkan lagi"; Kana akan menjalankan Hermes sendiri dengan token yang dibuat dan disimpannya di server. Untuk tetap memakai gateway yang dijalankan manual, sediakan tokennya sendiri:

```bash
HERMES_DASHBOARD_SESSION_TOKEN=<token> hermes serve --host 127.0.0.1 --port 9119
```

Kana membaca token dari lingkungan proses itu, dan token tetap tersimpan di server, bukan di browser.

### Hermes di mesin lain

**Lewati jika Hermes ada di komputer yang sama.** Tambahkan blok `remote` untuk terhubung ke gateway di mesin lain; Kana kemudian tidak mencari, menjalankan, memulai ulang, atau menghentikan Hermes lokal. Hapus blok itu untuk kembali ke pencarian lokal.

Konfigurasi minimalnya memerlukan URL dan satu cara autentikasi:

```json
{
  "hermes": {
    "remote": {
      "url": "wss://hermes.example.com",
      "auth": {
        "username": "misa",
        "passwordEnv": "HERMES_REMOTE_PASSWORD"
      }
    }
  }
}
```

| Kunci | Nilai bawaan | Keterangan |
| --- | --- | --- |
| `remote.url` | wajib | URL dashboard `wss://`. Bila path-nya belum berakhir dengan `/api/ws`, Kana menambahkannya di belakang path yang ada; host dasar menjadi `/api/ws`. Kredensial, query string, dan fragmen ditolak. |
| `remote.auth.mode` | `"password"` | Satu-satunya mode auth remote yang didukung. |
| `remote.auth.username` | wajib | Username untuk provider `basic` dashboard Hermes. |
| `remote.auth.password` | kosong | Password yang tersimpan di berkas khusus pemilik. Tepat satu dari `password` dan `passwordEnv` wajib diisi. |
| `remote.auth.passwordEnv` | kosong | Nama variabel lingkungan khusus yang menyimpan password. `KANA_*` dan token dashboard Hermes ditolak. |
| `remote.instabox.machineId` | wajib bila `instabox` diisi | ID mesin Instabox untuk tombol bangunkan opsional. |
| `remote.instabox.executable` | `instabox` di `PATH` | Path absolut CLI Instabox; nama berkasnya harus `instabox`. |
| `remote.instabox.timeoutSeconds` | `120` | Total tunggu untuk mesin dan kesehatan Hermes, 10–600 detik. |
| `remote.instabox.env` | kosong | Nama variabel lingkungan tambahan untuk CLI Instabox, maksimal 32; kredensial Kana dan Hermes ditolak. |

Mesin remote harus menyediakan `/auth/password-login`, `/api/auth/ws-ticket`, `/api/ws`, dan `/api/health` di belakang TLS. Di Hermes remote, aktifkan provider `basic` dashboard dengan `HERMES_DASHBOARD_BASIC_AUTH_USERNAME` serta `HERMES_DASHBOARD_BASIC_AUTH_PASSWORD` atau `HERMES_DASHBOARD_BASIC_AUTH_PASSWORD_HASH`. Kana login dengan provider itu, menyimpan cookie di server, dan meminta ticket WebSocket sekali pakai baru untuk setiap koneksi. URL, username, dan password tetap di `config.json` atau lingkungan server dan tidak pernah mencapai browser. Auth token remote tidak didukung. `/restart` tidak dapat memulai ulang gateway remote; mulai ulang di mesin tempat ia berjalan.

Kana menyimpan model default-nya sendiri untuk percakapan baru secara terpisah untuk runtime lokal dan setiap dashboard remote yang dikonfigurasi, di `appstate.db` instalasi sehingga pilihan yang sama mengikuti Anda dari satu browser atau perangkat ke perangkat lain. Sebelum menerapkannya, Kana memeriksa bahwa katalog model langsung di Hermes tersebut masih memuat provider dan model itu; jika tidak, Kana memakai default Hermes untuk percakapan tersebut.

Settings → AI providers, juga ditautkan dari kontrol model AI, menampilkan endpoint custom. Satu provider adalah satu base URL dan kunci, dan satu provider bisa melayani banyak model. **Tambah model** pada provider hanya meminta ID model dan context length opsional; **Ubah** mengubah nama, base URL, atau kunci provider; **Provider baru** membuat endpoint beserta model pertamanya. Semuanya melalui API dashboard Hermes sendiri; Kana tidak pernah mengubah berkas Hermes secara langsung. API key yang Anda ketik langsung dikirim ke Hermes, yang menyimpannya di `.env` miliknya, dan Kana tidak menyimpan atau menampilkannya lagi. Biarkan kosong untuk mempertahankan kunci yang tersimpan. Gunakan alamat API saja untuk base URL, misalnya `https://api.example.com/v1`; akhiran `/chat/completions` yang ditempel akan dibuang otomatis. Model muncul di pemilih setelah disimpan dan tidak aktif sampai Anda memilihnya. Setelah disimpan, Kana memulai ulang Hermes lokal yang dikelolanya agar kunci dan keadaan saat mulai ikut berubah, lalu menyambung lagi. Kana tidak memulai ulang saat balasan sedang berjalan, untuk Hermes remote, untuk Hermes yang tidak dijalankan Kana, atau saat Hermes berhenti; baris status menjelaskan apakah restart berhasil dan apa yang perlu dilakukan bila tidak. Hermes tidak dapat mengganti nama ID model; setiap ID model adalah pill yang dapat diedit, dan menyimpan ID yang diubah akan menampilkan peringatan lebih dulu lalu menambahkan ID baru di samping ID asli. Endpoint yang ditampilkan Hermes dari pengaturan `model` langsung akan meminta kunci lagi, karena kunci itu tidak dapat dibaca melalui API. Entri bernama pada daftar `custom_providers` lama tidak ditampilkan oleh API tersebut; tambahkan model untuk entri itu di konfigurasi Hermes sendiri.

Balasan remote dapat menyebut `MEDIA:/path`. Path itu milik mesin remote, sehingga Kana hanya menampilkan nama berkasnya dan tidak dapat menyediakan unduhan. Kana tetap memerlukan server berjalan lama dengan folder data yang dapat ditulis; Hermes remote tidak membuatnya berjalan di platform serverless seperti Vercel.

#### Bangunkan Instabox

**Lewati jika mesin remote tidak pernah pause.** Apabila gateway remote adalah mesin Instabox yang berhenti saat menganggur, tambahkan `"instabox": { "machineId": "m_xxxxxxxx" }` di dalam `hermes.remote`. Tanpa `machineId`, tombol bangunkan tidak muncul dan Kana tidak memanggil CLI sama sekali; `machineId` hanya boleh berisi huruf, angka, titik, tanda hubung, dan garis bawah, sedangkan `executable` harus menunjuk berkas bernama `instabox`.

Layar koneksi kemudian menampilkan **Bangunkan Instabox**: Kana menjalankan `instabox resume <machineId>`, lalu `instabox start <machineId>` bila sandbox berhenti, dan memeriksa kesehatan sampai menjawab. Kana hanya menjalankan subperintah tetap `get`, `resume`, dan `start` dengan ID mesin dari `config.json`; tidak ada shell dan tidak ada argumen dari browser. CLI harus terpasang dan sudah login di mesin yang menjalankan Kana. CLI berjalan dari home akun layanan dengan allowlist environment kecil; tambahkan variabel token yang dibutuhkan CLI ke `remote.instabox.env`.

Kana tidak membangunkan mesin secara otomatis, menjalankan satu wake dalam satu waktu, dan menunggu 15 detik sebelum wake berikutnya. Membangunkan mesin tidak menjalankan `hermes serve`; jalankan sebagai service di mesin remote agar health menjawab setelah resume. Saat mesin tidak terjangkau, layar menampilkan **Hermes remote tidak terjangkau** dan menjadikan **Bangunkan Instabox** tindakan utama; layar membaca status mesin lewat rute yang sama dengan `instabox get <machineId> --json` (hanya baca), menampilkan **Membangunkan Instabox** selama permintaan berjalan, dan mengubah tindakan menjadi **Instabox sudah bangun** yang nonaktif setelah mesin berjalan atau sedang dinyalakan. Bila wake berhasil tetapi Kana tetap tidak bisa terhubung, layar menunjuk `hermes serve` dan kredensial dashboard remote.

## Membatasi permintaan dengan Jev {#guardrail}

**Lewati jika Anda tidak membutuhkan aturan tambahan.** Bagian `guardrails` memakai satu daftar aturan untuk dua lapisan. Setiap aturan Anda ikut dikirim di catatan prompt Kana pada setiap giliran, sehingga model Hermes melihat instruksi Anda; dan bila `apiKey` diisi serta ada setidaknya satu aturan, Kana juga memeriksa teks yang Anda ketik sebelum dikirim ke Hermes. Pemeriksaan itu mengajukan satu pertanyaan berprobabilitas kepada Jev, model TypeSafe. Jev mengembalikan probabilitas, bukan teks, dan Kana sendiri yang membandingkannya dengan ambang batas Anda lalu menolak pesannya. Aturan di catatan prompt adalah lapisan pencegahan, bukan pengganti pemeriksaan Jev: hanya pemeriksaan yang memutuskan menolak atau tidak.

Jika hanya ingin menuliskan aturan sebagai instruksi kepada model, cukup isi `rules`. Tidak ada permintaan TypeSafe dan tidak ada biaya:

```json
{
  "guardrails": {
    "rules": [
      "Never read, list, copy, change, or share anything under /home/you/my-secret."
    ]
  }
}
```

Jika ingin Jev ikut memeriksa setiap giliran, tambahkan `apiKey`:

```json
{
  "guardrails": {
    "apiKey": "sk-...",
    "rules": [
      "Never read, list, copy, change, or share anything under /home/you/my-secret."
    ]
  }
}
```

Biarkan `apiKey` kosong untuk mematikan pemeriksaan Jev: tidak ada permintaan TypeSafe yang dikirim dan tidak ada biaya yang keluar. Aturan Anda tidak hilang—daftar yang sama tetap dikirim sebagai instruksi di catatan prompt setiap giliran, jadi model tetap melihatnya, dan perubahan aturan berlaku pada giliran berikutnya tanpa memulai ulang Kana. Kunci yang kosong atau berisi spasi berarti pemeriksaan mati, bukan blok yang rusak, sehingga lima aturan bawaan pada `config.json` baru tidak pernah menolak pesan sebelum Anda menambahkan kunci.

| Kunci | Nilai bawaan | Keterangan |
| --- | --- | --- |
| `apiKey` | kosong | Kunci API TypeSafe Anda. Kosong atau tidak ada mematikan pemeriksaan Jev, tetapi aturan tetap dikirim sebagai instruksi di catatan prompt. |
| `model` | `"jev-latest"` | Model TypeSafe yang menjawab pertanyaan. |
| `threshold` | `0.7` | Kana menolak pesan begitu probabilitas dari Jev mencapai nilai ini, 0–1. Nilai di sekitar 0.5 berarti Jev tidak dapat memastikan; turunkan ambang batas untuk menolak lebih banyak percobaan yang berada di batas, dengan konsekuensi lebih banyak penolakan atas hal yang sebenarnya Anda maksud. |
| `whenUnavailable` | `"block"` | Yang dilakukan Kana terhadap pesan yang tidak dapat diperiksanya, karena TypeSafe tidak dapat dijangkau, menjawab dengan galat, atau memberi jawaban yang tidak dapat dibaca Kana: `"block"` menolak pesan, `"allow"` mengirimkannya tanpa pemeriksaan. |
| `timeoutSeconds` | `10` | Lama Kana menunggu TypeSafe, 1–120. |
| `rules` | lima aturan awal | Aturan Anda, maksimal 50, masing-masing satu pernyataan biasa tentang apa yang tidak boleh dilakukan Kana dan maksimal 1.000 karakter. Setiap aturan ikut dikirim di catatan prompt Kana pada setiap giliran, dan diperiksa Jev bila kunci diisi. Bila daftar ini kosong, pemeriksaan Jev tidak berjalan meskipun kunci diisi. `config.json` baru membawa lima aturan awal dan kunci kosong, jadi simpan yang Anda setujui dan ganti sisanya. |

Tulis setiap aturan sebagai satu pernyataan jelas dengan kata-kata Anda sendiri, dan sebutkan dengan tepat apa yang dilarang, termasuk jalur, perintah, atau layanan yang dicakupnya. Anda tidak pernah menulis pertanyaan, id, atau ambang batas per aturan: Kana mengajukan satu pertanyaan kepada Jev — apakah pesan ini meminta, mencoba, atau memungkinkan sesuatu yang dilarang aturan? — dan mengirim aturan Anda apa adanya. Jev diberi tahu bahwa ia menyaring pesan untuk agen yang dapat membaca dan menulis berkas serta menjalankan perintah, karena itulah yang membuat "bacakan berkas ini untukku" menjadi permintaan yang berdampak.

Tulis aturan dalam bahasa Inggris dan jaga setiap aturan tetap satu pernyataan jelas. Jev terutama dilatih dengan bahasa Inggris, dan pemeriksaan membaca aturan Anda secara harfiah, sehingga aturan yang menyebut tepat apa yang dilarang bekerja lebih baik daripada satu paragraf kebijakan.

Apabila jawaban Jev mencapai ambang batas Anda, Kana menampilkan satu kalimat tetap di percakapan sebagai ganti balasan, dan membiarkan pesan Anda tetap di atasnya. Tidak ada model yang melihat pesan itu, sehingga tidak ada balasan yang dikarang dan tidak ada yang ditulis ke transkrip Hermes. Kalimat itu tidak menyebut aturan tertentu, karena aturan dikirim sebagai satu pertanyaan dan yang kembali hanya satu angka.

Kana memeriksa teks pesan, teks perintah slash, dan teks `/steer`. Kana tidak memeriksa jawaban yang Anda berikan di tengah giliran, misalnya persetujuan atau jawaban atas pertanyaan Hermes, karena menolak jawaban itu akan membuat giliran tersangkut.

Yang perlu Anda sadari, ini penyaring maksud dan bukan sandbox. Kana tidak dapat mencegah Hermes mencapai berkas yang sama melalui jalur lain, dan Kana membaca teks giliran, bukan isi berkas lampiran. Pesan yang sangat panjang dapat melebihi batas baca Jev dan kemudian mengikuti `whenUnavailable`. Teks setiap giliran yang diperiksa dikirim ke TypeSafe, pihak ketiga, dan setiap giliran yang diperiksa memakan satu permintaan.

Blok `guardrails` yang tidak dapat dibaca Kana dilaporkan di bagian atas halaman ini dan menolak pesan, karena kebijakan yang tidak terbaca tidak sama dengan tidak ada kebijakan. `whenUnavailable` tetap dibaca dari blok itu, sehingga `"allow"` tetap tersedia. Tidak ada bagian Kana yang menulis berkas ini, jadi tidak ada pengaturan atau halaman yang dapat mengubah aturan Anda atau menampilkan kunci Anda.

## Membuka Kana dari jaringan {#deployment}

**Lewati jika Kana hanya dibuka dari komputer ini.** Dalam mode `"local"` (bawaan), Kana hanya dapat dibuka melalui `localhost`, `127.0.0.1`, atau `[::1]`; alamat lain ditolak. Ubah ke `"deployment"` apabila Kana dibuka melalui VPS, Nginx, atau jaringan, misalnya dari ponsel.

```json
{
  "deployment": {
    "mode": "deployment"
  }
}
```

`kana serve` menetapkan mode `deployment` untuk proses yang dijalankannya, sedangkan `kana` biasa mengikuti `deployment.mode` atau `KANA_DEPLOYMENT_MODE`. Kana selalu meminta kata sandi pada kedua mode.

## Menjalankan di server {#environment}

**Lewati bagian ini jika Anda memakai `kana` di laptop.** Variabel berikut ditujukan untuk operator service. Tetapkan pada lingkungan yang menjalankan `kana`, bukan di dalam `config.json`.

Bila sebuah pengaturan tersedia di beberapa tempat, urutan prioritasnya adalah opsi CLI, lalu variabel lingkungan, lalu `config.json`, lalu nilai bawaan. Contohnya `kana --port` mengalahkan `KANA_PORT` dan `PORT`.

| Variabel | Keterangan |
| --- | --- |
| `KANA_DATA_DIR` | Folder data Kana, termasuk `config.json` dan mesin suara; harus berupa path absolut. Apabila kosong, Kana menggunakan `~/.kana`; data dari rilis sebelumnya dipindahkan ke sana pada start berikutnya. Folder yang ditetapkan di sini tidak pernah dipindahkan oleh proses start. |
| `KANA_PORT` | Port halaman web Kana, 1024–65535. Nilai bawaannya `3000`; `$PORT` dan opsi `kana --port` juga membacanya. |
| `KANA_DEPLOYMENT_MODE` | `local` atau `deployment`; menggantikan `deployment.mode`. |
| `KANA_JWT_SECRET` | Rahasia penanda tangan sesi, minimal 32 karakter. Bila kosong, Kana membuat dan memakai ulang `jwt-secret` di folder data; nilai dari lingkungan selalu diutamakan. |
| `KANA_HERMES_BIN` | Path absolut program Hermes; menggantikan `hermes.executable`. |
| `KANA_TRUSTED_ORIGINS` | Alamat tambahan yang dipercaya, dipisahkan dengan koma. Diperlukan hanya apabila proxy mengubah header `Host` tanpa meneruskan `X-Forwarded-Host`, atau untuk membuka Kana dalam mode local melalui alamat lain. |
| `AUTH_COOKIE_SECURE` | Isi `true` untuk memaksa cookie sesi bertanda `Secure` ketika proxy tidak meneruskan `X-Forwarded-Proto: https`. |
| `KANA_DEV_ALLOWED_ORIGINS` | Khusus pengembangan: alamat tambahan yang diizinkan mengakses `next dev`. |

```sh
KANA_DEPLOYMENT_MODE=deployment KANA_PORT=3000 kana serve
```

Pemasangan di server tidak memerlukan `KANA_DATA_DIR`: akun layanan yang memiliki Hermes punya direktori home, dan `~/.kana` di dalamnya adalah folder datanya, sama seperti di desktop. Tetapkan variabel ini hanya untuk menaruh data di tempat lain, misalnya volume khusus. Untuk memindahkan data dari folder lama, lihat bagian **Dari versi lama**.

## Dari versi lama {#upgrade}

**Lewati jika ini instalasi baru.** Bagian ini hanya untuk config atau data dari rilis sebelumnya.

**Nama blok yang berubah.** Build lama menamai blok Instabox `hermes.remote.wake`; ganti menjadi `hermes.remote.instabox`. Kana menolak kunci lama dan meminta Anda mengganti namanya.

**Format suara lama.** `tts.provider: "openai-compatible"` dengan preset Pollinations masih diterima, tetapi tulis ulang ke `"pollinations"` dengan blok `tts.pollinations` agar sesuai dengan konfigurasi saat ini.

**Memindahkan folder data.** Root lama dari `$XDG_DATA_HOME/kana`, `~/.local/share/kana`, atau `data/` di folder kerja dipindahkan otomatis pada start berikutnya, selama `KANA_DATA_DIR` tidak ditetapkan. Root yang Anda tetapkan sendiri tidak pernah dipindahkan otomatis: hentikan Kana, lalu jalankan `kana migrate --from <folder-terkelola>` atau jalankan dengan `KANA_DATA_DIR` milik service yang diekspor. Tambahkan `--yes` untuk shell noninteraktif dan `--dry-run` untuk membaca rencananya.

Entri yang sudah ada di tujuan tidak ditimpa secara bawaan. Untuk menggantinya, tambahkan `--replace-existing`: rencana akan menyebut setiap keluarga database yang terpengaruh, isi tujuan disalin lebih dulu ke folder cadangan `.kana-migrate-backup-*` di dalam tujuan, lalu seluruh keluarga—termasuk berkas `-wal` dan `-shm` lama—diganti dengan salinan dari sumber yang sudah diverifikasi. Hapus folder cadangan itu setelah Kana memakai folder data yang baru. Gunakan `--delete-source` untuk menghapus entri sumber setelah dipindahkan.

Kana tidak mengedit file systemd atau service manager. Setelah migrasi, arahkan `KANA_DATA_DIR` ke folder baru atau hapus variabel itu, lalu mulai ulang service.

## Jika ada masalah {#troubleshooting}

Mulai dengan `kana doctor`. Perintah itu menunjukkan Hermes, kata sandi, konfigurasi, folder data, dan mesin suara yang benar-benar dipakai Kana.

| Gejala | Penyelesaian |
| --- | --- |
| **Pengaturan → Koneksi** melaporkan kesalahan pada `config.json` selain `guardrails` | Perbaiki kunci yang disebutkan dalam pesan, lalu simpan file. Blok `guardrails` dilaporkan di bagian Membatasi permintaan dengan Jev. |
| Hermes tidak ditemukan | Jalankan `kana doctor`. Apabila masalah berlanjut, isi `hermes.executable` atau `KANA_HERMES_BIN`. |
| Port 9119 sudah dipakai program lain | Ubah `hermes.port`, lalu mulai ulang Kana. |
| Data lama tidak ikut pindah | Lihat bagian **Dari versi lama**; gunakan `kana migrate --replace-existing` setelah membaca rencananya dengan `--dry-run`. |
| Tombol **Bangunkan Instabox** tidak muncul | Pastikan `hermes.remote` berisi `instabox.machineId`; tanpa blok itu Kana tidak memanggil CLI. Periksa juga bahwa CLI `instabox` terpasang dan sudah login di mesin yang menjalankan Kana. |
| Tombol **Bangunkan Instabox** nonaktif | Mesin sudah berjalan atau sedang dinyalakan. Jika Hermes tetap tidak menjawab, periksa `hermes serve` dan kredensial dashboard remote, bukan mesinnya. |
| Pesan ditolak padahal tidak melanggar aturan | Periksa `guardrails.threshold`; naikkan nilainya (mendekati 1) jika penolakan terlalu sering, dan turunkan untuk menolak lebih banyak percobaan yang berada di batas. Jika `whenUnavailable` bernilai `"block"`, pesan juga ditolak saat TypeSafe tidak dapat dijangkau atau jawabannya tidak terbaca. |
| Perubahan pada `~/.hermes/.env` atau server MCP Hermes belum berlaku | Ketik `/reload` (untuk `.env`) atau `/reload-mcp now` (untuk server MCP) di Kana. Untuk perubahan lain yang hanya dibaca Hermes saat dijalankan, ketik `/restart`; perintah ini hanya berlaku untuk Hermes yang dijalankan Kana. Model yang Anda tambahkan langsung ke `config.yaml` Hermes langsung muncul tanpa memulai ulang; provider atau model yang disimpan di Settings → AI providers memulai ulang Hermes yang dikelola Kana secara otomatis bila memungkinkan. |
| Suara untuk balasan panjang gagal karena batas waktu habis | Naikkan `tts.timeoutSeconds` serta batas waktu proxy, apabila ada. |
| Pesan `Pollinations returned HTTP 401` | API key kosong atau tidak valid. Periksa `tts.pollinations.apiKey`. |
| Pesan `Pollinations returned HTTP 402` | Saldo pollen tidak mencukupi. Isi ulang saldo di [enter.pollinations.ai](https://enter.pollinations.ai). |
