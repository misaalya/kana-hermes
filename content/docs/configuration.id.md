# Panduan konfigurasi

> Atur mesin suara, Hermes, dan akses jaringan Kana melalui satu file JSON. Seluruh pengaturan bersifat opsional; tanpa perubahan, Kana berjalan dengan nilai bawaan.

**File konfigurasi:** `config.json` di folder data Kana. Lokasi pada instalasi ini:

```kana-config-path
~/.kana/config.json
```

**Membuka file:** jalankan `kana config`, atau `npm run config` dari kode sumber. Apabila file belum ada, Kana membuatnya terlebih dahulu; file yang sudah ada tidak pernah ditimpa. File dibuka dengan editor pada variabel `VISUAL` atau `EDITOR`. Apabila keduanya tidak diatur, Kana hanya menampilkan lokasi file.

**Menerapkan perubahan:** simpan file. Perubahan berlaku mulai balasan berikutnya tanpa memulai ulang Kana, kecuali bagian `hermes`.

**Memeriksa kesalahan:** buka **Pengaturan → Koneksi**. Kesalahan pada `config.json` ditampilkan beserta bagian yang perlu diperbaiki.

## Mulai cepat {#quickstart}

### Suara lokal (bawaan)

```json
{
  "tts": {
    "provider": "irodori-local"
  }
}
```

Unduh mesin suara terlebih dahulu melalui **Pengaturan → Suara → Unduh mesin suara**.

### Pollinations (ElevenLabs)

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

### Pollinations dengan arahan gaya bicara (Qwen TTS)

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

### Komputer berspesifikasi rendah (Irodori)

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

### Server atau VPS

```json
{
  "deployment": {
    "mode": "deployment"
  }
}
```

Seluruh kunci beserta nilai bawaannya dijelaskan pada bagian berikutnya.

## Mesin suara {#voice}

Bagian `tts` menentukan mesin suara yang digunakan dan batas waktu pembuatan suara.

| Mesin suara | `provider` | Cocok untuk |
| --- | --- | --- |
| Suara lokal (Irodori) | `"irodori-local"` | Penggunaan tanpa biaya dan tanpa internet. Membebani CPU. |
| Pollinations | `"pollinations"` | Komputer berspesifikasi rendah. Memerlukan internet dan API key berbayar. |

| Kunci | Nilai bawaan | Keterangan |
| --- | --- | --- |
| `provider` | Lihat keterangan | `"irodori-local"` atau `"pollinations"`. Apabila kosong, Kana memilih `"pollinations"` jika hanya blok `pollinations` yang ditulis, dan `"irodori-local"` untuk kondisi lainnya. Wajib diisi apabila `irodoriLocal` dan `pollinations` ditulis bersamaan. |
| `timeoutSeconds` | `900` | Batas waktu pembuatan satu suara dalam detik, 1–3600, termasuk waktu tunggu antrean. |
| `irodoriLocal` | Tidak ada | Pengaturan suara lokal. Lihat bagian Suara lokal (Irodori). |
| `pollinations` | Tidak ada | Pengaturan Pollinations. Lihat bagian Pollinations. |

Hanya blok milik mesin yang sedang dipilih yang dibaca, sehingga pengaturan kedua mesin dapat disimpan dalam satu file.

> **Catatan:** apabila suara gagal dibuat, balasan tetap ditampilkan sebagai teks disertai pesan kesalahan. Kana tidak beralih ke mesin suara lain secara otomatis.

### Batas waktu

Naikkan `timeoutSeconds` apabila suara untuk balasan panjang gagal dibuat karena batas waktu habis. Apabila Kana diakses melalui Nginx atau proxy lain, atur batas waktu baca proxy sedikit di atas nilai ini, misalnya 910 detik untuk nilai bawaan 900.

```json
{
  "tts": {
    "timeoutSeconds": 1800
  }
}
```

## Suara lokal (Irodori) {#irodori}

Suara dibuat di CPU komputer Anda dengan model [Irodori-TTS v4.1 Anime](https://huggingface.co/phasefield-audio/Irodori-TTS-v4.1-Anime). Tidak memerlukan GPU, dan teks balasan tidak dikirim ke layanan lain.

**Persyaratan:** Linux 64-bit (x86-64) dengan glibc 2.35 atau yang lebih baru, misalnya Ubuntu 22.04, serta CPU dengan dukungan AVX2 dan FMA.

**Pemasangan:** buka **Pengaturan → Suara**, lalu tekan **Unduh mesin suara**. Ukuran unduhan dan ruang disk yang diperlukan ditampilkan sebelum unduhan dimulai. Kana tidak mengunduh apa pun sebelum tombol tersebut ditekan.

**Unduhan terputus:** tekan tombol yang sama. Unduhan dilanjutkan dari posisi terakhir.

**Model yang sudah ada:** model di cache Hugging Face digunakan langsung tanpa diunduh ulang.

Kunci berikut ditulis di dalam `tts.irodoriLocal` dan seluruhnya bersifat opsional.

| Kunci | Nilai bawaan | Keterangan |
| --- | --- | --- |
| `steps` | `16` | Jumlah langkah sampling, 1–200. Nilai kecil lebih cepat, nilai besar lebih halus. `8` adalah yang tercepat; `40` setara dengan kualitas standar mesin. |
| `threads` | Jumlah core CPU | Jumlah thread CPU, 1–256. Kurangi apabila komputer menjadi lambat saat Kana berbicara. |
| `precision` | `"auto"` | `"auto"`, `"int8"`, atau `"fp32"`. `"auto"` memilih yang tercepat untuk CPU Anda; `"int8"` memerlukan AVX-512 VNNI. |
| `modelPath` | Tidak ada | Path absolut ke `model.safetensors` Irodori v4.1 yang sudah Anda miliki. |
| `installDirectory` | Folder data Kana | Path absolut folder pemasangan mesin suara. |

> **Catatan:** pada komputer berspesifikasi rendah, gunakan `steps` bernilai `8`. Suara sedikit kurang halus, tetapi selesai lebih cepat.

## Pollinations {#pollinations}

Suara dibuat oleh layanan daring [Pollinations](https://gen.pollinations.ai/docs), dengan pilihan model dari ElevenLabs, Qwen, xAI, dan penyedia lain melalui satu API key. Tidak membebani komputer Anda.

**API key:** [enter.pollinations.ai](https://enter.pollinations.ai/keys). Gunakan key rahasia berawalan `sk_`. Seluruh model suara berbayar dan menggunakan saldo pollen.

**Daftar model dan suara:** [gen.pollinations.ai/audio/models](https://gen.pollinations.ai/audio/models)

**Model suara:** `elevenlabs/eleven-v3`, `elevenlabs/eleven-flash-v2.5`, `elevenlabs/eleven-multilingual-v2`, `qwen/qwen3-tts-instruct-flash`, `qwen/qwen3-tts-flash`, `x-ai/grok-tts`, `hexgrad/kokoro-82m`

Kunci berikut ditulis di dalam `tts.pollinations`.

| Kunci | Wajib | Keterangan |
| --- | --- | --- |
| `apiKey` | Ya | API key Pollinations. Hanya disimpan di komputer atau server yang menjalankan Kana dan tidak pernah dikirim ke browser. |
| `model` | Tidak | ID model dari daftar model, misalnya `elevenlabs/eleven-v3`. Alias seperti `elevenlabs` tetap berlaku. Apabila kosong, Pollinations memilih model bawaannya. |
| `voice` | Tidak | Nama suara yang tersedia pada model tersebut, atau ID suara ElevenLabs milik Anda. Apabila kosong, Pollinations memilih suara bawaannya. |
| `instructions` | Tidak | Arahan gaya bicara untuk model yang mendukungnya, misalnya `qwen/qwen3-tts-instruct-flash`. |
| `format` | Tidak | `"mp3"` (bawaan), `"opus"`, `"aac"`, `"flac"`, atau `"wav"`. |

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

> **Catatan:** satu balasan maksimal 10.000 karakter. Balasan yang lebih panjang tidak dikirim ke Pollinations dan ditampilkan sebagai teks disertai pesan kesalahan.

**Konfigurasi lama:** `"provider": "openai-compatible"` dengan preset Pollinations masih berfungsi dan menghasilkan suara yang sama. Sebaiknya konfigurasi tersebut ditulis ulang ke format di atas.

## Hermes {#hermes}

Hermes adalah agen AI yang memproses pesan dan menyusun balasan Kana. Kana menemukan dan menjalankan Hermes secara otomatis; bagian `hermes` hanya diperlukan apabila Hermes tidak ditemukan, port bawaan sudah digunakan, atau Hermes perlu bekerja di folder tertentu.

| Kunci | Nilai bawaan | Keterangan |
| --- | --- | --- |
| `executable` | Dicari otomatis | Path absolut program `hermes`. Isi hanya apabila `kana doctor` tetap tidak menemukan Hermes. |
| `port` | `9119` | Port Hermes yang dijalankan oleh Kana, 1024–65535. |
| `workingDirectory` | Folder home pengguna | Path absolut folder kerja awal Hermes. Path relatif pada alat file dan terminal Hermes mengacu ke folder ini. Hanya berlaku untuk Hermes yang dijalankan oleh Kana. |

```json
{
  "hermes": {
    "port": 9120,
    "workingDirectory": "/home/pengguna/proyek"
  }
}
```

> **Catatan:** perubahan pada bagian `hermes` baru berlaku setelah Kana dimulai ulang.

## Guardrail prompt {#guardrail}

Bagian `guardrails` memeriksa pesan Anda sebelum Kana mengirimkannya ke Hermes. Anda menulis aturan sebagai pernyataan biasa tentang apa yang tidak boleh dilakukan Kana; Kana mengubahnya menjadi satu pertanyaan yang diajukan kepada Jev, model TypeSafe. Jev mengembalikan probabilitas dan bukan teks, Kana membandingkan probabilitas itu dengan ambang batas Anda di dalam kodenya sendiri, dan Kana menolak pesan itu sendiri ketika ambang batas tercapai.

Biarkan `apiKey` kosong dan lapisan ini dilewatkan sepenuhnya. Tidak ada permintaan yang dikirim dan tidak ada biaya yang keluar.

| Kunci | Nilai bawaan | Keterangan |
| --- | --- | --- |
| `apiKey` | kosong | Kunci API TypeSafe Anda. Kosong atau tidak ada mematikan lapisan ini. |
| `model` | `"jev-latest"` | Model TypeSafe yang menjawab pertanyaan. |
| `threshold` | `0.7` | Kana menolak pesan begitu probabilitas dari Jev mencapai nilai ini, 0–1. Nilai di sekitar 0.5 berarti Jev tidak dapat memastikan; turunkan ambang batas untuk menolak lebih banyak percobaan yang berada di batas, dengan konsekuensi lebih banyak penolakan atas hal yang sebenarnya Anda maksud. |
| `whenUnavailable` | `"block"` | Yang dilakukan Kana terhadap pesan yang tidak dapat diperiksanya, karena TypeSafe tidak dapat dijangkau, menjawab dengan galat, atau mengembalikan jawaban yang tidak dapat dibaca Kana: `"block"` menolak pesan, `"allow"` mengirimkannya tanpa pemeriksaan. |
| `timeoutSeconds` | `10` | Lama Kana menunggu TypeSafe, 1–120. |
| `rules` | `[]` | Aturan Anda, maksimal 50, masing-masing satu pernyataan biasa tentang apa yang tidak boleh dilakukan Kana. |

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

Ketika jawaban Jev mencapai ambang batas Anda, Kana menampilkan satu kalimat tetap di percakapan sebagai ganti balasan dan membiarkan pesan Anda di atasnya. Tidak ada model yang melihat pesan itu, jadi tidak ada balasan yang dikarang, dan tidak ada yang ditulis ke transkrip Hermes. Kalimat itu tidak menyebut aturan tertentu, karena aturan dikirim sebagai satu pertanyaan dan satu angka yang kembali.

Tulis aturan dalam bahasa Inggris dan jaga setiap aturan tetap satu pernyataan jelas: Jev terutama dilatih dengan bahasa Inggris, dan pemeriksaan membaca aturan Anda secara harfiah, sehingga aturan yang menyebut tepat apa yang dilarang bekerja lebih baik daripada satu paragraf kebijakan. Kana memeriksa teks pesan, teks perintah slash, dan teks `/steer`. Kana tidak memeriksa jawaban yang Anda berikan di tengah giliran, misalnya persetujuan atau jawaban atas pertanyaan Hermes, karena menolak jawaban itu akan membuat giliran tersangkut.

Ini penyaring maksud, bukan sandbox. Kana tidak dapat mencegah Hermes mencapai berkas yang sama melalui jalur lain, dan Kana membaca teks giliran, bukan isi berkas lampiran. Pesan yang sangat panjang dapat melebihi batas baca Jev dan kemudian mengikuti `whenUnavailable`. Teks setiap giliran yang diperiksa dikirim ke TypeSafe, pihak ketiga, dan setiap giliran yang diperiksa memakan satu permintaan.

Blok `guardrails` yang tidak dapat dibaca Kana dilaporkan di bagian atas halaman ini dan menolak pesan, karena kebijakan yang tidak terbaca tidak sama dengan tidak ada kebijakan; `whenUnavailable` tetap dibaca dari blok itu, sehingga `"allow"` tetap tersedia. Tidak ada bagian Kana yang menulis berkas ini, jadi tidak ada pengaturan atau halaman yang dapat mengubah aturan Anda atau menampilkan kunci Anda.

## Akses jaringan {#deployment}

Bagian `deployment` menyatakan cara Kana diakses.

| `mode` | Digunakan apabila |
| --- | --- |
| `"local"` (bawaan) | Kana dibuka dari komputer yang menjalankannya, melalui `localhost`, `127.0.0.1`, atau `[::1]`. Alamat lain ditolak. |
| `"deployment"` | Kana dibuka melalui VPS, Nginx, atau jaringan, misalnya dari ponsel. |

```json
{
  "deployment": {
    "mode": "deployment"
  }
}
```

Kana selalu meminta kata sandi pada kedua mode.

## Variabel lingkungan {#environment}

Ditujukan untuk pemasangan di server. Variabel ditetapkan pada lingkungan yang menjalankan `kana`, bukan di dalam `config.json`, dan nilainya diutamakan di atas isi file.

| Variabel | Keterangan |
| --- | --- |
| `KANA_DATA_DIR` | Folder data Kana, termasuk `config.json` dan mesin suara; harus berupa path absolut. Apabila kosong, Kana menggunakan `~/.kana`; data dari rilis sebelumnya (`$XDG_DATA_HOME/kana`, `~/.local/share/kana`) dipindahkan ke sana pada start berikutnya. Folder yang ditetapkan di sini tidak pernah dipindahkan oleh proses start: `kana migrate` menyalinnya ke `~/.kana` saat Anda memintanya. |
| `KANA_PORT` | Port halaman web Kana. Nilai bawaannya `3000`, setara dengan opsi `kana --port`. |
| `KANA_DEPLOYMENT_MODE` | `local` atau `deployment`; menggantikan `deployment.mode`. |
| `KANA_HERMES_BIN` | Path program Hermes; menggantikan `hermes.executable`. |
| `KANA_TRUSTED_ORIGINS` | Alamat tambahan yang dipercaya, dipisahkan dengan koma. Hanya diperlukan apabila proxy mengubah header `Host` tanpa meneruskan `X-Forwarded-Host`, atau untuk membuka Kana dalam mode local melalui alamat lain. |
| `KANA_DEV_ALLOWED_ORIGINS` | Khusus pengembangan: alamat tambahan yang diizinkan mengakses `next dev`. |

```sh
KANA_DATA_DIR=/var/lib/kana KANA_PORT=3000 kana serve
```

Untuk memindahkan folder terkelola itu ke `~/.kana`, hentikan Kana lalu jalankan `kana migrate`: perintah ini menampilkan setiap entri beserta ukurannya, menyalin dan memverifikasi setiap berkas, membiarkan folder asal tetap utuh, lalu meminta Anda mengarahkan `KANA_DATA_DIR` ke `~/.kana` atau menghapusnya. Tambahkan `--delete-source` untuk memindahkan entri alih-alih menyalinnya, dan `--dry-run` untuk membaca rencananya tanpa mengubah apa pun.

Pengaturan suara tidak memiliki variabel lingkungan dan hanya dapat diubah melalui `config.json`.

## Kesalahan umum {#troubleshooting}

| Gejala | Penyelesaian |
| --- | --- |
| **Pengaturan → Koneksi** melaporkan kesalahan pada `config.json` | Perbaiki kunci yang disebutkan dalam pesan, lalu simpan file. |
| Hermes tidak ditemukan | Jalankan `kana doctor`. Apabila masalah berlanjut, isi `hermes.executable` atau `KANA_HERMES_BIN`. |
| Port 9119 sudah digunakan program lain | Ubah `hermes.port`, lalu mulai ulang Kana. |
| Perubahan pada `~/.hermes/.env` atau server MCP Hermes belum berlaku | Ketik `/reload` (untuk `.env`) atau `/reload-mcp now` (untuk server MCP) di Kana. Untuk perubahan lain yang hanya dibaca Hermes saat dijalankan, ketik `/restart`; perintah ini hanya berlaku untuk Hermes yang dijalankan oleh Kana. Model baru di `config.yaml` Hermes langsung muncul tanpa memulai ulang. |
| Suara untuk balasan panjang gagal karena batas waktu habis | Naikkan `tts.timeoutSeconds` serta batas waktu proxy, apabila ada. |
| Pesan `Pollinations returned HTTP 401` | API key kosong atau tidak valid. Periksa `tts.pollinations.apiKey`. |
| Pesan `Pollinations returned HTTP 402` | Saldo pollen tidak mencukupi. Isi ulang saldo di [enter.pollinations.ai](https://enter.pollinations.ai). |
