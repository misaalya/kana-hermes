"use client";

import { useState } from "react";
import { useDialogFocus } from "@/lib/accessibility/use-dialog-focus";
import { OFFICIAL_LIVE2D_SAMPLES } from "@/lib/avatar/defaults";
import type { KanaPreferences } from "@/lib/preferences/types";
import type { SubtitleLanguage } from "@/lib/presentation/types";
import type { UiLocale } from "@/lib/ui/copy";
import { SubtitleLanguagePicker } from "./subtitle-language-picker";
import { btnGhost, btnPrimary, btnSecondary, sectionEyebrow } from "./ui";

export type DependencyFindings = {
  hermes: "running" | "installed" | "missing";
  voice: "ok" | "loading" | "stopped" | "error" | "off" | null;
};

type OnboardingDialogProps = {
  locale: UiLocale;
  preferences: KanaPreferences;
  deps: DependencyFindings;
  mode: "full" | "repair";
  onComplete(preferences: KanaPreferences): Promise<void>;
  onDismiss(): void;
  onOpenSettings(): void;
};

function Toggle({ checked, onChange }: { checked: boolean; onChange(): void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label="Kana voice"
      onClick={onChange}
      className={`kana-focus relative h-7 w-12 rounded-sm border transition-colors ${
        checked ? "border-accent bg-accent" : "border-line-strong bg-surface-strong"
      }`}
    >
      <span className={`absolute top-1 size-[18px] rounded-[2px] bg-on-accent transition-transform ${checked ? "translate-x-[25px]" : "translate-x-1"}`} />
    </button>
  );
}

function StatusRow({ title, body, healthy }: {
  title: string;
  body: string;
  healthy: boolean;
}) {
  return (
    <div className={`border bg-surface-strong p-4 ${healthy ? "border-accent/35" : "border-danger/40"}`}>
      <div className="min-w-0">
        <p className="text-xs font-bold text-ink">{title}</p>
        <p className="mt-1 text-[11px] leading-relaxed text-muted">{body}</p>
      </div>
    </div>
  );
}

export function OnboardingWizard({
  preferences,
  deps,
  mode,
  onComplete,
  onDismiss,
  onOpenSettings,
}: OnboardingDialogProps) {
  const steps = mode === "full" ? ([0, 1, 2, 3] as const) : ([3] as const);
  const [stepIndex, setStepIndex] = useState(0);
  const [draft, setDraft] = useState(preferences);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const { dialogRef, onDialogKeyDown } = useDialogFocus();
  const step = steps[stepIndex];
  const isId = draft.uiLocale === "id";
  const hermesHealthy = deps.hermes !== "missing";
  const voiceHealthy = !draft.voiceEnabled || deps.voice === "ok" || deps.voice === "loading" || deps.voice === "stopped";

  const finish = async () => {
    setSaving(true);
    setNotice(null);
    try {
      await onComplete({ ...draft, onboardingCompleted: true });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save setup.");
      setSaving(false);
    }
  };

  const selectAvatar = (index: number) => {
    const sample = OFFICIAL_LIVE2D_SAMPLES[index];
    if (!sample) return;
    setDraft((current) => ({
      ...current,
      live2d: {
        ...current.live2d,
        modelUrl: sample.modelUrl,
        modelId: undefined,
        modelName: sample.name,
      },
    }));
  };

  const goNext = () => {
    if (stepIndex === steps.length - 1) {
      if (mode === "full") void finish();
      else onDismiss();
      return;
    }
    setNotice(null);
    setStepIndex((current) => current + 1);
  };

  return (
    <div className="fixed inset-0 z-40 grid place-items-center overflow-y-auto bg-bg p-3 sm:p-6">
      <section
        className="relative grid max-h-[min(760px,94dvh)] w-[min(880px,100%)] grid-cols-[minmax(0,1.1fr)_minmax(280px,.9fr)] overflow-hidden rounded-2xl border border-line bg-raised max-md:grid-cols-1 max-md:rounded-none"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        onKeyDown={onDialogKeyDown}
      >
        <div className="kana-stage-pattern relative min-h-[280px] overflow-hidden border-r border-line bg-surface max-md:hidden">
          <div className="absolute inset-x-8 bottom-10 border border-line bg-raised p-6">
            <p className={sectionEyebrow}>Kana</p>
            <p className="mt-1 text-xl font-bold text-ink">{isId ? "Waifu agent yang terasa milikmu." : "An agent companion that feels like yours."}</p>
            <p className="mt-2 text-[11px] leading-relaxed text-muted">
              {isId ? "Hermes tetap menjadi otaknya. Kana membuat percakapan, avatar, dan suara terasa natural." : "Hermes stays the brain. Kana makes the conversation, avatar, and voice feel natural."}
            </p>
          </div>
        </div>

        <div className="flex min-h-0 flex-col bg-raised">
          <header className="flex items-center justify-between border-b border-line px-5 py-4">
            <div className="flex items-center gap-2">
              {steps.map((item, index) => (
                <span key={item} className={`h-1.5 transition-all ${index === stepIndex ? "w-7 bg-accent" : index < stepIndex ? "w-3 bg-accent/45" : "w-3 bg-line-strong"}`} />
              ))}
            </div>
            <span className="text-[10px] font-semibold text-faint">
              {mode === "repair" ? (isId ? "Pemeriksaan" : "Checkup") : `${stepIndex + 1} / ${steps.length}`}
            </span>
          </header>

          <main className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-7">
            {step === 0 ? (
              <div className="flex min-h-full flex-col justify-center">
                <p className={sectionEyebrow}>{isId ? "Selamat datang" : "Welcome"}</p>
                <h1 id="onboarding-title" className="mt-2 text-2xl font-bold tracking-tight text-ink">{isId ? "Kenalan dulu dengan Kana" : "Meet Kana"}</h1>
                <p className="mt-3 text-xs leading-6 text-muted">
                  {isId ? "Atur hal yang terasa personal saja. Detail teknis bisa Kana tangani sendiri dan selalu bisa diubah nanti." : "Choose only what feels personal. Kana handles the technical details, and everything can be changed later."}
                </p>
                <div className="mt-6 rounded-2xl border border-accent/15 bg-accent/8 p-4">
                  <p className="text-[11px] font-bold text-ink">Hermes → Kana → You</p>
                  <p className="mt-1 text-[10px] leading-relaxed text-muted">{isId ? "Satu agent yang sama, dengan pengalaman yang lebih hangat." : "The same agent, with a warmer experience."}</p>
                </div>
              </div>
            ) : null}

            {step === 1 ? (
              <div>
                <p className={sectionEyebrow}>{isId ? "Bahasa" : "Language"}</p>
                <h1 id="onboarding-title" className="mt-2 text-xl font-bold text-ink">{isId ? "Buat percakapan terasa nyaman" : "Make conversation feel comfortable"}</h1>
                <p className="mt-2 text-[11px] leading-relaxed text-muted">{isId ? "Kana selalu berbicara dalam bahasa Jepang. Kamu memilih bahasa tulisan untuk balasan baru." : "Kana always speaks Japanese. You choose the written language for new replies."}</p>
                <div className="mt-6 space-y-5">
                  <div>
                    <p className="mb-2 text-[10px] font-bold tracking-wide text-muted uppercase">Interface</p>
                    <div className="grid grid-cols-2 gap-2">
                      {([['id', 'Bahasa Indonesia'], ['en', 'English']] as const).map(([value, label]) => (
                        <button key={value} type="button" className={`kana-focus rounded-xl border px-3 py-3 text-left text-xs font-bold ${draft.uiLocale === value ? "border-accent/45 bg-accent/12 text-accent-strong" : "border-line bg-surface-strong text-ink-dim"}`} onClick={() => setDraft((current) => ({ ...current, uiLocale: value }))}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="mb-2 text-[10px] font-bold tracking-wide text-muted uppercase">Subtitle</p>
                    <SubtitleLanguagePicker value={draft.subtitleLanguage} onChange={(subtitleLanguage: SubtitleLanguage) => setDraft((current) => ({ ...current, subtitleLanguage }))} />
                  </div>
                </div>
              </div>
            ) : null}

            {step === 2 ? (
              <div>
                <p className={sectionEyebrow}>{isId ? "Karakter" : "Character"}</p>
                <h1 id="onboarding-title" className="mt-2 text-xl font-bold text-ink">{isId ? "Pilih tampilan dan suara" : "Choose a look and voice"}</h1>
                <p className="mt-2 text-[11px] leading-relaxed text-muted">{isId ? "Mulai dengan pilihan bawaan. Avatar Live2D dan sampel suaramu sendiri bisa ditambahkan dari Settings." : "Start with a default. Your own Live2D avatar and voice sample can be added from Settings."}</p>
                <div className="mt-5 grid gap-2 sm:grid-cols-2">
                  {OFFICIAL_LIVE2D_SAMPLES.map((sample, index) => {
                    const active = !draft.live2d.modelId && draft.live2d.modelUrl === sample.modelUrl;
                    return (
                      <button type="button" key={sample.id} onClick={() => selectAvatar(index)} className={`kana-focus flex items-center gap-3 border p-3 text-left ${active ? "border-accent/45 bg-accent/12" : "border-line bg-surface-strong"}`}>
                        <span>
                          <span className="block text-xs font-bold text-ink">{sample.name}</span>
                          <span className="mt-0.5 block text-[9px] text-muted">{active ? (isId ? "Dipilih" : "Selected") : "Live2D"}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-4 flex items-center justify-between gap-4 border border-line bg-surface-strong p-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <div>
                      <p className="text-xs font-bold text-ink">{isId ? "Suara Kana" : "Kana's voice"}</p>
                      <p className="mt-0.5 text-[10px] text-muted">{draft.voiceEnabled ? (isId ? "Aktif" : "On") : (isId ? "Nonaktif" : "Off")}</p>
                    </div>
                  </div>
                  <Toggle checked={draft.voiceEnabled} onChange={() => setDraft((current) => ({ ...current, voiceEnabled: !current.voiceEnabled }))} />
                </div>
              </div>
            ) : null}

            {step === 3 ? (
              <div>
                <p className={sectionEyebrow}>{mode === "repair" ? (isId ? "Pemeriksaan" : "Checkup") : (isId ? "Hampir selesai" : "Almost there")}</p>
                <h1 id="onboarding-title" className="mt-2 text-xl font-bold text-ink">{mode === "repair" ? (isId ? "Kana butuh sedikit bantuan" : "Kana needs a little help") : (isId ? "Kana siap menemanimu" : "Kana is ready for you")}</h1>
                <p className="mt-2 text-[11px] leading-relaxed text-muted">{isId ? "Kami memeriksa dua layanan lokal yang membuat Kana bekerja." : "We checked the two local services that make Kana work."}</p>
                <div className="mt-5 space-y-2">
                  <StatusRow title="Hermes" healthy={hermesHealthy} body={deps.hermes === "running" ? (isId ? "Terhubung dan siap." : "Connected and ready.") : deps.hermes === "installed" ? (isId ? "Terpasang; Kana akan menyalakannya saat dibutuhkan." : "Installed; Kana will start it when needed.") : (isId ? "Hermes belum ditemukan di perangkat ini." : "Hermes was not found on this device.")} />
                  <StatusRow title={isId ? "Mesin suara" : "Voice engine"} healthy={voiceHealthy} body={!draft.voiceEnabled ? (isId ? "Tidak diperlukan karena suara dimatikan." : "Not needed while voice is off.") : deps.voice === "ok" ? (isId ? "Siap berbicara." : "Ready to speak.") : deps.voice === "error" ? (isId ? "Perlu diperiksa dari Settings." : "Needs attention in Settings.") : (isId ? "Akan disiapkan saat pertama digunakan." : "Will be prepared on first use.")} />
                </div>
                {!hermesHealthy || !voiceHealthy ? <button type="button" className={`${btnSecondary} mt-4`} onClick={onOpenSettings}>{isId ? "Buka pengaturan koneksi" : "Open connection settings"}</button> : null}
              </div>
            ) : null}

            {notice ? <p className="mt-4 rounded-xl border border-danger/25 bg-danger/8 px-3 py-2 text-[11px] text-danger" role="status">{notice}</p> : null}
          </main>

          <footer className="flex items-center justify-between border-t border-line px-5 py-4">
            {stepIndex > 0 ? (
              <button type="button" className={btnGhost} disabled={saving} onClick={() => setStepIndex((current) => Math.max(0, current - 1))}>{isId ? "Kembali" : "Back"}</button>
            ) : mode === "repair" ? (
              <button type="button" className={btnGhost} onClick={onDismiss}>{isId ? "Nanti" : "Later"}</button>
            ) : <span />}
            <button type="button" className={btnPrimary} disabled={saving} onClick={goNext}>
              {saving ? (isId ? "Menyimpan…" : "Saving…") : stepIndex === steps.length - 1 ? (mode === "repair" ? (isId ? "Selesai" : "Done") : (isId ? "Mulai" : "Start")) : (isId ? "Lanjut" : "Continue")}
            </button>
          </footer>
        </div>
      </section>
    </div>
  );
}
