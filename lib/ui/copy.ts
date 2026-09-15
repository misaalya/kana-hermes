// Central UI copy dictionary. User-facing strings live here instead of being
// scattered through components, so a language is one object and adding a
// locale is one entry. Migration of older surfaces into this module happens
// incrementally; new components must not hardcode user-facing copy.

import type { Emotion } from "@/lib/presentation/types";

export type UiLocale = "id" | "en";

export type Copy = {
  common: {
    back: string;
    continueLabel: string;
    done: string;
    later: string;
    start: string;
    saving: string;
    close: string;
    selected: string;
    on: string;
    off: string;
  };
  /** BCP 47 tag for dates, times, and browser speech recognition. */
  dateLocale: string;
  onboarding: {
    checkup: string;
    saveFailed: string;
    welcomeEyebrow: string;
    welcomeTitle: string;
    welcomeBody: string;
    welcomePlan: ReadonlyArray<{ title: string; body: string }>;
    welcomeLater: string;
    stepOf(step: number, total: number): string;
    officialSample: string;
    statusReady: string;
    statusOnDemand: string;
    statusAttention: string;
    languageEyebrow: string;
    languageTitle: string;
    languageBody: string;
    interfaceLabel: string;
    subtitleNote: string;
    characterEyebrow: string;
    characterTitle: string;
    characterBody: string;
    voiceLabel: string;
    voiceDownloadNote: string;
    almostThere: string;
    needsHelpTitle: string;
    readyTitle: string;
    servicesBody: string;
    hermesRunning: string;
    hermesInstalled: string;
    hermesMissing: string;
    voiceEngine: string;
    voiceNotNeeded: string;
    voiceReady: string;
    voiceNeedsAttention: string;
    voicePreparedOnUse: string;
    voiceNotInstalled: string;
    voiceUnsupported: string;
    voiceInstalling: string;
    openConnectionSettings: string;
  };
  avatarStage: {
    label: string;
    preparing: string;
    waitingForLive2D: string;
    loadFailed: string;
    loadFailedHint: string;
  };
  composer: {
    reviewAttachments: string;
    filesNeedRegularMessage: string;
    dismissError: string;
    attachments: string;
    remove(name: string): string;
    chooseFiles: string;
    attachFiles: string;
    attachmentLimits(maxFiles: number, maxFileMib: number, maxTotalMib: number): string;
    chooseModel: string;
    closeModelChooser: string;
    dictationStopped: string;
    listening: string;
    listeningOnline: string;
    dictationPermission: string;
    dictationNetwork: string;
    dictationBrave: string;
    dictationUnsupported: string;
    dictationFailed(error: string): string;
    dictationComplete: string;
    noSpeech: string;
    microphoneFailed: string;
    startDictation: string;
    stopDictation: string;
  };
  settingsNotices: {
    avatarsLoadFailed: string;
    backgroundsLoadFailed: string;
    avatarSelected(name: string): string;
    backgroundApplied(name: string): string;
    backgroundImportFailed: string;
    backgroundRemoved(name: string): string;
    backgroundRemoveFailed: string;
    avatarReady(name: string): string;
    avatarImportFailed: string;
    avatarUseFailed: string;
    avatarRemoveFailed: string;
  };
  agentStatus: {
    inputKinds: Record<"approval" | "clarification" | "sudo" | "secret", string>;
    inputNeeded(kind: string): string;
    inputRequested(kind: string): string;
    secureInputWaiting: string;
    inputExpired(kind: string): string;
    resumed(title: string): string;
    branched(title: string): string;
    sessionReopenFailed: string;
  };
  banner: {
    degraded: string;
    action: string;
  };
  panels: {
    hermesTitle: string;
    hermesSubtitle: string;
    states: Record<string, string>;
    start: string;
    starting: string;
    restart: string;
    stop: string;
    refresh: string;
    advanced: string;
    portLabel: string;
    cwdLabel: string;
    cwdPlaceholder: string;
    hermesAria: string;
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
    openAvatarLayout: string;
    avatar: string;
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
  login: {
    eyebrow: string;
    body: string;
    password: string;
    placeholder: string;
    submit: string;
    submitting: string;
    footer: string;
    failed: string;
    unreachable: string;
    setupTitle: string;
    setupBody: string;
    setupSource: string;
    setupRefresh: string;
    themeToggle(nextTheme: "dark" | "light"): string;
    themeLabel(nextTheme: "dark" | "light"): string;
  };
  settings: {
    title: string;
    subtitle: string;
    personal: string;
    system: string;
    sections: Record<string, { label: string; hint: string }>;
    sectionsAria: string;
    saveError: string;
    saved: string;
    logoutDescription: string;
    savingChanges: string;
    close: string;
    interfaceTitle: string;
    interfaceDescription: string;
    subtitleTitle: string;
    subtitleDescription: string;
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
    avatarBehaviorTitle: string;
    avatarBehaviorDescription: string;
    avatarBehaviorReady(mapped: number, total: number): string;
    avatarBehaviorLoading: string;
    avatarBehaviorFailed: string;
    avatarBehaviorBuiltin: string;
    avatarLayoutTitle: string;
    avatarLayoutDescription: string;
    avatarLayoutAutomatic: string;
    avatarLayoutAdjusted: string;
    avatarLayoutHorizontal: string;
    avatarLayoutVertical: string;
    avatarLayoutScale: string;
    avatarLayoutReset: string;
    avatarLayoutAria: string;
    avatarLayoutHint: string;
    avatarLayoutCenter: string;
    avatarLayoutSmaller: string;
    avatarLayoutLarger: string;
    avatarLayoutClose: string;
    avatarLayoutSurface: string;
    avatarMouthParameter: string;
    avatarMouthHint: string;
    avatarMouthReady: string;
    avatarMouthManual: string;
    avatarMouthAdvanced: string;
    avatarMouthAutomaticOption: string;
    avatarMouthReset: string;
    avatarMouthPreview: string;
    avatarNoCapabilities: string;
    avatarUnregistered(expressions: number, motions: number): string;
    avatarEmotionExpression: string;
    avatarEmotionMotion: string;
    avatarNoExpression: string;
    avatarNoMotion: string;
    avatarPreview: string;
    avatarPreviewAria(emotion: string): string;
    avatarMapped: string;
    avatarNotMapped: string;
    avatarEmotionNames: Record<Emotion, string>;
    includedAvatarAbout: string;
    hermesTitle: string;
    hermesDescription: string;
    modelTitle: string;
    modelDescription: string;
    modelLoading: string;
    modelLoadFailed: string;
    modelEmpty: string;
    modelRefresh: string;
    modelCurrent: string;
    modelProvider: string;
    modelName: string;
    modelConfirmNeeded: string;
    modelNextTurn: string;
    modelChanged: string;
    modelChangeFailed: string;
    modelSwitching: string;
    modelConfirmSwitch: string;
    modelInUse: string;
    modelUse: string;
    modelRefreshList: string;
    modelScope: string;
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
    advancedMode: string;
    advancedModeLocal: string;
    advancedModeDeployment: string;
    advancedModeSourceEnvironment: string;
    advancedModeSourceConfig: string;
    advancedModeSourceDefault: string;
    advancedRestart: string;
    advancedConfigError: string;
    checkingAccess: string;
    currentPassword: string;
    newPassword: string;
    confirmPassword: string;
    passwordPolicy: string;
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
    remove: string;
    included: string;
    yours: string;
    modelVoice: string;
    externalProvider(name: string): string;
    externalReady: string;
    externalUnavailable: string;
    externalChecking: string;
    externalRefresh: string;
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
    notWav: string;
    tooLarge(maxMib: number): string;
    defaultProtected: string;
    audioUnsupported: string;
    audioUnreadable: string;
  };
  voiceEngine: {
    title: string;
    aria: string;
    body(model: string): string;
    states: Record<"ready" | "installing" | "not_installed" | "failed" | "unsupported" | "checking", string>;
    downloadNote(size: string): string;
    diskNote(needed: string, free: string): string;
    lowDisk(needed: string, free: string): string;
    progress(step: string, percent: number): string;
    steps: Record<"engine" | "assets" | "model", string>;
    phases: Record<"downloading" | "verifying" | "extracting", string>;
    reusedCache: string;
    configuredModel: string;
    device(int8: boolean): string;
    install: string;
    resume: string;
    cancel: string;
    remove: string;
    confirmRemove: string;
    refresh: string;
    failedCheck: string;
    notInstalledHint: string;
  };
  status: Record<string, string>;
};

const id: Copy = {
  common: {
    back: "Kembali",
    continueLabel: "Lanjut",
    done: "Selesai",
    later: "Nanti",
    start: "Mulai",
    saving: "Menyimpan…",
    close: "Tutup",
    selected: "Dipilih",
    on: "Aktif",
    off: "Nonaktif",
  },
  dateLocale: "id-ID",
  onboarding: {
    checkup: "Pemeriksaan",
    saveFailed: "Pengaturan awal tidak dapat disimpan.",
    welcomeEyebrow: "Selamat datang",
    welcomeTitle: "Kenalan dulu dengan Kana",
    welcomeBody: "Kana memberi wajah dan suara untuk Hermes Agent-mu. Hermes tetap yang berpikir dan bekerja. Ada tiga langkah singkat, tidak sampai semenit.",
    welcomePlan: [
      { title: "Bahasa", body: "Bahasa menu dan tombol Kana." },
      { title: "Karakter dan suara", body: "Avatar Live2D dan suara Kana." },
      { title: "Pemeriksaan", body: "Memastikan Hermes dan mesin suara siap." },
    ],
    welcomeLater: "Semua pilihan bisa diubah nanti di Pengaturan.",
    stepOf: (step, total) => `Langkah ${step} dari ${total}`,
    officialSample: "Sampel resmi Live2D",
    statusReady: "Siap",
    statusOnDemand: "Saat dibutuhkan",
    statusAttention: "Perlu perhatian",
    languageEyebrow: "Bahasa",
    languageTitle: "Buat percakapan terasa nyaman",
    languageBody: "Pilih bahasa untuk menu dan tombol Kana.",
    interfaceLabel: "Antarmuka",
    subtitleNote: "Kana selalu berbicara dalam bahasa Jepang. Subtitle otomatis mengikuti bahasa yang kamu pakai saat menulis, jadi tidak perlu diatur.",
    characterEyebrow: "Karakter",
    characterTitle: "Pilih tampilan dan suara",
    characterBody: "Mulai dengan pilihan bawaan. Avatar Live2D dan sampel suaramu sendiri bisa ditambahkan dari Pengaturan.",
    voiceLabel: "Suara Kana",
    voiceDownloadNote: "Suara memakai mesin lokal yang perlu diunduh sekali (±3,6 GB) dari Pengaturan → Suara. Tanpa itu, balasan tetap tampil sebagai teks.",
    almostThere: "Hampir selesai",
    needsHelpTitle: "Kana butuh sedikit bantuan",
    readyTitle: "Kana siap menemanimu",
    servicesBody: "Kami memeriksa dua layanan lokal yang membuat Kana bekerja.",
    hermesRunning: "Terhubung dan siap.",
    hermesInstalled: "Terpasang; Kana akan menyalakannya saat dibutuhkan.",
    hermesMissing: "Hermes belum ditemukan di perangkat ini.",
    voiceEngine: "Mesin suara",
    voiceNotNeeded: "Tidak diperlukan karena suara dimatikan.",
    voiceReady: "Siap berbicara.",
    voiceNeedsAttention: "Perlu diperiksa dari Pengaturan.",
    voicePreparedOnUse: "Akan disiapkan saat pertama digunakan.",
    voiceNotInstalled: "Mesin suara belum diunduh. Unduh dari Pengaturan → Suara.",
    voiceUnsupported: "Mesin suara lokal tidak bisa berjalan di perangkat ini. Pakai penyedia suara OpenAI-compatible di config.json.",
    voiceInstalling: "Mesin suara sedang diunduh.",
    openConnectionSettings: "Buka pengaturan koneksi",
  },
  avatarStage: {
    label: "Panggung avatar Kana",
    preparing: "Kana sedang bersiap",
    waitingForLive2D: "Menunggu avatar Live2D",
    loadFailed: "Avatar tidak dapat dimuat",
    loadFailedHint: "Pilih avatar lain di Pengaturan → Avatar.",
  },
  composer: {
    reviewAttachments: "Periksa file terlampir.",
    filesNeedRegularMessage: "Kirim file bersama pesan biasa setelah respons selesai, bukan perintah slash.",
    dismissError: "Tutup pesan kesalahan",
    attachments: "Lampiran",
    remove: (name) => `Hapus ${name}`,
    chooseFiles: "Pilih file",
    attachFiles: "Tambahkan file",
    attachmentLimits: (maxFiles, maxFileMib, maxTotalMib) =>
      `Maksimal ${maxFiles} file, ${maxFileMib} MiB per file, ${maxTotalMib} MiB total. File tidak boleh kosong.`,
    chooseModel: "Pilih model",
    closeModelChooser: "Tutup pilihan model",
    dictationStopped: "Dikte dihentikan.",
    listening: "Mendengarkan…",
    listeningOnline: "Mendengarkan… layanan browser dapat menggunakan internet.",
    dictationPermission: "Izinkan mikrofon dan layanan pengenalan suara di browser.",
    dictationNetwork: "Layanan dikte browser tidak terhubung. Periksa internet; browser berbasis Chromium tanpa layanan Google tidak bisa dikte, jadi pakai Google Chrome atau Edge.",
    dictationBrave: "Brave tidak mendukung dikte suara karena tidak terhubung ke layanan pengenalan suara. Pakai Google Chrome atau Edge, atau ketik pesan.",
    dictationUnsupported: "Dikte perlu HTTPS atau localhost dan browser yang mendukung pengenalan suara, seperti Google Chrome.",
    dictationFailed: (error) => `Dikte gagal (${error}). Coba lagi atau ketik pesan.`,
    dictationComplete: "Dikte selesai. Periksa teks lalu kirim.",
    noSpeech: "Tidak ada ucapan terdeteksi. Coba lagi.",
    microphoneFailed: "Mikrofon tidak bisa dimulai. Periksa izin browser.",
    startDictation: "Dikte suara",
    stopDictation: "Hentikan dikte",
  },
  settingsNotices: {
    avatarsLoadFailed: "Avatar tidak dapat dimuat.",
    backgroundsLoadFailed: "Latar lokal tidak dapat dimuat.",
    avatarSelected: (name) => `${name} dipilih.`,
    backgroundApplied: (name) => `${name} sekarang menjadi latar panggungmu.`,
    backgroundImportFailed: "Gambar ini tidak dapat diimpor.",
    backgroundRemoved: (name) => `${name} dihapus dari perangkat ini.`,
    backgroundRemoveFailed: "Latar ini tidak dapat dihapus.",
    avatarReady: (name) => `${name} siap digunakan.`,
    avatarImportFailed: "Avatar ini tidak dapat diimpor.",
    avatarUseFailed: "Avatar ini tidak dapat digunakan.",
    avatarRemoveFailed: "Avatar ini tidak dapat dihapus.",
  },
  agentStatus: {
    inputKinds: {
      approval: "persetujuan",
      clarification: "klarifikasi",
      sudo: "kata sandi sudo",
      secret: "nilai rahasia",
    },
    inputNeeded: (kind) => `Hermes memerlukan ${kind}`,
    inputRequested: (kind) => `Hermes meminta ${kind}`,
    secureInputWaiting: "Input aman sedang menunggu di Kana.",
    inputExpired: (kind) => `Permintaan ${kind} telah kedaluwarsa`,
    resumed: (title) => `Melanjutkan ${title}`,
    branched: (title) => `Membuat cabang ke ${title}`,
    sessionReopenFailed: "Sesi Hermes untuk percakapan ini tidak dapat dibuka kembali.",
  },
  banner: {
    degraded: "Ada komponen Kana yang bermasalah.",
    action: "Periksa",
  },
  panels: {
    hermesTitle: "Hermes — otak asisten",
    hermesSubtitle: "Proses resmi di mesin ini, tanpa dimodifikasi.",
    states: {
      checking: "memeriksa…",
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
    advanced: "Pengaturan lanjutan",
    portLabel: "Port lokal",
    cwdLabel: "Folder kerja (opsional)",
    cwdPlaceholder: "/home/user/project",
    hermesAria: "Kontrol proses Hermes",
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
    missingBinary: "Hermes belum ditemukan. Jalankan `kana doctor`, lalu atur hermes.executable di config.json jika lokasinya khusus.",
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
    openAvatarLayout: "Atur posisi dan ukuran avatar",
    avatar: "Avatar",
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
  login: {
    eyebrow: "Selamat datang kembali",
    body: "Masukkan kata sandi lokalmu untuk kembali ke Kana.",
    password: "Kata sandi",
    placeholder: "Masukkan kata sandi",
    submit: "Masuk ke Kana",
    submitting: "Masuk…",
    footer: "Kata sandimu hanya tersimpan di instalasi Kana ini.",
    failed: "Gagal masuk.",
    unreachable: "Server login tidak dapat dihubungi.",
    setupTitle: "Buat kata sandi dulu",
    setupBody: "Kana belum punya kata sandi. Demi keamanan, kata sandi pertama hanya bisa dibuat dari terminal di mesin yang menjalankan Kana:",
    setupSource: "Dari source checkout, jalankan `npm run password`. Setelah itu muat ulang halaman ini.",
    setupRefresh: "Periksa lagi",
    themeToggle: (next) => `Ganti ke tema ${next === "dark" ? "gelap" : "terang"}`,
    themeLabel: (next) => (next === "dark" ? "Gelap" : "Terang"),
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
      model: { label: "Model AI", hint: "Provider dan model percakapan" },
      system: { label: "Koneksi", hint: "Hermes dan mesin suara" },
      privacy: { label: "Privasi", hint: "Akses dan keamanan" },
    },
    sectionsAria: "Bagian pengaturan",
    saveError: "Tidak dapat menyimpan",
    saved: "Tersimpan otomatis",
    logoutDescription: "Keluar dari browser ini. Browser lain tetap masuk sampai kata sandi diganti.",
    savingChanges: "Menyimpan…",
    close: "Tutup pengaturan",
    interfaceTitle: "Bahasa antarmuka",
    interfaceDescription: "Pilih bahasa yang digunakan oleh kontrol dan menu Kana.",
    subtitleTitle: "Subtitle",
    subtitleDescription: "Kana selalu berbicara dalam bahasa Jepang. Subtitle otomatis memakai bahasa yang kamu pakai saat menulis, dan subtitle lama tetap seperti saat pertama ditampilkan.",
    voiceTitle: "Suara Kana",
    voiceOn: "Kana membacakan balasan baru dalam bahasa Jepang.",
    voiceOff: "Balasan tetap tersedia sebagai teks saat suara dimatikan.",
    voiceToggle: "Suara Jepang",
    stageTitle: "Latar panggung",
    stageDescription: "Pilih panggung untuk Kana. Geser carousel atau gunakan tombol panah.",
    backgroundOptions: {
      plain: { label: "Polos", hint: "Panggung datar yang tenang" },
      room: { label: "Kamar Kana", hint: "Kamar ilustrasi yang nyaman" },
      "pattern-sakura": { label: "Sakura", hint: "Bunga sakura kecil dan kelopak lepas" },
      "pattern-sparkle": { label: "Kilau", hint: "Kilau empat sudut ala anime" },
      "pattern-clouds": { label: "Awan", hint: "Awan mungil yang berselang-seling" },
      "pattern-seigaiha": { label: "Seigaiha", hint: "Pola ombak tradisional Jepang" },
      "pattern-ribbon": { label: "Pita", hint: "Pita kecil dengan titik-titik lembut" },
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
    avatarBehaviorTitle: "Ekspresi avatar",
    avatarBehaviorDescription: "Hubungkan emosi Kana dengan ekspresi dan gerakan yang memang tersedia pada avatar ini.",
    avatarBehaviorReady: (mapped, total) => `${mapped} dari ${total} emosi terhubung`,
    avatarBehaviorLoading: "Membaca kemampuan avatar…",
    avatarBehaviorFailed: "Kemampuan avatar tidak dapat dibaca.",
    avatarBehaviorBuiltin: "Avatar bawaan sudah memiliki pemetaan ekspresi yang disiapkan oleh Kana.",
    avatarLayoutTitle: "Posisi avatar",
    avatarLayoutDescription: "Kana menyesuaikan model otomatis dari bounds Live2D-nya. Koreksi ini disimpan khusus untuk avatar yang sedang dipilih.",
    avatarLayoutAutomatic: "Posisi otomatis",
    avatarLayoutAdjusted: "Disesuaikan",
    avatarLayoutHorizontal: "Horizontal",
    avatarLayoutVertical: "Vertikal",
    avatarLayoutScale: "Ukuran",
    avatarLayoutReset: "Atur ulang",
    avatarLayoutAria: "Atur posisi dan ukuran avatar",
    avatarLayoutHint: "Seret avatar untuk memindahkannya. Scroll atau cubit untuk mengubah ukuran.",
    avatarLayoutCenter: "Tengah",
    avatarLayoutSmaller: "Perkecil avatar",
    avatarLayoutLarger: "Perbesar avatar",
    avatarLayoutClose: "Tutup pengaturan posisi avatar",
    avatarLayoutSurface: "Panggung avatar. Seret untuk memindahkan, tombol panah untuk menggeser, plus atau minus untuk ukuran.",
    avatarMouthParameter: "Lip-sync otomatis",
    avatarMouthHint: "Kana mendeteksi kontrol mulut saat avatar dimuat. Jika model tidak menyediakannya, avatar tetap berfungsi tanpa lip-sync.",
    avatarMouthReady: "Diatur otomatis",
    avatarMouthManual: "Pilihan manual",
    avatarMouthAdvanced: "Ubah secara manual",
    avatarMouthAutomaticOption: "Otomatis (disarankan)",
    avatarMouthReset: "Kembali ke lip-sync otomatis",
    avatarMouthPreview: "Tes lip-sync",
    avatarNoCapabilities: "Folder ini tidak memiliki ekspresi atau gerakan yang dapat digunakan. Percakapan dan avatar tetap berfungsi, tetapi pose tidak akan berubah mengikuti emosi.",
    avatarUnregistered: (expressions, motions) => `${expressions} ekspresi dan ${motions} gerakan tambahan ditemukan dan sudah disiapkan oleh Kana. Pilih pada emosi di bawah, lalu gunakan Pratinjau untuk melihat hasilnya.`,
    avatarEmotionExpression: "Ekspresi wajah",
    avatarEmotionMotion: "Gerakan opsional",
    avatarNoExpression: "Tanpa ekspresi",
    avatarNoMotion: "Tanpa gerakan",
    avatarPreview: "Pratinjau",
    avatarPreviewAria: (emotion) => `Pratinjau emosi ${emotion}`,
    avatarMapped: "Terhubung",
    avatarNotMapped: "Belum terhubung",
    avatarEmotionNames: {
      neutral: "Netral",
      happy: "Senang",
      sad: "Sedih",
      angry: "Marah",
      surprised: "Terkejut",
      thinking: "Berpikir",
      confused: "Bingung",
      excited: "Antusias",
    },
    includedAvatarAbout: "Tentang avatar bawaan",
    hermesTitle: "Hermes",
    hermesDescription: "Otak agen di balik Kana. Kana menemukan dan menghubungkannya secara otomatis.",
    modelTitle: "Model AI",
    modelDescription: "Pilih provider dan model Hermes untuk percakapan yang sedang dibuka.",
    modelLoading: "Memuat model dari Hermes…",
    modelLoadFailed: "Model tidak dapat dimuat.",
    modelEmpty: "Hermes belum melaporkan provider dengan model yang siap digunakan.",
    modelRefresh: "Muat ulang model",
    modelCurrent: "Model percakapan saat ini",
    modelProvider: "Provider",
    modelName: "Model",
    modelConfirmNeeded: "Hermes meminta konfirmasi biaya sebelum mengganti model.",
    modelNextTurn: "Model akan digunakan mulai giliran berikutnya.",
    modelChanged: "Model untuk percakapan ini sudah diganti.",
    modelChangeFailed: "Model tidak dapat diganti.",
    modelSwitching: "Mengganti…",
    modelConfirmSwitch: "Konfirmasi dan ganti",
    modelInUse: "Sedang digunakan",
    modelUse: "Gunakan model ini",
    modelRefreshList: "Segarkan daftar",
    modelScope: "Pilihan berlaku untuk percakapan Hermes ini. Provider dan model selalu dikirim sebagai dua nilai terpisah.",
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
    advancedMode: "Mode instalasi",
    advancedModeLocal: "Lokal — hanya digunakan dari mesin yang sama",
    advancedModeDeployment: "Deployment — diakses lewat VPS, Nginx, atau jaringan",
    advancedModeSourceEnvironment: "Mode ini sedang ditentukan oleh KANA_DEPLOYMENT_MODE dan mengesampingkan file JSON.",
    advancedModeSourceConfig: "Mode ini dibaca dari file JSON di atas.",
    advancedModeSourceDefault: "Mode lokal bawaan digunakan karena belum ada pilihan eksplisit.",
    advancedRestart: "Perubahan TTS dan mode dibaca otomatis; port Hermes berlaku setelah Kana dimulai ulang.",
    advancedConfigError: "File ini tidak valid, jadi Kana memakai pengaturan bawaan:",
    checkingAccess: "Memeriksa perlindungan akses…",
    currentPassword: "Kata sandi saat ini",
    newPassword: "Kata sandi baru",
    confirmPassword: "Konfirmasi kata sandi",
    passwordPolicy: "Gunakan 8–256 karakter, tanpa spasi di awal atau akhir.",
    passwordMismatch: "Kata sandi baru tidak cocok.",
    passwordUpdated: "Kata sandi diperbarui.",
    passwordFailed: "Kata sandi tidak dapat diubah.",
    updating: "Memperbarui…",
    updatePassword: "Perbarui kata sandi",
    logout: "Keluar",
  },
  voiceLibrary: {
    title: "Koleksi suara",
    body: "Kana memakai suara ini untuk setiap balasan Jepang baru. Suara berbasis sampel lebih konsisten, suara Irodori lebih cepat.",
    chooseAria: "Pilih suara Kana",
    available: "Suara yang tersedia",
    loading: "Memuat suara…",
    empty: "Belum ada suara. Tambahkan sampel suara di bawah.",
    selected: "Dipilih",
    choose: "Pilih",
    remove: "Hapus",
    included: "Bawaan Kana",
    yours: "Suaramu",
    modelVoice: "Suara asli model · tercepat",
    externalProvider: (name) => `Kana memakai ${name}. Suara, model, dan kredensial provider ini diatur melalui config.json.`,
    externalReady: "Siap digunakan",
    externalUnavailable: "Konfigurasi belum siap",
    externalChecking: "Memeriksa provider…",
    externalRefresh: "Periksa ulang",
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
    notWav: "Sampel suara harus berupa WAV.",
    tooLarge: (maxMib) => `Sampel suara maksimal ${maxMib} MB.`,
    defaultProtected: "Suara bawaan tidak bisa dihapus.",
    audioUnsupported: "Browser tidak mendukung konversi audio. Gunakan file WAV.",
    audioUnreadable: "Audio tidak bisa dibaca browser. Gunakan WAV, atau format lain yang bisa diputar di sini.",
  },
  voiceEngine: {
    title: "Mesin suara lokal",
    aria: "Mesin suara lokal",
    body: (model) => `${model} lewat mesin irodori-c, berjalan di CPU mesin ini tanpa Python atau GPU.`,
    states: {
      ready: "Terpasang",
      installing: "Mengunduh…",
      not_installed: "Belum diunduh",
      failed: "Gagal",
      unsupported: "Tidak didukung",
      checking: "Memeriksa…",
    },
    downloadNote: (size) => `Unduhan ${size}. Tidak ada yang diunduh sampai kamu memintanya.`,
    diskNote: (needed, free) => `Butuh ${needed} ruang disk · tersedia ${free}.`,
    lowDisk: (needed, free) => `Ruang disk tidak cukup: butuh ${needed}, tersedia ${free}.`,
    progress: (step, percent) => `${step} · ${percent}%`,
    steps: { engine: "Mesin", assets: "Aset suara", model: "Model" },
    phases: { downloading: "Mengunduh", verifying: "Memeriksa checksum", extracting: "Membongkar" },
    reusedCache: "Model dipakai ulang dari cache Hugging Face, jadi tidak diunduh lagi.",
    configuredModel: "Model memakai file dari tts.irodoriLocal.modelPath.",
    device: (int8) => (int8 ? "CPU int8 (AVX-512 VNNI)" : "CPU fp32"),
    install: "Unduh mesin suara",
    resume: "Lanjutkan unduhan",
    cancel: "Batalkan",
    remove: "Hapus",
    confirmRemove: "Yakin hapus?",
    refresh: "Perbarui",
    failedCheck: "Status mesin suara tidak dapat diperiksa.",
    notInstalledHint: "Kana baru bisa bersuara setelah mesin suara diunduh. Sampai itu, balasan tetap tampil sebagai teks.",
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
};

const en: Copy = {
  common: {
    back: "Back",
    continueLabel: "Continue",
    done: "Done",
    later: "Later",
    start: "Start",
    saving: "Saving…",
    close: "Close",
    selected: "Selected",
    on: "On",
    off: "Off",
  },
  dateLocale: "en-US",
  onboarding: {
    checkup: "Checkup",
    saveFailed: "Could not save setup.",
    welcomeEyebrow: "Welcome",
    welcomeTitle: "Meet Kana",
    welcomeBody: "Kana gives your Hermes agent a face and a voice. Hermes still does the thinking and the work. Three short steps, under a minute.",
    welcomePlan: [
      { title: "Language", body: "The language of Kana's menus and buttons." },
      { title: "Character and voice", body: "Kana's Live2D avatar and voice." },
      { title: "Checkup", body: "Makes sure Hermes and the voice engine are ready." },
    ],
    welcomeLater: "Every choice can be changed later in Settings.",
    stepOf: (step, total) => `Step ${step} of ${total}`,
    officialSample: "Official Live2D sample",
    statusReady: "Ready",
    statusOnDemand: "On demand",
    statusAttention: "Needs attention",
    languageEyebrow: "Language",
    languageTitle: "Make conversation feel comfortable",
    languageBody: "Choose the language for Kana's menus and buttons.",
    interfaceLabel: "Interface",
    subtitleNote: "Kana always speaks Japanese. Subtitles automatically follow the language you write in, so there is nothing to set.",
    characterEyebrow: "Character",
    characterTitle: "Choose a look and voice",
    characterBody: "Start with a default. Your own Live2D avatar and voice sample can be added from Settings.",
    voiceLabel: "Kana's voice",
    voiceDownloadNote: "Voice uses a local engine that is downloaded once (~3.6 GB) from Settings → Voice. Without it, replies still appear as text.",
    almostThere: "Almost there",
    needsHelpTitle: "Kana needs a little help",
    readyTitle: "Kana is ready for you",
    servicesBody: "We checked the two local services that make Kana work.",
    hermesRunning: "Connected and ready.",
    hermesInstalled: "Installed; Kana will start it when needed.",
    hermesMissing: "Hermes was not found on this device.",
    voiceEngine: "Voice engine",
    voiceNotNeeded: "Not needed while voice is off.",
    voiceReady: "Ready to speak.",
    voiceNeedsAttention: "Needs attention in Settings.",
    voicePreparedOnUse: "Will be prepared on first use.",
    voiceNotInstalled: "The voice engine is not downloaded yet. Download it in Settings → Voice.",
    voiceUnsupported: "The local voice engine cannot run on this device. Use an OpenAI-compatible voice provider in config.json.",
    voiceInstalling: "The voice engine is downloading.",
    openConnectionSettings: "Open connection settings",
  },
  avatarStage: {
    label: "Kana avatar stage",
    preparing: "Kana is getting ready",
    waitingForLive2D: "Waiting for Live2D avatar",
    loadFailed: "The avatar couldn't load",
    loadFailedHint: "Choose another avatar in Settings → Avatar.",
  },
  composer: {
    reviewAttachments: "Review the attached files.",
    filesNeedRegularMessage: "Send files with a regular message after the current reply finishes, without a slash command.",
    dismissError: "Dismiss error",
    attachments: "Attachments",
    remove: (name) => `Remove ${name}`,
    chooseFiles: "Choose files",
    attachFiles: "Attach files",
    attachmentLimits: (maxFiles, maxFileMib, maxTotalMib) =>
      `Up to ${maxFiles} non-empty files, ${maxFileMib} MiB per file, ${maxTotalMib} MiB total.`,
    chooseModel: "Choose model",
    closeModelChooser: "Close model chooser",
    dictationStopped: "Dictation stopped.",
    listening: "Listening…",
    listeningOnline: "Listening… the browser service may use the internet.",
    dictationPermission: "Allow microphone and speech recognition access in your browser.",
    dictationNetwork: "The browser's dictation service could not connect. Check your internet; Chromium-based browsers without Google's service cannot dictate, so use Google Chrome or Edge.",
    dictationBrave: "Brave does not support voice input because it cannot reach a speech recognition service. Use Google Chrome or Edge, or type your message.",
    dictationUnsupported: "Dictation needs HTTPS or localhost and a browser with speech recognition, such as Google Chrome.",
    dictationFailed: (error) => `Dictation failed (${error}). Retry or type your message.`,
    dictationComplete: "Dictation complete. Review the text before sending.",
    noSpeech: "No speech detected. Try again.",
    microphoneFailed: "Could not start the microphone. Check browser permissions.",
    startDictation: "Voice input",
    stopDictation: "Stop dictation",
  },
  settingsNotices: {
    avatarsLoadFailed: "Could not load avatars.",
    backgroundsLoadFailed: "Could not load local backgrounds.",
    avatarSelected: (name) => `${name} selected.`,
    backgroundApplied: (name) => `${name} is now your stage background.`,
    backgroundImportFailed: "Could not import this image.",
    backgroundRemoved: (name) => `${name} was removed from this device.`,
    backgroundRemoveFailed: "Could not remove this background.",
    avatarReady: (name) => `${name} is ready to use.`,
    avatarImportFailed: "Could not import this avatar.",
    avatarUseFailed: "Could not use this avatar.",
    avatarRemoveFailed: "Could not remove this avatar.",
  },
  agentStatus: {
    inputKinds: {
      approval: "approval",
      clarification: "clarification",
      sudo: "sudo",
      secret: "secret",
    },
    inputNeeded: (kind) => `Hermes needs ${kind}`,
    inputRequested: (kind) => `Hermes requested ${kind}`,
    secureInputWaiting: "Secure input is waiting in Kana.",
    inputExpired: (kind) => `${kind} request expired`,
    resumed: (title) => `Resumed ${title}`,
    branched: (title) => `Branched to ${title}`,
    sessionReopenFailed: "Could not reopen the Hermes session for this conversation.",
  },
  banner: {
    degraded: "A Kana component is having trouble.",
    action: "Check",
  },
  panels: {
    hermesTitle: "Hermes — the assistant's brain",
    hermesSubtitle: "The official, unmodified process on this machine.",
    states: {
      checking: "checking…",
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
    advanced: "Advanced",
    portLabel: "Local port",
    cwdLabel: "Working folder (optional)",
    cwdPlaceholder: "/home/user/project",
    hermesAria: "Hermes process control",
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
    missingBinary: "Hermes was not found. Run `kana doctor`, then set hermes.executable in config.json if it uses a custom location.",
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
    openAvatarLayout: "Adjust avatar position and size",
    avatar: "Avatar",
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
  login: {
    eyebrow: "Welcome back",
    body: "Enter your local password to return to your companion.",
    password: "Password",
    placeholder: "Enter your password",
    submit: "Enter Kana",
    submitting: "Entering…",
    footer: "Your password stays on this Kana installation.",
    failed: "Login failed.",
    unreachable: "Could not reach the login server.",
    setupTitle: "Set a password first",
    setupBody: "Kana has no password yet. For safety, the first password can only be created from a terminal on the machine running Kana:",
    setupSource: "From a source checkout, run `npm run password`. Then reload this page.",
    setupRefresh: "Check again",
    themeToggle: (next) => `Switch to ${next} theme`,
    themeLabel: (next) => (next === "dark" ? "Dark" : "Light"),
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
      model: { label: "AI model", hint: "Conversation provider and model" },
      system: { label: "Connection", hint: "Hermes and voice engine" },
      privacy: { label: "Privacy", hint: "Access and security" },
    },
    sectionsAria: "Settings sections",
    saveError: "Could not save",
    saved: "Saved automatically",
    logoutDescription: "Sign out of this browser. Other browsers stay signed in until the password changes.",
    savingChanges: "Saving…",
    close: "Close settings",
    interfaceTitle: "Interface language",
    interfaceDescription: "Choose the language used by Kana's controls and menus.",
    subtitleTitle: "Subtitles",
    subtitleDescription: "Kana always speaks Japanese. Subtitles automatically use the language you write in, and earlier subtitles stay exactly as you first saw them.",
    voiceTitle: "Kana's voice",
    voiceOn: "Kana speaks new replies in Japanese.",
    voiceOff: "Replies remain available as text while voice is off.",
    voiceToggle: "Japanese voice",
    stageTitle: "Stage background",
    stageDescription: "Choose a stage for Kana. Swipe the carousel or use the arrow buttons.",
    backgroundOptions: {
      plain: { label: "Plain", hint: "A quiet flat stage" },
      room: { label: "Kana's room", hint: "A cozy illustrated room" },
      "pattern-sakura": { label: "Sakura", hint: "Small cherry blossoms and loose petals" },
      "pattern-sparkle": { label: "Sparkle", hint: "Four-point anime sparkles" },
      "pattern-clouds": { label: "Clouds", hint: "Tiny clouds in offset rows" },
      "pattern-seigaiha": { label: "Seigaiha", hint: "Traditional Japanese wave scales" },
      "pattern-ribbon": { label: "Ribbon", hint: "Little bows with soft dots" },
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
    avatarBehaviorTitle: "Avatar expressions",
    avatarBehaviorDescription: "Connect Kana's emotions to expressions and motions that are actually available in this avatar.",
    avatarBehaviorReady: (mapped, total) => `${mapped} of ${total} emotions connected`,
    avatarBehaviorLoading: "Reading avatar capabilities…",
    avatarBehaviorFailed: "Could not read this avatar's capabilities.",
    avatarBehaviorBuiltin: "Included avatars already have expression mappings prepared by Kana.",
    avatarLayoutTitle: "Avatar position",
    avatarLayoutDescription: "Kana fits the model automatically from its Live2D bounds. These corrections are stored only for the selected avatar.",
    avatarLayoutAutomatic: "Automatic position",
    avatarLayoutAdjusted: "Adjusted",
    avatarLayoutHorizontal: "Horizontal",
    avatarLayoutVertical: "Vertical",
    avatarLayoutScale: "Size",
    avatarLayoutReset: "Reset",
    avatarLayoutAria: "Adjust avatar position and size",
    avatarLayoutHint: "Drag the avatar to move it. Scroll or pinch to resize.",
    avatarLayoutCenter: "Center",
    avatarLayoutSmaller: "Make avatar smaller",
    avatarLayoutLarger: "Make avatar larger",
    avatarLayoutClose: "Close avatar position",
    avatarLayoutSurface: "Avatar stage. Drag to move, arrow keys to nudge, plus or minus to resize.",
    avatarMouthParameter: "Automatic lip sync",
    avatarMouthHint: "Kana detects the mouth control when the avatar loads. If the model does not provide one, the avatar still works without lip sync.",
    avatarMouthReady: "Automatic",
    avatarMouthManual: "Manual selection",
    avatarMouthAdvanced: "Change manually",
    avatarMouthAutomaticOption: "Automatic (recommended)",
    avatarMouthReset: "Reset to automatic lip sync",
    avatarMouthPreview: "Test lip sync",
    avatarNoCapabilities: "This folder has no usable expressions or motions. Chat and the avatar still work, but its pose will not react to emotions.",
    avatarUnregistered: (expressions, motions) => `${expressions} extra expressions and ${motions} extra motions were found and prepared by Kana. Assign them to an emotion below, then use Preview to check the result.`,
    avatarEmotionExpression: "Facial expression",
    avatarEmotionMotion: "Optional motion",
    avatarNoExpression: "No expression",
    avatarNoMotion: "No motion",
    avatarPreview: "Preview",
    avatarPreviewAria: (emotion) => `Preview ${emotion} emotion`,
    avatarMapped: "Connected",
    avatarNotMapped: "Not connected",
    avatarEmotionNames: {
      neutral: "Neutral",
      happy: "Happy",
      sad: "Sad",
      angry: "Angry",
      surprised: "Surprised",
      thinking: "Thinking",
      confused: "Confused",
      excited: "Excited",
    },
    includedAvatarAbout: "About included avatars",
    hermesTitle: "Hermes",
    hermesDescription: "The agent brain behind Kana. Kana finds and connects it automatically.",
    modelTitle: "AI model",
    modelDescription: "Choose the Hermes provider and model for the open conversation.",
    modelLoading: "Loading models from Hermes…",
    modelLoadFailed: "Could not load models.",
    modelEmpty: "Hermes did not report any configured provider with usable models.",
    modelRefresh: "Refresh models",
    modelCurrent: "Current conversation model",
    modelProvider: "Provider",
    modelName: "Model",
    modelConfirmNeeded: "Hermes requires a cost confirmation before changing models.",
    modelNextTurn: "The model will be used from the next turn.",
    modelChanged: "The model for this conversation has been changed.",
    modelChangeFailed: "Could not change the model.",
    modelSwitching: "Switching…",
    modelConfirmSwitch: "Confirm and switch",
    modelInUse: "In use",
    modelUse: "Use this model",
    modelRefreshList: "Refresh list",
    modelScope: "The choice applies to this Hermes conversation. Provider and model are always sent as separate values.",
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
    advancedMode: "Installation mode",
    advancedModeLocal: "Local — used only from the same machine",
    advancedModeDeployment: "Deployment — accessed through a VPS, Nginx, or network",
    advancedModeSourceEnvironment: "This mode is currently set by KANA_DEPLOYMENT_MODE and overrides the JSON file.",
    advancedModeSourceConfig: "This mode is read from the JSON file above.",
    advancedModeSourceDefault: "The local default is used because no explicit mode is configured.",
    advancedRestart: "TTS and mode changes are picked up automatically; Hermes port changes apply after restarting Kana.",
    advancedConfigError: "This file is invalid, so Kana is using defaults:",
    checkingAccess: "Checking access protection…",
    currentPassword: "Current password",
    newPassword: "New password",
    confirmPassword: "Confirm password",
    passwordPolicy: "Use 8–256 characters with no leading or trailing spaces.",
    passwordMismatch: "The new passwords do not match.",
    passwordUpdated: "Password updated.",
    passwordFailed: "Could not change the password.",
    updating: "Updating…",
    updatePassword: "Update password",
    logout: "Log out",
  },
  voiceLibrary: {
    title: "Voice library",
    body: "Kana uses this voice for every new Japanese reply. Sample-based voices stay more consistent; the Irodori voice is faster.",
    chooseAria: "Choose Kana's voice",
    available: "Available voices",
    loading: "Loading voices…",
    empty: "No voices yet. Add a voice sample below.",
    selected: "Selected",
    choose: "Choose",
    remove: "Remove",
    included: "Included with Kana",
    yours: "Your voice",
    modelVoice: "The model's own voice · fastest",
    externalProvider: (name) => `Kana is using ${name}. Its voice, model, and credentials are managed in config.json.`,
    externalReady: "Ready to use",
    externalUnavailable: "Configuration is not ready",
    externalChecking: "Checking provider…",
    externalRefresh: "Check again",
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
    notWav: "Voice samples must be WAV files.",
    tooLarge: (maxMib) => `Voice samples can be at most ${maxMib} MB.`,
    defaultProtected: "The bundled voice cannot be removed.",
    audioUnsupported: "This browser cannot convert audio. Use a WAV file.",
    audioUnreadable: "The browser could not read this audio. Use WAV or another format it can play.",
  },
  voiceEngine: {
    title: "Local voice engine",
    aria: "Local voice engine",
    body: (model) => `${model} on the irodori-c engine, running on this machine's CPU with no Python or GPU.`,
    states: {
      ready: "Installed",
      installing: "Downloading…",
      not_installed: "Not downloaded",
      failed: "Failed",
      unsupported: "Not supported",
      checking: "Checking…",
    },
    downloadNote: (size) => `${size} download. Nothing is downloaded until you ask.`,
    diskNote: (needed, free) => `Needs ${needed} of disk · ${free} free.`,
    lowDisk: (needed, free) => `Not enough disk space: ${needed} needed, ${free} free.`,
    progress: (step, percent) => `${step} · ${percent}%`,
    steps: { engine: "Engine", assets: "Voice assets", model: "Model" },
    phases: { downloading: "Downloading", verifying: "Verifying checksum", extracting: "Unpacking" },
    reusedCache: "The model is reused from the Hugging Face cache, so it is not downloaded again.",
    configuredModel: "The model uses the file from tts.irodoriLocal.modelPath.",
    device: (int8) => (int8 ? "CPU int8 (AVX-512 VNNI)" : "CPU fp32"),
    install: "Download voice engine",
    resume: "Resume download",
    cancel: "Cancel",
    remove: "Remove",
    confirmRemove: "Remove it?",
    refresh: "Refresh",
    failedCheck: "Could not check the voice engine.",
    notInstalledHint: "Kana can speak once the voice engine is downloaded. Until then, replies still appear as text.",
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
};

const dictionaries: Record<UiLocale, Copy> = { id, en };

export function getCopy(locale: UiLocale): Copy {
  return dictionaries[locale];
}

export function isUiLocale(value: unknown): value is UiLocale {
  return value === "id" || value === "en";
}
