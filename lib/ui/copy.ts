// Central UI copy dictionary. User-facing strings live here instead of being
// scattered through components, so a language is one object and adding a
// locale is one entry. Migration of older surfaces into this module happens
// incrementally; new components must not hardcode user-facing copy.

export type UiLocale = "id" | "en";
export const UI_LOCALES: readonly UiLocale[] = ["id", "en"];

export type Copy = {
  common: {
    continueLabel: string;
    back: string;
    done: string;
    saving: string;
    retry: string;
    close: string;
  };
  welcome: {
    eyebrow: string;
    title: string;
    body: string;
    diagramFrom: string;
    diagramTo: string;
  };
  presentation: {
    eyebrow: string;
    title: string;
    subtitleLabel: string;
    uiLanguageLabel: string;
    voiceTitle: string;
    voiceValue: string;
    voiceHint: string;
    avatarTitle: string;
    avatarValue: string;
    avatarHint: string;
  };
  deps: {
    eyebrow: string;
    title: string;
    body: string;
    hermesTitle: string;
    hermesRunning: string;
    hermesInstalled: string;
    hermesMissing: string;
    voiceTitle: string;
    voiceOk: string;
    voiceLoading: string;
    voiceStopped: string;
    voiceError: string;
    voiceOff: string;
    voiceNotProbed: string;
  };
  ready: {
    eyebrow: string;
    title: string;
    body: string;
    subtitlesLabel: string;
    voiceLabel: string;
    avatarLabel: string;
  };
  repair: {
    eyebrow: string;
    title: string;
    intro: string;
    dismiss: string;
    openSettings: string;
  };
  banner: {
    degraded: string;
    action: string;
  };
  panels: {
    hermesTitle: string;
    hermesSubtitle: string;
    ttsTitle: string;
    ttsSubtitle: string;
    states: Record<string, string>;
    start: string;
    starting: string;
    restart: string;
    stop: string;
    refresh: string;
    ttsAutoNote: string;
    ttsFirstStart: string;
    advanced: string;
    portLabel: string;
    cwdLabel: string;
    cwdPlaceholder: string;
    hermesAria: string;
    ttsAria: string;
    checkFailed: string;
    controlFailed: string;
  };
  gate: {
    connecting: string;
    reconnecting: string;
    authInvalid: string;
    incompatible: string;
    failed: string;
    idle: string;
    connectButton: string;
    startButton: string;
    detectedExternal(port: number): string;
    managedRunning(pid: number | null): string;
    installedReady: string;
    missingBinary: string;
    relayNote: string;
  };
  workspace: {
    preparing: string;
    newMoment: string;
    actions: string;
    switchTheme(theme: "light" | "dark"): string;
    light: string;
    dark: string;
    openHistory: string;
    history: string;
    openSettings: string;
    settings: string;
    hideChat: string;
    showChat: string;
    messagePlaceholder: string;
    messageAria: string;
    stop: string;
    send: string;
    conversationHistory: string;
    gatewayAria: string;
    gatewayEyebrow: string;
    gatewayTitle: string;
    gatewayBody: string;
    notNow: string;
    confirmNew: string;
    confirmUndo: string;
    confirmRestart: string;
    confirmUpdate: string;
    confirmRollback: string;
  };
  chat: {
    aria: string;
    emptyTitle: string;
    emptyBody: string;
    hermesNote: string;
    latestAria: string;
    latest: string;
  };
  history: {
    aria: string;
    eyebrow: string;
    title: string;
    close: string;
    search: string;
    newConversation: string;
    newLabel: string;
    found(count: number): string;
    recent: string;
    sessionUnavailable: string;
    startMoment: string;
    moreOptions(title: string): string;
    more: string;
    rename: string;
    delete: string;
    renamePrompt: string;
    deleteConfirm(title: string): string;
    noMatches: string;
    noMatchesHint: string;
    availableFromHermes: string;
    messages(count: number): string;
  };
  activity: {
    title: string;
    steps(count: number): string;
    working: string;
    done: string;
  };
  slash: {
    commands: string;
    ask: string;
    finding: string;
    navigate: string;
    skill: string;
    command: string;
    unavailable: string;
    kanaSessionGroup: string;
    hermesControlsGroup: string;
    newDescription: string;
    sessionsDescription: string;
    resumeDescription: string;
    approveDescription: string;
    denyDescription: string;
    commandsDescription: string;
  };
  agentInput: {
    approvalTitle: string;
    runOnce: string;
    allowSession: string;
    alwaysAllow: string;
    deny: string;
    smartDenied: string;
    questionTitle: string;
    answerLabel: string;
    answerPlaceholder: string;
    skip: string;
    sendAnswer: string;
    sudoTitle: string;
    secretTitle: string;
    sudoBody: string;
    secretBody: string;
    password: string;
    secretValue: string;
    secureHint: string;
    cancel: string;
    sending: string;
    sendSecurely: string;
  };
  subtitlePicker: {
    commonLanguages: string;
    customLanguage: string;
    customPlaceholder: string;
    customAria: string;
    hint: string;
  };
  settings: {
    title: string;
    subtitle: string;
    personal: string;
    system: string;
    sections: Record<string, { label: string; hint: string }>;
    sectionsAria: string;
    saveError: string;
    close: string;
    interfaceTitle: string;
    interfaceDescription: string;
    subtitleTitle: string;
    subtitleDescription: string;
    historicalSubtitles: string;
    voiceTitle: string;
    voiceOn: string;
    voiceOff: string;
    voiceToggle: string;
    stageTitle: string;
    stageDescription: string;
    backgroundOptions: Record<string, { label: string; hint: string }>;
    backgrounds(count: number): string;
    carouselControls: string;
    previousBackgrounds: string;
    nextBackgrounds: string;
    stageAria: string;
    choose: string;
    selected: string;
    localBackground: string;
    removeLabel(label: string): string;
    customBackgroundTitle: string;
    customBackgroundHint: string;
    adding: string;
    uploadImage: string;
    avatarLibrary: string;
    avatarLibraryBody: string;
    currentAvatar: string;
    selectedAvatar: string;
    yourAvatar: string;
    included: string;
    includedAvatars: string;
    live2dSample: string;
    yourAvatars: string;
    storedBrowserOnly: string;
    rename: string;
    remove: string;
    preparingAvatar: string;
    importLive2d: string;
    importLive2dHint: string;
    includedAvatarAbout: string;
    hermesTitle: string;
    hermesDescription: string;
    voiceEngineTitle: string;
    voiceEngineDescription: string;
    accessTitle: string;
    accessDescription: string;
    privateTitle: string;
    privateBody: string;
    avatarNamePrompt: string;
    removeAvatarConfirm(name: string): string;
    removeBackgroundConfirm(name: string): string;
    advancedTitle: string;
    advancedSuffix: string;
    advancedBody: string;
    advancedRestart: string;
    checkingAccess: string;
    noPassword: string;
    noPasswordBody: string;
    currentPassword: string;
    newPassword: string;
    confirmPassword: string;
    passwordTooShort: string;
    passwordMismatch: string;
    passwordUpdated: string;
    passwordFailed: string;
    updating: string;
    updatePassword: string;
    logout: string;
  };
  voiceLibrary: {
    title: string;
    body: string;
    chooseAria: string;
    available: string;
    loading: string;
    empty: string;
    selected: string;
    choose: string;
    pending: string;
    remove: string;
    included: string;
    yours: string;
    waiting: string;
    engineLoading: string;
    engineError: string;
    engineStopped: string;
    addTitle: string;
    addBody: string;
    addSample: string;
    formAria: string;
    formTitle: string;
    formBody: string;
    cancel: string;
    name: string;
    namePlaceholder: string;
    audio: string;
    chooseFile: string;
    consent: string;
    preparing: string;
    addLibrary: string;
    validation: string;
    checkFailed: string;
    added(name: string): string;
    addFailed: string;
    removeFailed: string;
  };
  status: Record<string, string>;
  voiceOnOff(on: boolean): string;
  subtitleNames: Record<string, string>;
  localeNames: Record<UiLocale, string>;
};

const id: Copy = {
  common: {
    continueLabel: "Lanjut",
    back: "Kembali",
    done: "Selesai",
    saving: "Menyimpan…",
    retry: "Periksa ulang",
    close: "Tutup",
  },
  welcome: {
    eyebrow: "Lapisan tampilan lokal",
    title: "Selamat datang di Kana",
    body: "Kana memberi Hermes Agent milikmu wajah: percakapan visual, suara Jepang, subtitle, dan avatar yang bisa diganti. Hermes tetap satu-satunya agen dan tetap memegang tools, memori, sesi, dan penalaran.",
    diagramFrom: "Kana Web UI",
    diagramTo: "Hermes-mu",
  },
  presentation: {
    eyebrow: "Tampilan",
    title: "Atur cara Kana tampil",
    subtitleLabel: "Bahasa subtitle untuk respons baru",
    uiLanguageLabel: "Bahasa antarmuka Kana",
    voiceTitle: "Suara Jepang",
    voiceValue: "Qwen3-TTS lokal",
    voiceHint: "Berjalan sebagai layanan lokal terpisah.",
    avatarTitle: "Avatar",
    avatarValue: "Contoh resmi Live2D",
    avatarHint: "Bisa diganti model Cubism lain nanti.",
  },
  deps: {
    eyebrow: "Pemeriksaan sistem",
    title: "Cek komponen pendukung",
    body: "Kana hanya tampil — otaknya ada di layanan lokal ini. Semua boleh diperbaiki nanti lewat Pengaturan.",
    hermesTitle: "Hermes (otak agen)",
    hermesRunning: "Terhubung dan berjalan.",
    hermesInstalled: "Terpasang di mesin ini. Akan dinyalakan otomatis saat dibutuhkan.",
    hermesMissing: "Belum terpasang. Pasang Hermes, lalu buka Pengaturan → Hermes gateway.",
    voiceTitle: "Mesin suara Qwen3-TTS",
    voiceOk: "Siap. Suara bisa langsung dipakai.",
    voiceLoading: "Sedang menyiapkan model (sekali di awal).",
    voiceStopped: "Belum menyala. Otomatis menyala saat pertama kali dibutuhkan.",
    voiceError: "Gagal menyala — kemungkinan cache model hilang atau rusak. Buka Pengaturan → Qwen3-TTS lalu jalankan ulang.",
    voiceOff: "Dinonaktifkan di pengaturan. Aktifkan kapan saja.",
    voiceNotProbed: "Belum diperiksa.",
  },
  ready: {
    eyebrow: "Ringkasan",
    title: "Kana siap",
    body: "Semua pengaturan tampilan bisa diubah lagi nanti. Kana tidak pernah mengubah instalasi Hermes-mu.",
    subtitlesLabel: "Subtitle",
    voiceLabel: "Suara",
    avatarLabel: "Avatar",
  },
  repair: {
    eyebrow: "Perawatan",
    title: "Ada komponen yang butuh perhatian",
    intro: "Beberapa bagian Kana tidak sehat saat ini. Kamu bisa memperbaikinya dari Pengaturan, atau menutup ini dan melanjutkan.",
    dismiss: "Lanjutkan saja",
    openSettings: "Buka Pengaturan",
  },
  banner: {
    degraded: "Ada komponen Kana yang bermasalah.",
    action: "Periksa",
  },
  panels: {
    hermesTitle: "Hermes — otak asisten",
    hermesSubtitle: "Proses resmi di mesin ini, tanpa dimodifikasi.",
    ttsTitle: "Mesin suara Jepang (Qwen3-TTS)",
    ttsSubtitle: "Menyala otomatis saat suara dibutuhkan.",
    states: {
      running: "menyala",
      external: "menyala",
      starting: "menyiapkan…",
      stopping: "mematikan…",
      failed: "gagal",
      stopped: "mati",
    },
    start: "Nyalakan",
    starting: "Menyalakan…",
    restart: "Mulai ulang",
    stop: "Matikan",
    refresh: "Perbarui status",
    ttsAutoNote: "Tidak dipakai = tidak memakan daya. Model hanya bekerja saat ada permintaan suara.",
    ttsFirstStart: "Menyiapkan model suara — pemakaian pertama bisa mengunduh ±2,3 GB dan butuh beberapa menit.",
    advanced: "Pengaturan lanjutan",
    portLabel: "Port lokal",
    cwdLabel: "Folder kerja (opsional)",
    cwdPlaceholder: "/home/user/project",
    hermesAria: "Kontrol proses Hermes",
    ttsAria: "Kontrol proses Qwen3-TTS",
    checkFailed: "Pemeriksaan kontrol gagal.",
    controlFailed: "Kontrol layanan gagal.",
  },
  gate: {
    connecting: "Menghubungkan…",
    reconnecting: "Menghubungkan ulang…",
    authInvalid: "Sesi Kana tidak valid",
    incompatible: "Versi Hermes tidak kompatibel",
    failed: "Koneksi gagal",
    idle: "Hermes tidak terhubung",
    connectButton: "Koneksikan Hermes",
    startButton: "Memulai Hermes…",
    detectedExternal: (port: number) => `Gateway Hermes terdeteksi di port ${port}.`,
    managedRunning: (pid: number | null) => `Hermes sedang berjalan (PID ${pid ?? "—"}).`,
    installedReady: "Hermes terpasang, siap dijalankan.",
    missingBinary: "Pasang Hermes atau atur KANA_HERMES_BIN.",
    relayNote: "Koneksi diproses di server Kana — token tidak diperlukan di browser.",
  },
  workspace: {
    preparing: "Menyiapkan Kana",
    newMoment: "Momen baru",
    actions: "Tindakan ruang kerja",
    switchTheme: (theme) => `Beralih ke tema ${theme === "light" ? "terang" : "gelap"}`,
    light: "Terang",
    dark: "Gelap",
    openHistory: "Buka riwayat percakapan",
    history: "Riwayat",
    openSettings: "Buka pengaturan",
    settings: "Pengaturan",
    hideChat: "Sembunyikan chat",
    showChat: "Tampilkan chat",
    messagePlaceholder: "Katakan sesuatu kepada Kana…",
    messageAria: "Pesan untuk Kana",
    stop: "Hentikan",
    send: "Kirim",
    conversationHistory: "Riwayat percakapan",
    gatewayAria: "Gateway Hermes",
    gatewayEyebrow: "Kana membutuhkan Hermes",
    gatewayTitle: "Hubungkan pikiran di balik Kana",
    gatewayBody: "Kana akan menemukan atau menjalankan instalasi Hermes milikmu secara otomatis.",
    notNow: "Nanti saja",
    confirmNew: "Mulai percakapan Kana dan Hermes yang baru?",
    confirmUndo: "Batalkan giliran Hermes terbaru dan hapus dari riwayat Kana ini?",
    confirmRestart: "Mulai ulang gateway Hermes? Kana akan terputus sementara.",
    confirmUpdate: "Izinkan Hermes memperbarui instalasinya sendiri?",
    confirmRollback: "Pulihkan checkpoint sistem berkas Hermes? Ini dapat menimpa berkas saat ini.",
  },
  chat: {
    aria: "Chat langsung",
    emptyTitle: "Sejenak tenang bersama Kana",
    emptyBody: "Tanyakan apa saja. Hermes akan bekerja di balik layar sementara Kana tetap menemanimu di sini.",
    hermesNote: "Catatan Hermes",
    latestAria: "Lompat ke pesan terbaru",
    latest: "Terbaru",
  },
  history: {
    aria: "Riwayat percakapan",
    eyebrow: "Waktumu bersama Kana",
    title: "Percakapan",
    close: "Tutup riwayat percakapan",
    search: "Cari percakapan",
    newConversation: "Percakapan baru",
    newLabel: "Baru",
    found: (count) => `${count} ditemukan`,
    recent: "Terkini",
    sessionUnavailable: "Sesi Hermes tidak tersedia",
    startMoment: "Mulai momen baru",
    moreOptions: (title) => `Opsi lainnya untuk ${title}`,
    more: "Lainnya",
    rename: "Ganti nama",
    delete: "Hapus",
    renamePrompt: "Ganti nama percakapan",
    deleteConfirm: (title) => `Hapus “${title}” dari riwayat Kana?`,
    noMatches: "Tidak ada percakapan yang cocok.",
    noMatchesHint: "Coba kata lain atau mulai percakapan baru.",
    availableFromHermes: "Tersedia dari Hermes",
    messages: (count) => `${count} pesan`,
  },
  activity: {
    title: "Aktivitas Hermes",
    steps: (count) => `${count} langkah`,
    working: "diproses",
    done: "selesai",
  },
  slash: {
    commands: "Perintah Hermes",
    ask: "Minta Hermes untuk…",
    finding: "Mencari tindakan…",
    navigate: "↑↓ navigasi · Tab memilih",
    skill: "Keahlian Hermes",
    command: "Perintah Hermes",
    unavailable: "tidak tersedia",
    kanaSessionGroup: "Kana & sesi",
    hermesControlsGroup: "Kontrol Hermes",
    newDescription: "Mulai percakapan Kana dan sesi Hermes baru",
    sessionsDescription: "Tampilkan percakapan Kana yang tersimpan secara lokal",
    resumeDescription: "Lanjutkan percakapan Kana berdasarkan judul atau ID",
    approveDescription: "Setujui permintaan Hermes yang tertunda",
    denyDescription: "Tolak permintaan Hermes yang tertunda",
    commandsDescription: "Tampilkan perintah dan keahlian yang terpasang",
  },
  agentInput: {
    approvalTitle: "Hermes memerlukan persetujuan",
    runOnce: "Jalankan sekali",
    allowSession: "Izinkan selama sesi",
    alwaysAllow: "Selalu izinkan",
    deny: "Tolak",
    smartDenied: "Pemeriksaan keamanan Hermes menyarankan agar tindakan ini ditolak.",
    questionTitle: "Hermes memiliki pertanyaan",
    answerLabel: "Jawabanmu",
    answerPlaceholder: "Ketik jawaban untuk Hermes…",
    skip: "Lewati",
    sendAnswer: "Kirim jawaban",
    sudoTitle: "Kata sandi sudo diperlukan",
    secretTitle: "Nilai rahasia diperlukan",
    sudoBody: "Hermes memerlukan kata sandi untuk perintah terlindungi saat ini.",
    secretBody: "Hermes memerlukan nilai rahasia untuk alat saat ini.",
    password: "Kata sandi",
    secretValue: "Nilai rahasia",
    secureHint: "Dikirim langsung ke Hermes; tidak pernah ditambahkan ke riwayat Kana atau preferensi lokal.",
    cancel: "Batal",
    sending: "Mengirim…",
    sendSecurely: "Kirim dengan aman",
  },
  subtitlePicker: {
    commonLanguages: "Bahasa subtitle umum",
    customLanguage: "Bahasa khusus",
    customPlaceholder: "Atau ketik bahasa apa pun…",
    customAria: "Bahasa subtitle khusus",
    hint: "Hermes menulis subtitle dalam bahasa ini. Ucapan tetap dalam bahasa Jepang; riwayat tidak pernah diterjemahkan ulang.",
  },
  settings: {
    title: "Pengaturan",
    subtitle: "Preferensi pribadi",
    personal: "Pribadi",
    system: "Sistem",
    sections: {
      experience: { label: "Pengalaman", hint: "Bahasa dan subtitle" },
      voice: { label: "Suara", hint: "Cara Kana berbicara" },
      avatar: { label: "Avatar", hint: "Avatar dan panggung" },
      system: { label: "Koneksi", hint: "Hermes dan mesin suara" },
      privacy: { label: "Privasi", hint: "Akses dan keamanan" },
    },
    sectionsAria: "Bagian pengaturan",
    saveError: "Tidak dapat menyimpan",
    close: "Tutup pengaturan",
    interfaceTitle: "Bahasa antarmuka",
    interfaceDescription: "Pilih bahasa yang digunakan oleh kontrol dan menu Kana.",
    subtitleTitle: "Bahasa subtitle",
    subtitleDescription: "Kana selalu berbicara dalam bahasa Jepang. Ini mengatur subtitle tertulis untuk balasan baru.",
    historicalSubtitles: "Subtitle lama tetap persis seperti saat pertama kali ditampilkan.",
    voiceTitle: "Suara Kana",
    voiceOn: "Kana membacakan balasan baru dalam bahasa Jepang.",
    voiceOff: "Balasan tetap tersedia sebagai teks saat suara dimatikan.",
    voiceToggle: "Suara Jepang",
    stageTitle: "Latar panggung",
    stageDescription: "Pilih panggung untuk Kana. Geser carousel atau gunakan tombol panah.",
    backgroundOptions: {
      plain: { label: "Polos", hint: "Panggung datar yang tenang" },
      room: { label: "Kamar Kana", hint: "Kamar ilustrasi yang nyaman" },
      "pattern-sparkles": { label: "Kisi kilau", hint: "Tanda silang kecil dengan ritme ringan" },
      "pattern-twinkle": { label: "Kelap-kelip lembut", hint: "Kilau ringan dan titik-titik kecil" },
      "pattern-gingham": { label: "Gingham nyaman", hint: "Pola kotak lembut dengan titik kecil" },
      "pattern-stars": { label: "Parade bintang", hint: "Bintang ceria dengan jarak yang tenang" },
      "pattern-swirls": { label: "Pusaran ceria", hint: "Bentuk spiral bebas seperti gambar tangan" },
    },
    backgrounds: (count) => `${count} latar · tersimpan di perangkat ini`,
    carouselControls: "Kontrol carousel latar",
    previousBackgrounds: "Latar sebelumnya",
    nextBackgrounds: "Latar berikutnya",
    stageAria: "Latar panggung",
    choose: "Pilih",
    selected: "Dipilih",
    localBackground: "Latar lokalmu",
    removeLabel: (label) => `Hapus ${label}`,
    customBackgroundTitle: "Gunakan latarmu sendiri",
    customBackgroundHint: "PNG, JPEG, WebP, GIF, AVIF, atau BMP · hingga 25 MB · disimpan di browser ini",
    adding: "Menambahkan…",
    uploadImage: "Unggah gambar",
    avatarLibrary: "Koleksi avatar",
    avatarLibraryBody: "Pilih karakter bawaan atau impor avatar Live2D milikmu.",
    currentAvatar: "Avatar saat ini",
    selectedAvatar: "Avatar terpilih",
    yourAvatar: "Avatarmu",
    included: "Bawaan",
    includedAvatars: "Avatar bawaan",
    live2dSample: "Contoh Live2D",
    yourAvatars: "Avatarmu",
    storedBrowserOnly: "Hanya tersimpan di browser ini.",
    rename: "Ganti nama",
    remove: "Hapus",
    preparingAvatar: "Menyiapkan avatar…",
    importLive2d: "Impor folder Live2D",
    importLive2dHint: "Pilih satu folder model lengkap. Kana menyimpannya di perangkat ini.",
    includedAvatarAbout: "Tentang avatar bawaan",
    hermesTitle: "Hermes",
    hermesDescription: "Otak agen di balik Kana. Kana menemukan dan menghubungkannya secara otomatis.",
    voiceEngineTitle: "Mesin suara",
    voiceEngineDescription: "Layanan lokal yang mengubah teks Jepang Kana menjadi suara.",
    accessTitle: "Perlindungan akses",
    accessDescription: "Atur siapa yang dapat membuka instalasi Kana ini.",
    privateTitle: "Nilai privatmu tetap privat",
    privateBody: "Kata sandi dan rahasia yang diminta Hermes dikirim langsung ke Hermes dan tidak pernah ditambahkan ke riwayat percakapan atau preferensi.",
    avatarNamePrompt: "Nama avatar",
    removeAvatarConfirm: (name) => `Hapus “${name}” dari browser ini?`,
    removeBackgroundConfirm: (name) => `Hapus ${name} dari perangkat ini?`,
    advancedTitle: "Konfigurasi lanjutan",
    advancedSuffix: "untuk instalasi mandiri",
    advancedBody: "Path runtime dan port dapat dikonfigurasi di luar antarmuka. Kana membaca file ini saat menjalankan layanannya:",
    advancedRestart: "Mulai ulang Kana setelah mengubah file ini.",
    checkingAccess: "Memeriksa perlindungan akses…",
    noPassword: "Kata sandi tidak diperlukan",
    noPasswordBody: "Instalasi Kana ini saat ini dapat dibuka tanpa kata sandi. Konfigurasi akses lanjutan tersedia di file konfigurasi Kana.",
    currentPassword: "Kata sandi saat ini",
    newPassword: "Kata sandi baru",
    confirmPassword: "Konfirmasi kata sandi",
    passwordTooShort: "Gunakan minimal 8 karakter untuk kata sandi baru.",
    passwordMismatch: "Kata sandi baru tidak cocok.",
    passwordUpdated: "Kata sandi diperbarui.",
    passwordFailed: "Kata sandi tidak dapat diubah.",
    updating: "Memperbarui…",
    updatePassword: "Perbarui kata sandi",
    logout: "Keluar",
  },
  voiceLibrary: {
    title: "Koleksi suara",
    body: "Pilih suara yang siap. Kana menggunakannya untuk setiap balasan Jepang baru.",
    chooseAria: "Pilih suara Kana",
    available: "Suara yang tersedia",
    loading: "Memuat suara…",
    empty: "Belum ada suara. Tambahkan sampel suara di bawah.",
    selected: "Dipilih",
    choose: "Pilih",
    pending: "Menunggu",
    remove: "Hapus",
    included: "Bawaan Kana",
    yours: "Suaramu",
    waiting: "Menunggu mesin suara…",
    engineLoading: "Mesin suara sedang bersiap. Suaramu akan muncul otomatis setelah selesai.",
    engineError: "Mesin suara tidak dapat dijalankan. Buka Koneksi untuk memeriksanya.",
    engineStopped: "Mesin suara sedang tidur. Kana akan menjalankannya saat suara dibutuhkan.",
    addTitle: "Tambahkan suaramu",
    addBody: "Gunakan satu sampel audio jelas yang boleh kamu gunakan.",
    addSample: "Tambah sampel",
    formAria: "Tambahkan sampel suara",
    formTitle: "Tambahkan suara",
    formBody: "Sampel bersih dengan satu pembicara memberikan hasil terbaik.",
    cancel: "Batal",
    name: "Nama suara",
    namePlaceholder: "Contoh: Suaraku",
    audio: "Sampel audio",
    chooseFile: "Pilih file audio",
    consent: "Ini suara saya, atau saya memiliki izin untuk menggunakannya.",
    preparing: "Menyiapkan suara…",
    addLibrary: "Tambahkan ke koleksi",
    validation: "Tambahkan nama, pilih sampel suara, dan konfirmasi bahwa kamu memiliki izin untuk menggunakannya.",
    checkFailed: "Pemeriksaan suara gagal.",
    added: (name) => `Suara “${name}” siap digunakan.`,
    addFailed: "Suara tidak dapat ditambahkan.",
    removeFailed: "Suara tidak dapat dihapus.",
  },
  status: {
    ready: "Siap kapan pun kamu siap",
    connected: "Terhubung ke Hermes",
    reconnecting: "Menghubungkan ulang…",
    thinking: "Kana sedang berpikir",
    answering: "Kana sedang menjawab",
    responseReceived: "Respons diterima",
    stopped: "Giliran dihentikan",
    attention: "Ada sesuatu yang perlu diperiksa",
    queued: "Pesan masuk antrean — Kana akan menjawab setelah tugas saat ini selesai",
    alreadyNew: "Sudah berada dalam percakapan baru",
    newReady: "Percakapan baru siap",
    opening: "Membuka percakapan",
    commandComplete: "Perintah selesai",
    continuing: "Hermes sedang melanjutkan",
    draftReady: "Perintah menyiapkan draf",
    stillWorking: "Hermes masih bekerja",
    sendFailed: "Pesan tidak dapat dikirim",
    disconnected: "Agen terputus",
    inputSent: "Input dikirim ke Hermes",
    inputFailed: "Input tidak dapat dikirim",
    preparingVoice: "Kana menyiapkan suara…",
    speaking: "Kana berbicara…",
  },
  voiceOnOff: (on: boolean) => (on ? "Aktif" : "Nonaktif"),
  subtitleNames: {
    ja: "Jepang",
    en: "Inggris",
    id: "Indonesia",
  },
  localeNames: { id: "Indonesia", en: "English" },
};

const en: Copy = {
  common: {
    continueLabel: "Continue",
    back: "Back",
    done: "Done",
    saving: "Saving…",
    retry: "Recheck",
    close: "Close",
  },
  welcome: {
    eyebrow: "Local presentation layer",
    title: "Welcome to Kana",
    body: "Kana gives your existing Hermes Agent a face: a visual conversation, Japanese voice, subtitles, and a replaceable avatar. Hermes remains the only agent and keeps ownership of tools, memory, sessions, and reasoning.",
    diagramFrom: "Kana Web UI",
    diagramTo: "Your Hermes",
  },
  presentation: {
    eyebrow: "Presentation",
    title: "Choose how Kana looks",
    subtitleLabel: "Subtitle language for new responses",
    uiLanguageLabel: "Kana interface language",
    voiceTitle: "Japanese voice",
    voiceValue: "Local Qwen3-TTS",
    voiceHint: "Runs as a separate local service.",
    avatarTitle: "Avatar",
    avatarValue: "Official Live2D sample",
    avatarHint: "Import another Cubism model later.",
  },
  deps: {
    eyebrow: "System check",
    title: "Check the supporting pieces",
    body: "Kana is only the face — the brain lives in these local services. Everything can be fixed later from Settings.",
    hermesTitle: "Hermes (the agent brain)",
    hermesRunning: "Connected and running.",
    hermesInstalled: "Installed on this machine. Starts automatically when needed.",
    hermesMissing: "Not installed yet. Install Hermes, then open Settings → Hermes gateway.",
    voiceTitle: "Qwen3-TTS voice engine",
    voiceOk: "Ready. Voice can be used right away.",
    voiceLoading: "Preparing the model (first time only).",
    voiceStopped: "Not running. It starts automatically when first needed.",
    voiceError: "Failed to start — the model cache may be missing or broken. Open Settings → Qwen3-TTS and restart it.",
    voiceOff: "Disabled in settings. Turn it on anytime.",
    voiceNotProbed: "Not checked yet.",
  },
  ready: {
    eyebrow: "Summary",
    title: "Kana is ready",
    body: "Every presentation setting can be changed later. Kana never modifies your Hermes installation.",
    subtitlesLabel: "Subtitles",
    voiceLabel: "Voice",
    avatarLabel: "Avatar",
  },
  repair: {
    eyebrow: "Maintenance",
    title: "A component needs attention",
    intro: "Some parts of Kana are unhealthy right now. You can fix them from Settings, or continue for now.",
    dismiss: "Continue anyway",
    openSettings: "Open Settings",
  },
  banner: {
    degraded: "A Kana component is having trouble.",
    action: "Check",
  },
  panels: {
    hermesTitle: "Hermes — the assistant's brain",
    hermesSubtitle: "The official, unmodified process on this machine.",
    ttsTitle: "Japanese voice engine (Qwen3-TTS)",
    ttsSubtitle: "Starts automatically whenever voice is needed.",
    states: {
      running: "running",
      external: "running",
      starting: "starting…",
      stopping: "stopping…",
      failed: "failed",
      stopped: "stopped",
    },
    start: "Start",
    starting: "Starting…",
    restart: "Restart",
    stop: "Stop",
    refresh: "Refresh status",
    ttsAutoNote: "Idle = zero cost. The model only works when a voice request comes in.",
    ttsFirstStart: "Preparing the voice model — first use may download ~2.3 GB and take several minutes.",
    advanced: "Advanced",
    portLabel: "Local port",
    cwdLabel: "Working folder (optional)",
    cwdPlaceholder: "/home/user/project",
    hermesAria: "Hermes process control",
    ttsAria: "Qwen3-TTS process control",
    checkFailed: "Control check failed.",
    controlFailed: "Service control failed.",
  },
  gate: {
    connecting: "Connecting…",
    reconnecting: "Reconnecting…",
    authInvalid: "Kana session is invalid",
    incompatible: "Incompatible Hermes version",
    failed: "Connection failed",
    idle: "Hermes is not connected",
    connectButton: "Connect Hermes",
    startButton: "Starting Hermes…",
    detectedExternal: (port: number) => `Hermes gateway detected on port ${port}.`,
    managedRunning: (pid: number | null) => `Hermes is running (PID ${pid ?? "—"}).`,
    installedReady: "Hermes is installed and ready to start.",
    missingBinary: "Install Hermes or set KANA_HERMES_BIN.",
    relayNote: "The connection is handled by the Kana server — no token needed in the browser.",
  },
  workspace: {
    preparing: "Preparing Kana",
    newMoment: "A new moment",
    actions: "Workspace actions",
    switchTheme: (theme) => `Switch to ${theme} theme`,
    light: "Light",
    dark: "Dark",
    openHistory: "Open conversation history",
    history: "History",
    openSettings: "Open settings",
    settings: "Settings",
    hideChat: "Hide chat",
    showChat: "Show chat",
    messagePlaceholder: "Say something to Kana…",
    messageAria: "Message Kana",
    stop: "Stop",
    send: "Send",
    conversationHistory: "Conversation history",
    gatewayAria: "Hermes gateway",
    gatewayEyebrow: "Kana needs Hermes",
    gatewayTitle: "Connect the mind behind Kana",
    gatewayBody: "Kana will find or start your existing Hermes installation automatically.",
    notNow: "Not now",
    confirmNew: "Start a fresh Kana and Hermes conversation?",
    confirmUndo: "Undo the latest Hermes turn and remove it from this Kana history?",
    confirmRestart: "Restart the Hermes gateway? Kana will disconnect temporarily.",
    confirmUpdate: "Allow Hermes to update its own installation?",
    confirmRollback: "Restore a Hermes filesystem checkpoint? This can overwrite current files.",
  },
  chat: {
    aria: "Live chat",
    emptyTitle: "A quiet moment with Kana",
    emptyBody: "Ask anything. Hermes will work behind the scenes while Kana stays here with you.",
    hermesNote: "Hermes note",
    latestAria: "Jump to latest message",
    latest: "Latest",
  },
  history: {
    aria: "Conversation history",
    eyebrow: "Your time with Kana",
    title: "Conversations",
    close: "Close conversation history",
    search: "Search conversations",
    newConversation: "New conversation",
    newLabel: "New",
    found: (count) => `${count} found`,
    recent: "Recent",
    sessionUnavailable: "Hermes session unavailable",
    startMoment: "Start a new moment",
    moreOptions: (title) => `More options for ${title}`,
    more: "More",
    rename: "Rename",
    delete: "Delete",
    renamePrompt: "Rename conversation",
    deleteConfirm: (title) => `Delete “${title}” from Kana history?`,
    noMatches: "No matching conversations.",
    noMatchesHint: "Try a different word or start something new.",
    availableFromHermes: "Available from Hermes",
    messages: (count) => `${count} message${count === 1 ? "" : "s"}`,
  },
  activity: {
    title: "Hermes activity",
    steps: (count) => `${count} step${count === 1 ? "" : "s"}`,
    working: "working",
    done: "done",
  },
  slash: {
    commands: "Hermes commands",
    ask: "Ask Hermes to…",
    finding: "Finding actions…",
    navigate: "↑↓ navigate · Tab select",
    skill: "Hermes skill",
    command: "Hermes command",
    unavailable: "unavailable",
    kanaSessionGroup: "Kana & session",
    hermesControlsGroup: "Hermes controls",
    newDescription: "Start a new Kana conversation and Hermes session",
    sessionsDescription: "List locally stored Kana conversations",
    resumeDescription: "Resume a Kana conversation by title or ID",
    approveDescription: "Approve a pending Hermes request",
    denyDescription: "Deny a pending Hermes request",
    commandsDescription: "Show commands and installed skills",
  },
  agentInput: {
    approvalTitle: "Hermes needs approval",
    runOnce: "Run once",
    allowSession: "Allow for session",
    alwaysAllow: "Always allow",
    deny: "Deny",
    smartDenied: "Hermes safety checks recommended denying this action.",
    questionTitle: "Hermes has a question",
    answerLabel: "Your answer",
    answerPlaceholder: "Type a response for Hermes…",
    skip: "Skip",
    sendAnswer: "Send answer",
    sudoTitle: "Sudo password required",
    secretTitle: "Secret required",
    sudoBody: "Hermes needs a password for the current protected command.",
    secretBody: "Hermes needs a secret for the current tool.",
    password: "Password",
    secretValue: "Secret value",
    secureHint: "Sent directly to Hermes; never added to Kana history or local preferences.",
    cancel: "Cancel",
    sending: "Sending…",
    sendSecurely: "Send securely",
  },
  subtitlePicker: {
    commonLanguages: "Common subtitle languages",
    customLanguage: "Custom language",
    customPlaceholder: "Or type any language…",
    customAria: "Custom subtitle language",
    hint: "Hermes writes subtitles in this language. Speech stays Japanese; history is never retranslated.",
  },
  settings: {
    title: "Settings",
    subtitle: "Personal preferences",
    personal: "Personal",
    system: "System",
    sections: {
      experience: { label: "Experience", hint: "Language and subtitles" },
      voice: { label: "Voice", hint: "How Kana sounds" },
      avatar: { label: "Avatar", hint: "Avatar and stage" },
      system: { label: "Connection", hint: "Hermes and voice engine" },
      privacy: { label: "Privacy", hint: "Access and security" },
    },
    sectionsAria: "Settings sections",
    saveError: "Could not save",
    close: "Close settings",
    interfaceTitle: "Interface language",
    interfaceDescription: "Choose the language used by Kana's controls and menus.",
    subtitleTitle: "Subtitle language",
    subtitleDescription: "Kana always speaks Japanese. This controls the written subtitle for new replies.",
    historicalSubtitles: "Existing subtitles stay exactly as you first saw them.",
    voiceTitle: "Kana's voice",
    voiceOn: "Kana speaks new replies in Japanese.",
    voiceOff: "Replies remain available as text while voice is off.",
    voiceToggle: "Japanese voice",
    stageTitle: "Stage background",
    stageDescription: "Choose a stage for Kana. Swipe the carousel or use the arrow buttons.",
    backgroundOptions: {
      plain: { label: "Plain", hint: "A quiet flat stage" },
      room: { label: "Kana's room", hint: "A cozy illustrated room" },
      "pattern-sparkles": { label: "Sparkle grid", hint: "Tiny crosses with an AIRI-like rhythm" },
      "pattern-twinkle": { label: "Soft twinkle", hint: "Airy sparkles and small dots" },
      "pattern-gingham": { label: "Cozy gingham", hint: "A soft check pattern with tiny dots" },
      "pattern-stars": { label: "Star parade", hint: "Playful stars with calm spacing" },
      "pattern-swirls": { label: "Playful swirls", hint: "Loose hand-drawn spiral shapes" },
    },
    backgrounds: (count) => `${count} backgrounds · stored on this device`,
    carouselControls: "Background carousel controls",
    previousBackgrounds: "Previous backgrounds",
    nextBackgrounds: "Next backgrounds",
    stageAria: "Stage background",
    choose: "Choose",
    selected: "Selected",
    localBackground: "Your local background",
    removeLabel: (label) => `Remove ${label}`,
    customBackgroundTitle: "Use your own background",
    customBackgroundHint: "PNG, JPEG, WebP, GIF, AVIF, or BMP · up to 25 MB · kept in this browser",
    adding: "Adding…",
    uploadImage: "Upload image",
    avatarLibrary: "Avatar library",
    avatarLibraryBody: "Choose an included character or import your own Live2D avatar.",
    currentAvatar: "Current avatar",
    selectedAvatar: "Selected avatar",
    yourAvatar: "Your avatar",
    included: "Included",
    includedAvatars: "Included avatars",
    live2dSample: "Live2D sample",
    yourAvatars: "Your avatars",
    storedBrowserOnly: "Stored only in this browser.",
    rename: "Rename",
    remove: "Remove",
    preparingAvatar: "Preparing avatar…",
    importLive2d: "Import Live2D folder",
    importLive2dHint: "Select one complete model folder. Kana keeps it on this device.",
    includedAvatarAbout: "About included avatars",
    hermesTitle: "Hermes",
    hermesDescription: "The agent brain behind Kana. Kana finds and connects it automatically.",
    voiceEngineTitle: "Voice engine",
    voiceEngineDescription: "The local service that turns Kana's Japanese text into speech.",
    accessTitle: "Access protection",
    accessDescription: "Control who can open this Kana installation.",
    privateTitle: "Your private values stay private",
    privateBody: "Passwords and secrets requested by Hermes are sent directly to Hermes and never added to conversation history or preferences.",
    avatarNamePrompt: "Avatar name",
    removeAvatarConfirm: (name) => `Remove “${name}” from this browser?`,
    removeBackgroundConfirm: (name) => `Remove ${name} from this device?`,
    advancedTitle: "Advanced configuration",
    advancedSuffix: "for self-hosted setups",
    advancedBody: "Runtime paths and ports can be configured outside the interface. Kana reads this file when starting its services:",
    advancedRestart: "Restart Kana after changing this file.",
    checkingAccess: "Checking access protection…",
    noPassword: "No password required",
    noPasswordBody: "This Kana installation currently opens without a password. Advanced access configuration lives in the Kana config file.",
    currentPassword: "Current password",
    newPassword: "New password",
    confirmPassword: "Confirm password",
    passwordTooShort: "Use at least 8 characters for the new password.",
    passwordMismatch: "The new passwords do not match.",
    passwordUpdated: "Password updated.",
    passwordFailed: "Could not change the password.",
    updating: "Updating…",
    updatePassword: "Update password",
    logout: "Log out",
  },
  voiceLibrary: {
    title: "Voice library",
    body: "Choose a ready voice. Kana uses it for every new Japanese reply.",
    chooseAria: "Choose Kana's voice",
    available: "Available voices",
    loading: "Loading voices…",
    empty: "No voices yet. Add a voice sample below.",
    selected: "Selected",
    choose: "Choose",
    pending: "Pending",
    remove: "Remove",
    included: "Included with Kana",
    yours: "Your voice",
    waiting: "Waiting for the voice engine…",
    engineLoading: "The voice engine is getting ready. Your voices will appear automatically when it finishes.",
    engineError: "The voice engine could not start. Open Connection to check it.",
    engineStopped: "The voice engine is asleep. Kana will start it when voice is needed.",
    addTitle: "Add your own voice",
    addBody: "Use one clear audio sample that you have permission to use.",
    addSample: "Add sample",
    formAria: "Add a voice sample",
    formTitle: "Add your voice",
    formBody: "A clean sample with one speaker gives the best result.",
    cancel: "Cancel",
    name: "Voice name",
    namePlaceholder: "For example: My voice",
    audio: "Audio sample",
    chooseFile: "Choose audio file",
    consent: "This is my voice, or I have permission to use it.",
    preparing: "Preparing voice…",
    addLibrary: "Add to library",
    validation: "Add a name, choose a voice sample, and confirm you have permission to use it.",
    checkFailed: "Voice check failed.",
    added: (name) => `Voice “${name}” is ready.`,
    addFailed: "The voice could not be added.",
    removeFailed: "The voice could not be removed.",
  },
  status: {
    ready: "Ready when you are",
    connected: "Connected to Hermes",
    reconnecting: "Reconnecting…",
    thinking: "Kana is thinking",
    answering: "Kana is answering",
    responseReceived: "Response received",
    stopped: "Turn stopped",
    attention: "Something needs attention",
    queued: "Message queued — Kana will answer after the current task",
    alreadyNew: "Already on a new conversation",
    newReady: "New conversation ready",
    opening: "Opening the conversation",
    commandComplete: "Command complete",
    continuing: "Hermes is continuing",
    draftReady: "Command prepared a draft",
    stillWorking: "Hermes is still working",
    sendFailed: "Could not send the message",
    disconnected: "Agent disconnected",
    inputSent: "Input sent to Hermes",
    inputFailed: "Input could not be sent",
    preparingVoice: "Kana is preparing voice…",
    speaking: "Kana is speaking…",
  },
  voiceOnOff: (on: boolean) => (on ? "On" : "Off"),
  subtitleNames: {
    ja: "Japanese",
    en: "English",
    id: "Indonesian",
  },
  localeNames: { id: "Indonesia", en: "English" },
};

const dictionaries: Record<UiLocale, Copy> = { id, en };

export function getCopy(locale: UiLocale): Copy {
  return dictionaries[locale];
}

export function isUiLocale(value: unknown): value is UiLocale {
  return value === "id" || value === "en";
}
