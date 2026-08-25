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
