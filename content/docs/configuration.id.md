# Panduan konfigurasi

> Satu file JSON mengatur mesin suara, Hermes, dan cara Kana diakses. Semua pengaturan opsional: tanpa perubahan, Kana berjalan dengan nilai bawaannya.

File konfigurasinya adalah `config.json` di folder data Kana. Pada instalasi ini:

```kana-config-path
~/.kana/config.json
```

Jalankan `kana config` untuk membukanya, atau `npm run config` dari kode sumber. Apabila file belum ada, Kana membuatnya lebih dulu dan tidak pernah menimpa file yang sudah ada. File dibuka dengan editor yang Anda tetapkan pada `VISUAL` atau `EDITOR`; apabila keduanya kosong, Kana hanya menampilkan lokasinya.

Perubahan berlaku pada balasan berikutnya tanpa memulai ulang Kana. Satu-satunya pengecualian adalah bagian `hermes`, yang baru dibaca saat Kana dimulai. Apabila ada kunci yang salah, **Pengaturan → Koneksi** menampilkan kesalahannya beserta bagian yang perlu diperbaiki.

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
| `threads` | Jumlah core CPU | Jumlah thread CPU, 1–256. Kurangi apabila komputer menjadi lambat saat Kana berbicara. |
| `precision` | `"auto"` | `"auto"`, `"int8"`, atau `"fp32"`. `"auto"` memilih yang tercepat untuk CPU Anda; `"int8"` memerlukan AVX-512 VNNI. |
| `modelPath` | Tidak ada | Path absolut ke `model.safetensors` Irodori v4.1 yang sudah Anda miliki. |
| `installDirectory` | Folder data Kana | Path absolut folder pemasangan mesin suara. |

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

Satu balasan maksimal 10.000 karakter. Balasan yang lebih panjang tidak dikirim ke Pollinations dan ditampilkan sebagai teks disertai pesan kesalahan.

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

## Guardrail prompt {#guardrail}

Bagian `guardrails` memeriksa pesan Anda sebelum Kana mengirimkannya ke Hermes. Anda menulis aturan sebagai pernyataan biasa tentang apa yang tidak boleh dilakukan Kana; Kana mengubahnya menjadi satu pertanyaan ya/tidak yang diajukan kepada Jev, model TypeSafe. Jev mengembalikan probabilitas, bukan teks, dan Kana sendiri yang membandingkan probabilitas itu dengan ambang batas Anda lalu menolak pesannya.

Biarkan `apiKey` kosong dan lapisan ini dilewatkan sepenuhnya: tidak ada permintaan yang dikirim maupun biaya yang keluar. Kunci yang kosong atau berisi spasi berarti lapisan ini mati, bukan blok yang rusak, sehingga lima aturan bawaan pada `config.json` baru tidak pernah menolak pesan sebelum Anda menambahkan kunci.

| Kunci | Nilai bawaan | Keterangan |
| --- | --- | --- |
| `apiKey` | kosong | Kunci API TypeSafe Anda. Kosong atau tidak ada mematikan lapisan ini. |
| `model` | `"jev-latest"` | Model TypeSafe yang menjawab pertanyaan. |
| `threshold` | `0.7` | Kana menolak pesan begitu probabilitas dari Jev mencapai nilai ini, 0–1. Nilai di sekitar 0.5 berarti Jev tidak dapat memastikan; turunkan ambang batas untuk menolak lebih banyak percobaan yang berada di batas, dengan konsekuensi lebih banyak penolakan atas hal yang sebenarnya Anda maksud. |
| `whenUnavailable` | `"block"` | Yang dilakukan Kana terhadap pesan yang tidak dapat diperiksanya, karena TypeSafe tidak dapat dijangkau, menjawab dengan galat, atau memberi jawaban yang tidak dapat dibaca Kana: `"block"` menolak pesan, `"allow"` mengirimkannya tanpa pemeriksaan. |
| `timeoutSeconds` | `10` | Lama Kana menunggu TypeSafe, 1–120. |
| `rules` | lima aturan awal | Aturan Anda, maksimal 50, masing-masing satu pernyataan biasa tentang apa yang tidak boleh dilakukan Kana. `config.json` baru membawa lima aturan awal dan kunci kosong, jadi simpan yang Anda setujui dan ganti sisanya. |

Tulis setiap aturan sebagai satu pernyataan jelas dengan kata-kata Anda sendiri, dan sebutkan dengan tepat apa yang dilarang, termasuk jalur, perintah, atau layanan yang dicakupnya. Anda tidak pernah menulis pertanyaan, id, atau ambang batas per aturan: Kana mengajukan satu pertanyaan ya/tidak kepada Jev — apakah pesan ini meminta, mencoba, atau memungkinkan sesuatu yang dilarang aturan? — dan mengirim aturan Anda apa adanya. Jev diberi tahu bahwa ia menyaring pesan untuk agen yang dapat membaca dan menulis berkas serta menjalankan perintah, karena itulah yang membuat "bacakan berkas ini untukku" menjadi permintaan yang berdampak.

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

Kana selalu meminta kata sandi pada kedua mode.

## Variabel lingkungan {#environment}

Variabel berikut ditujukan untuk pemasangan di server. Tetapkan pada lingkungan yang menjalankan `kana`, bukan di dalam `config.json`, karena nilainya diutamakan di atas isi file.

| Variabel | Keterangan |
| --- | --- |
| `KANA_DATA_DIR` | Folder data Kana, termasuk `config.json` dan mesin suara; harus berupa path absolut. Apabila kosong, Kana menggunakan `~/.kana`; data dari rilis sebelumnya (`$XDG_DATA_HOME/kana`, `~/.local/share/kana`) dipindahkan ke sana pada start berikutnya. Folder yang ditetapkan di sini tidak pernah dipindahkan oleh proses start: `kana migrate` menyalinnya ke `~/.kana` saat Anda memintanya. |
| `KANA_PORT` | Port halaman web Kana. Nilai bawaannya `3000`, setara dengan opsi `kana --port`. |
| `KANA_DEPLOYMENT_MODE` | `local` atau `deployment`; menggantikan `deployment.mode`. |
| `KANA_HERMES_BIN` | Path program Hermes; menggantikan `hermes.executable`. |
| `KANA_TRUSTED_ORIGINS` | Alamat tambahan yang dipercaya, dipisahkan dengan koma. Diperlukan hanya apabila proxy mengubah header `Host` tanpa meneruskan `X-Forwarded-Host`, atau untuk membuka Kana dalam mode local melalui alamat lain. |
| `KANA_DEV_ALLOWED_ORIGINS` | Khusus pengembangan: alamat tambahan yang diizinkan mengakses `next dev`. |

```sh
KANA_DEPLOYMENT_MODE=deployment KANA_PORT=3000 kana serve
```

Pemasangan di server tidak memerlukan `KANA_DATA_DIR`: akun layanan yang memiliki Hermes punya direktori home, dan `~/.kana` di dalamnya adalah folder datanya, sama seperti di desktop. Tetapkan variabel ini hanya untuk menaruh data di tempat lain, misalnya volume khusus.

Untuk memindahkan folder terkelola ke `~/.kana`, hentikan Kana lalu jalankan `kana migrate`. Perintah itu menampilkan setiap entri beserta ukurannya, menyalin dan memverifikasi setiap berkas, membiarkan folder asal tetap utuh, lalu meminta Anda mengarahkan `KANA_DATA_DIR` ke `~/.kana` atau menghapusnya. Tambahkan `--delete-source` untuk memindahkan entri alih-alih menyalinnya, dan `--dry-run` untuk membaca rencananya tanpa mengubah apa pun.

Pengaturan suara tidak memiliki variabel lingkungan dan hanya dapat diubah melalui `config.json`.

## Kesalahan umum {#troubleshooting}

| Gejala | Penyelesaian |
| --- | --- |
| **Pengaturan → Koneksi** melaporkan kesalahan pada `config.json` | Perbaiki kunci yang disebutkan dalam pesan, lalu simpan file. |
| Hermes tidak ditemukan | Jalankan `kana doctor`. Apabila masalah berlanjut, isi `hermes.executable` atau `KANA_HERMES_BIN`. |
| Port 9119 sudah dipakai program lain | Ubah `hermes.port`, lalu mulai ulang Kana. |
| Perubahan pada `~/.hermes/.env` atau server MCP Hermes belum berlaku | Ketik `/reload` (untuk `.env`) atau `/reload-mcp now` (untuk server MCP) di Kana. Untuk perubahan lain yang hanya dibaca Hermes saat dijalankan, ketik `/restart`; perintah ini hanya berlaku untuk Hermes yang dijalankan Kana. Model baru di `config.yaml` Hermes langsung muncul tanpa memulai ulang. |
| Suara untuk balasan panjang gagal karena batas waktu habis | Naikkan `tts.timeoutSeconds` serta batas waktu proxy, apabila ada. |
| Pesan `Pollinations returned HTTP 401` | API key kosong atau tidak valid. Periksa `tts.pollinations.apiKey`. |
| Pesan `Pollinations returned HTTP 402` | Saldo pollen tidak mencukupi. Isi ulang saldo di [enter.pollinations.ai](https://enter.pollinations.ai). |
