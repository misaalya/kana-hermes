# Panduan konfigurasi

> Satu file JSON mengatur mesin suara, Hermes, dan cara Kana diakses. Semua pengaturan opsional: tanpa perubahan, Kana berjalan dengan nilai bawaannya.

File konfigurasinya adalah `config.json` di folder data Kana. Pada instalasi ini:

```kana-config-path
~/.kana/config.json
```

Jalankan `kana config` untuk membukanya, atau `npm run config` dari kode sumber. Apabila file belum ada, Kana membuatnya lebih dulu dan tidak pernah menimpa file yang sudah ada. File dibuka dengan editor yang Anda tetapkan pada `VISUAL` atau `EDITOR`; apabila keduanya kosong, nilai editor mengandung argumen (misalnya `code -w`), atau tidak ada terminal interaktif, Kana hanya menampilkan lokasinya.

Perubahan berlaku pada balasan berikutnya tanpa memulai ulang Kana. Satu-satunya pengecualian adalah bagian `hermes`, yang baru dibaca saat Kana dimulai. Apabila ada kunci yang salah, **Pengaturan → Koneksi** menampilkan kesalahannya beserta bagian yang perlu diperbaiki. Blok `guardrails` memiliki pemeriksa sendiri; bila tidak dapat dipakai, statusnya dilaporkan di halaman ini.

## Mulai cepat {#quickstart}

Semua ini opsional, dan biasanya Anda hanya perlu satu. Seluruhnya dibahas lebih rinci pada bagian berikutnya.

**Suara lokal (bawaan).** Suara dibuat di komputer Anda, tanpa biaya dan tanpa internet:

```json
{
  "tts": {
    "provider": "irodori-local"
  }
}
```

Unduh mesin suaranya lebih dulu melalui **Pengaturan → Suara → Unduh mesin suara**.

**Pollinations (ElevenLabs).** Suara dibuat layanan daring, jadi komputer Anda tidak dibebani:

```json
{
  "tts": {
    "provider": "pollinations",
    "pollinations": {
      "apiKey": "sk_YOUR_POLLINATIONS_KEY",
      "model": "elevenlabs/eleven-v3",
      "voice": "rachel"
    }
  }
}
```

**Pollinations dengan arahan gaya bicara.** Model Qwen mematuhi arahan seperti "A calm, gentle voice.":

```json
{
  "tts": {
    "provider": "pollinations",
    "pollinations": {
      "apiKey": "sk_YOUR_POLLINATIONS_KEY",
      "model": "qwen/qwen3-tts-instruct-flash",
      "instructions": "A calm, gentle voice."
    }
  }
}
```

**Komputer berspesifikasi rendah.** Suara lokal tetap jalan, hanya dengan langkah sampling dan thread yang dikurangi:

```json
{
  "tts": {
    "provider": "irodori-local",
    "timeoutSeconds": 1800,
    "irodoriLocal": {
      "steps": 8,
      "threads": 4
    }
  }
}
```

**Server atau VPS.** Kana dibuka dari jaringan, bukan hanya dari komputer yang menjalankannya:

```json
{
  "deployment": {
    "mode": "deployment"
  }
}
```

## Mesin suara {#voice}

Bagian `tts` menentukan mesin suara dan batas waktunya. Ada dua pilihan, dan Anda memilihnya lewat `provider`.

| Mesin suara | `provider` | Cocok untuk |
| --- | --- | --- |
| Suara lokal (Irodori) | `"irodori-local"` | Penggunaan tanpa biaya dan tanpa internet. Membebani CPU. |
| Pollinations | `"pollinations"` | Komputer berspesifikasi rendah. Memerlukan internet dan API key berbayar. |

`provider` boleh dikosongkan. Kana lalu memilih `"pollinations"` apabila hanya blok `pollinations` yang Anda tulis, dan `"irodori-local"` untuk kondisi lainnya. Isi `provider` secara tegas apabila Anda menulis blok `irodoriLocal` dan `pollinations` bersamaan.

Hanya blok milik mesin yang sedang dipilih yang dibaca, sehingga Anda dapat menyimpan pengaturan kedua mesin dalam satu file dan berpindah cukup dengan mengubah `provider`.

`timeoutSeconds` (bawaan `900`, rentang 1–3600) membatasi pembuatan satu suara, termasuk waktu tunggu antrean. Naikkan nilainya apabila suara untuk balasan panjang habis waktu. Apabila Kana berada di balik Nginx atau proxy lain, atur batas waktu baca proxy sedikit di atasnya, misalnya 910 detik untuk nilai bawaan 900.

```json
{
  "tts": {
    "timeoutSeconds": 1800
  }
}
```

Apabila suara gagal dibuat, balasan tetap muncul sebagai teks disertai pesan kesalahan. Kana tidak beralih ke mesin suara lain dengan sendirinya.

## Suara lokal (Irodori) {#irodori}

Suara dibuat di CPU komputer Anda dengan model [Irodori-TTS v4.1 Anime](https://huggingface.co/phasefield-audio/Irodori-TTS-v4.1-Anime). Tidak perlu GPU, dan teks balasan tidak dikirim ke layanan lain.

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

Pada komputer berspesifikasi rendah, gunakan `steps` bernilai `8`. Suaranya sedikit kurang halus, tetapi selesai lebih cepat.

## Pollinations {#pollinations}

Suara dibuat layanan daring [Pollinations](https://gen.pollinations.ai/docs), dengan pilihan model ElevenLabs, Qwen, xAI, dan penyedia lain melalui satu API key. Komputer Anda tidak dibebani.

API key dibuat di [enter.pollinations.ai](https://enter.pollinations.ai/keys); pakai key rahasia berawalan `sk_`. Seluruh model suara berbayar dan menggunakan saldo pollen. Daftar model dan suara yang tersedia ada di [gen.pollinations.ai/audio/models](https://gen.pollinations.ai/audio/models).

Model yang umum dipakai adalah `elevenlabs/eleven-v3`, `elevenlabs/eleven-flash-v2.5`, `elevenlabs/eleven-multilingual-v2`, `qwen/qwen3-tts-instruct-flash`, `qwen/qwen3-tts-flash`, `x-ai/grok-tts`, dan `hexgrad/kokoro-82m`.

Pengaturan berikut ditulis di dalam `tts.pollinations`. Hanya `apiKey` yang wajib.

| Kunci | Keterangan |
| --- | --- |
| `apiKey` | API key Pollinations. Hanya disimpan di komputer atau server yang menjalankan Kana dan tidak pernah dikirim ke browser. |
| `model` | ID model dari daftar di atas, misalnya `elevenlabs/eleven-v3`. Alias seperti `elevenlabs` tetap berlaku. Apabila kosong, Pollinations memilih model bawaannya. |
| `voice` | Nama suara yang tersedia pada model tersebut, atau ID suara ElevenLabs milik Anda. Apabila kosong, Pollinations memilih suara bawaannya. |
| `instructions` | Arahan gaya bicara untuk model yang mendukungnya, misalnya `qwen/qwen3-tts-instruct-flash`. |
| `format` | `"mp3"` (bawaan), `"opus"`, `"aac"`, `"flac"`, atau `"wav"`. |

Contoh dengan model ElevenLabs berlatensi rendah:

```json
{
  "tts": {
    "provider": "pollinations",
    "pollinations": {
      "apiKey": "sk_YOUR_POLLINATIONS_KEY",
      "model": "elevenlabs/eleven-flash-v2.5",
      "voice": "rachel",
      "format": "mp3"
    }
  }
}
```

Satu permintaan suara ke Pollinations maksimal 10.000 karakter. Pada pengiriman utuh (bawaan), balasan yang lebih panjang tidak dikirim ke Pollinations dan ditampilkan sebagai teks disertai pesan kesalahan.

Konfigurasi lama `"provider": "openai-compatible"` dengan preset Pollinations masih berfungsi dan menghasilkan suara yang sama, tetapi sebaiknya ditulis ulang ke format di atas.

## Hermes {#hermes}

Hermes adalah agen AI yang memproses pesan dan menyusun balasan Kana. Kana menemukan dan menjalankannya secara otomatis, sehingga bagian `hermes` hanya perlu diisi apabila Hermes tidak ditemukan, port bawaannya sudah dipakai program lain, atau Hermes harus bekerja di folder tertentu.

| Kunci | Nilai bawaan | Keterangan |
| --- | --- | --- |
| `executable` | Dicari otomatis | Path absolut program `hermes`. Isi hanya apabila `kana doctor` tetap tidak menemukannya. |
| `port` | `9119` | Port Hermes yang dijalankan Kana, 1024–65535. |
| `workingDirectory` | Folder home pengguna | Path absolut folder kerja awal Hermes. Path relatif pada alat file dan terminal Hermes mengacu ke folder ini, dan hanya berlaku untuk Hermes yang dijalankan Kana. |

```json
{
  "hermes": {
    "port": 9120,
    "workingDirectory": "/home/pengguna/proyek"
  }
}
```

Perubahan pada bagian `hermes` baru berlaku setelah Kana dimulai ulang.

### Gateway Hermes yang sudah berjalan

Di Linux, apabila `hermes serve` sudah mendengarkan port, Kana mengadopsinya hanya jika proses tersebut dijalankan dengan `HERMES_DASHBOARD_SESSION_TOKEN` pada lingkungannya. Tanpa variabel itu, Hermes membuat token acak yang hanya diketahui prosesnya sendiri, sehingga program lain tidak dapat terhubung. Layar koneksi Kana menyebutkan keadaan ini dan meminta Anda menghentikan proses tersebut di terminal asalnya (Ctrl+C), lalu memilih "Hubungkan lagi"; Kana akan menjalankan Hermes sendiri dengan token yang dibuat dan disimpannya di server. Untuk tetap memakai gateway yang dijalankan manual, sediakan tokennya sendiri:

```bash
HERMES_DASHBOARD_SESSION_TOKEN=<token> hermes serve --host 127.0.0.1 --port 9119
```

Kana membaca token dari lingkungan proses itu, dan token tetap tersimpan di server, bukan di browser.

### Gateway Hermes di mesin lain

Secara bawaan Kana memakai Hermes di mesinnya sendiri. Tambahkan blok `remote` untuk terhubung ke gateway di mesin lain; Kana kemudian tidak mencari, menjalankan, memulai ulang, atau menghentikan Hermes lokal. Hapus blok itu untuk kembali ke pencarian lokal.

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

```json
{
  "hermes": {
    "remote": {
      "url": "wss://hermes.example.com",
      "auth": {
        "mode": "password",
        "username": "misa",
        "passwordEnv": "HERMES_REMOTE_PASSWORD"
      },
      "instabox": { "machineId": "m_xxxxxxxx", "timeoutSeconds": 120 }
    }
  }
}
```

Mesin remote harus menyediakan `/auth/password-login`, `/api/auth/ws-ticket`, `/api/ws`, dan `/api/health` di belakang TLS. Di Hermes remote, aktifkan provider `basic` dashboard dengan `HERMES_DASHBOARD_BASIC_AUTH_USERNAME` serta `HERMES_DASHBOARD_BASIC_AUTH_PASSWORD` atau `HERMES_DASHBOARD_BASIC_AUTH_PASSWORD_HASH`. Kana login dengan provider itu, menyimpan cookie di server, dan meminta ticket WebSocket sekali pakai baru untuk setiap koneksi. URL, username, dan password tetap di `config.json` atau lingkungan server dan tidak pernah mencapai browser. Auth token remote tidak didukung. `/restart` tidak dapat memulai ulang gateway remote; mulai ulang di mesin tempat ia berjalan.

Kana menyimpan model default-nya sendiri untuk percakapan baru secara terpisah untuk runtime lokal dan setiap dashboard remote yang dikonfigurasi, di `appstate.db` instalasi sehingga pilihan yang sama mengikuti Anda dari satu browser atau perangkat ke perangkat lain. Sebelum menerapkannya, Kana memeriksa bahwa katalog model langsung di Hermes tersebut masih memuat provider dan model itu; jika tidak, Kana memakai default Hermes untuk percakapan tersebut.

Balasan remote dapat menyebut `MEDIA:/path`. Path itu milik mesin remote, sehingga Kana hanya menampilkan nama berkasnya dan tidak dapat menyediakan unduhan. Kana tetap memerlukan server berjalan lama dengan folder data yang dapat ditulis; Hermes remote tidak membuatnya berjalan di platform serverless seperti Vercel.

#### Bangunkan Instabox

Build lama menamai blok ini `wake`; ganti namanya menjadi `instabox`, karena blok ini mengatur mesin Instabox. Apabila gateway remote adalah mesin Instabox yang berhenti saat menganggur, atur `remote.instabox`. Tanpa `machineId`, tombol bangunkan tidak muncul dan Kana tidak memanggil CLI sama sekali; `machineId` hanya boleh berisi huruf, angka, titik, tanda hubung, dan garis bawah, sedangkan `executable` harus menunjuk berkas bernama `instabox`. Layar koneksi kemudian menampilkan **Bangunkan Instabox**: Kana menjalankan `instabox resume <machineId>`, lalu `instabox start <machineId>` bila sandbox berhenti, dan memeriksa kesehatan sampai menjawab. Kana hanya menjalankan subperintah tetap `get`, `resume`, dan `start` dengan ID mesin dari `config.json`; tidak ada shell dan tidak ada argumen dari browser. CLI harus terpasang dan sudah login di mesin yang menjalankan Kana. CLI berjalan dari home akun layanan dengan allowlist environment kecil; tambahkan variabel token yang dibutuhkan CLI ke `remote.instabox.env`. Kana tidak membangunkan mesin secara otomatis, menjalankan satu wake dalam satu waktu, dan menunggu 15 detik sebelum wake berikutnya. Membangunkan mesin tidak menjalankan `hermes serve`; jalankan sebagai service di mesin remote agar health menjawab setelah resume. Saat mesin tidak terjangkau, layar menampilkan **Hermes remote tidak terjangkau** dan menjadikan **Bangunkan Instabox** tindakan utama; layar membaca status mesin lewat rute yang sama dengan `instabox get <machineId> --json` (hanya baca), menampilkan **Membangunkan Instabox** selama permintaan berjalan, dan mengubah tindakan menjadi **Instabox sudah bangun** yang nonaktif setelah mesin berjalan atau sedang dinyalakan. Bila wake berhasil tetapi Kana tetap tidak bisa terhubung, layar menunjuk `hermes serve` dan kredensial dashboard remote.

## Guardrail prompt {#guardrail}

Bagian `guardrails` memakai satu daftar aturan untuk dua lapisan. Setiap aturan Anda ikut dikirim di catatan prompt Kana pada setiap giliran, sehingga model Hermes melihat instruksi Anda; dan bila `apiKey` diisi serta ada setidaknya satu aturan, Kana juga memeriksa teks yang Anda ketik sebelum dikirim ke Hermes. Pemeriksaan itu mengajukan satu pertanyaan berprobabilitas kepada Jev, model TypeSafe. Jev mengembalikan probabilitas, bukan teks, dan Kana sendiri yang membandingkannya dengan ambang batas Anda lalu menolak pesannya. Aturan di catatan prompt adalah lapisan pencegahan, bukan pengganti pemeriksaan Jev: hanya pemeriksaan yang memutuskan menolak atau tidak.

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

```json
{
  "guardrails": {
    "apiKey": "sk-...",
    "rules": [
      "Never read, list, copy, change, or share anything under /home/you/my-secret.",
      "Never send my files, passwords, or API keys to a remote service.",
      "Never help write malware, exploits, or phishing pages."
    ]
  }
}
```

Tulis aturan dalam bahasa Inggris dan jaga setiap aturan tetap satu pernyataan jelas. Jev terutama dilatih dengan bahasa Inggris, dan pemeriksaan membaca aturan Anda secara harfiah, sehingga aturan yang menyebut tepat apa yang dilarang bekerja lebih baik daripada satu paragraf kebijakan.

Apabila jawaban Jev mencapai ambang batas Anda, Kana menampilkan satu kalimat tetap di percakapan sebagai ganti balasan, dan membiarkan pesan Anda tetap di atasnya. Tidak ada model yang melihat pesan itu, sehingga tidak ada balasan yang dikarang dan tidak ada yang ditulis ke transkrip Hermes. Kalimat itu tidak menyebut aturan tertentu, karena aturan dikirim sebagai satu pertanyaan dan yang kembali hanya satu angka.

Kana memeriksa teks pesan, teks perintah slash, dan teks `/steer`. Kana tidak memeriksa jawaban yang Anda berikan di tengah giliran, misalnya persetujuan atau jawaban atas pertanyaan Hermes, karena menolak jawaban itu akan membuat giliran tersangkut.

Yang perlu Anda sadari, ini penyaring maksud dan bukan sandbox. Kana tidak dapat mencegah Hermes mencapai berkas yang sama melalui jalur lain, dan Kana membaca teks giliran, bukan isi berkas lampiran. Pesan yang sangat panjang dapat melebihi batas baca Jev dan kemudian mengikuti `whenUnavailable`. Teks setiap giliran yang diperiksa dikirim ke TypeSafe, pihak ketiga, dan setiap giliran yang diperiksa memakan satu permintaan.

Blok `guardrails` yang tidak dapat dibaca Kana dilaporkan di bagian atas halaman ini dan menolak pesan, karena kebijakan yang tidak terbaca tidak sama dengan tidak ada kebijakan. `whenUnavailable` tetap dibaca dari blok itu, sehingga `"allow"` tetap tersedia. Tidak ada bagian Kana yang menulis berkas ini, jadi tidak ada pengaturan atau halaman yang dapat mengubah aturan Anda atau menampilkan kunci Anda.

## Akses jaringan {#deployment}

Bagian `deployment` menyatakan cara Kana diakses. Dalam mode `"local"` (bawaan), Kana hanya dapat dibuka dari komputer yang menjalankannya, melalui `localhost`, `127.0.0.1`, atau `[::1]`; alamat lain ditolak. Ubah ke `"deployment"` apabila Kana dibuka melalui VPS, Nginx, atau jaringan, misalnya dari ponsel.

```json
{
  "deployment": {
    "mode": "deployment"
  }
}
```

`kana serve` menetapkan mode `deployment` untuk proses yang dijalankannya, sedangkan `kana` biasa mengikuti `deployment.mode` atau `KANA_DEPLOYMENT_MODE`. Kana selalu meminta kata sandi pada kedua mode.

## Variabel lingkungan {#environment}

Variabel berikut ditujukan untuk pemasangan di server. Tetapkan pada lingkungan yang menjalankan `kana`, bukan di dalam `config.json`, karena nilainya diutamakan di atas isi file.

| Variabel | Keterangan |
| --- | --- |
| `KANA_DATA_DIR` | Folder data Kana, termasuk `config.json` dan mesin suara; harus berupa path absolut. Apabila kosong, Kana menggunakan `~/.kana`; data dari rilis sebelumnya (`$XDG_DATA_HOME/kana`, `~/.local/share/kana`, dan `data/` di folder kerja) dipindahkan ke sana pada start berikutnya. Folder yang ditetapkan di sini tidak pernah dipindahkan oleh proses start: `kana migrate` menyalinnya ke `~/.kana` saat Anda memintanya. |
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

Pemasangan di server tidak memerlukan `KANA_DATA_DIR`: akun layanan yang memiliki Hermes punya direktori home, dan `~/.kana` di dalamnya adalah folder datanya, sama seperti di desktop. Tetapkan variabel ini hanya untuk menaruh data di tempat lain, misalnya volume khusus.

Untuk memindahkan folder terkelola ke `~/.kana`, hentikan Kana lalu jalankan `kana migrate --from <folder-terkelola>`; Anda juga dapat menjalankannya dengan `KANA_DATA_DIR` milik service yang diekspor. Tambahkan `--yes` untuk shell noninteraktif. Perintah itu menampilkan setiap entri beserta ukurannya, menyalin dan memverifikasi setiap berkas, membiarkan folder asal tetap utuh, lalu meminta Anda mengarahkan `KANA_DATA_DIR` ke `~/.kana` atau menghapusnya. Tambahkan `--delete-source` untuk memindahkan entri alih-alih menyalinnya, dan `--dry-run` untuk membaca rencananya tanpa mengubah apa pun.

Entri yang sudah ada di tujuan tidak ditimpa secara bawaan; keluarga database lama di `~/.kana` tetap dipakai dan data sumber dilewati. Tambahkan `--replace-existing` untuk menggantinya: rencana akan menyebut setiap keluarga database yang terpengaruh, isi tujuan disalin lebih dulu ke folder cadangan `.kana-migrate-backup-*` di dalam tujuan, lalu seluruh keluarga—termasuk berkas `-wal` dan `-shm` lama—diganti dengan salinan dari sumber yang sudah diverifikasi. Hapus folder cadangan itu setelah Kana memakai folder data yang baru.

Pengaturan suara tidak memiliki variabel lingkungan dan hanya dapat diubah melalui `config.json`.

## Kesalahan umum {#troubleshooting}

| Gejala | Penyelesaian |
| --- | --- |
| **Pengaturan → Koneksi** melaporkan kesalahan pada `config.json` selain `guardrails` | Perbaiki kunci yang disebutkan dalam pesan, lalu simpan file. Blok `guardrails` dilaporkan di bagian Guardrail prompt halaman ini. |
| Hermes tidak ditemukan | Jalankan `kana doctor`. Apabila masalah berlanjut, isi `hermes.executable` atau `KANA_HERMES_BIN`. |
| Port 9119 sudah dipakai program lain | Ubah `hermes.port`, lalu mulai ulang Kana. |
| Data lama di `~/.kana` tidak ikut pindah | Hentikan Kana, lalu jalankan `kana migrate --from <folder-terkelola> --replace-existing --dry-run` untuk melihat keluarga database yang akan diganti, kemudian ulangi tanpa `--dry-run`. Backup tersimpan di folder `.kana-migrate-backup-*` di dalam tujuan. |
| Tombol **Bangunkan Instabox** tidak muncul | Pastikan `hermes.remote` berisi `instabox.machineId`; tanpa blok itu Kana tidak memanggil CLI. Periksa juga bahwa CLI `instabox` terpasang dan sudah login di mesin yang menjalankan Kana. |
| Tombol **Bangunkan Instabox** nonaktif | Mesin sudah berjalan atau sedang dinyalakan. Jika Hermes tetap tidak menjawab, periksa `hermes serve` dan kredensial dashboard remote, bukan mesinnya. |
| Pesan ditolak padahal tidak melanggar aturan | Periksa `guardrails.threshold`; naikkan nilainya (mendekati 1) jika penolakan terlalu sering, dan turunkan untuk menolak lebih banyak percobaan yang berada di batas. Jika `whenUnavailable` bernilai `"block"`, pesan juga ditolak saat TypeSafe tidak dapat dijangkau atau jawabannya tidak terbaca. |
| Perubahan pada `~/.hermes/.env` atau server MCP Hermes belum berlaku | Ketik `/reload` (untuk `.env`) atau `/reload-mcp now` (untuk server MCP) di Kana. Untuk perubahan lain yang hanya dibaca Hermes saat dijalankan, ketik `/restart`; perintah ini hanya berlaku untuk Hermes yang dijalankan Kana. Model baru di `config.yaml` Hermes langsung muncul tanpa memulai ulang. |
| Suara untuk balasan panjang gagal karena batas waktu habis | Naikkan `tts.timeoutSeconds` serta batas waktu proxy, apabila ada. |
| Pesan `Pollinations returned HTTP 401` | API key kosong atau tidak valid. Periksa `tts.pollinations.apiKey`. |
| Pesan `Pollinations returned HTTP 402` | Saldo pollen tidak mencukupi. Isi ulang saldo di [enter.pollinations.ai](https://enter.pollinations.ai). |
