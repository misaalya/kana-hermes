import { useState } from "react";
import { SUPPORTED_SUBTITLE_LANGUAGES } from "@/lib/presentation/languages";
import type { KanaPreferences } from "@/lib/preferences/types";
import { useDialogFocus } from "@/lib/accessibility/use-dialog-focus";

type OnboardingDialogProps = {
  preferences: KanaPreferences;
  onTestAgent(preferences: KanaPreferences): Promise<string>;
  onComplete(preferences: KanaPreferences): Promise<void>;
};

const STEPS = ["Welcome", "Agent", "Presentation", "Ready"] as const;

export function OnboardingDialog({
  preferences,
  onTestAgent,
  onComplete,
}: OnboardingDialogProps) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState(preferences);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const { dialogRef, onDialogKeyDown } = useDialogFocus();

  const finish = async (next: KanaPreferences) => {
    setSaving(true);
    setNotice(null);
    try {
      await onComplete({ ...next, onboardingCompleted: true });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save setup.");
      setSaving(false);
    }
  };

  return (
    <div className="onboarding-backdrop">
      <section
        className="onboarding-dialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        onKeyDown={onDialogKeyDown}
      >
        <div className="onboarding-progress" aria-label="Setup progress">
          {STEPS.map((label, index) => (
            <span
              className={index === step ? "active" : index < step ? "done" : ""}
              key={label}
            >
              {index + 1}<small>{label}</small>
            </span>
          ))}
        </div>

        <div className="onboarding-content">
          {step === 0 ? (
            <div className="onboarding-copy">
              <div className="kana-mark">か</div>
              <p className="eyebrow">Local presentation layer</p>
              <h1 id="onboarding-title">Welcome to Kana</h1>
              <p>
                Kana gives your existing Hermes Agent a visual conversation,
                Japanese voice, subtitles, and a replaceable avatar. Hermes
                remains the only agent and keeps ownership of tools, memory,
                sessions, and reasoning.
              </p>
              <div className="onboarding-boundary">
                <span>Kana Web UI</span><b>→</b><span>Your Hermes</span>
              </div>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="onboarding-copy">
              <p className="eyebrow">Step 2</p>
              <h1 id="onboarding-title">Choose the agent connection</h1>
              <p>
                Kana connects to a separately running, unmodified <code>hermes serve</code>.
                The npm launcher can start it for you from Settings after setup.
              </p>
              {draft.agentMode === "hermes" ? (
                <div className="onboarding-fields">
                  <label>
                    WebSocket URL
                    <input
                      value={draft.hermes.websocketUrl}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          hermes: {
                            ...draft.hermes,
                            websocketUrl: event.target.value,
                          },
                        })
                      }
                    />
                  </label>
                  <label>
                    Session token
                    <input
                      type="password"
                      autoComplete="off"
                      value={draft.hermes.token}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          hermes: { ...draft.hermes, token: event.target.value },
                        })
                      }
                    />
                    <small>Kept only in this browser tab.</small>
                  </label>
                </div>
              ) : null}
              <button
                type="button"
                className="secondary-button onboarding-test"
                disabled={testing}
                onClick={() => {
                  setTesting(true);
                  setNotice(null);
                  void onTestAgent(draft)
                    .then(setNotice)
                    .catch((error) =>
                      setNotice(
                        error instanceof Error
                          ? error.message
                          : "The agent connection test failed.",
                      ),
                    )
                    .finally(() => setTesting(false));
                }}
              >
                {testing ? "Testing…" : "Test connection"}
              </button>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="onboarding-copy">
              <p className="eyebrow">Step 3</p>
              <h1 id="onboarding-title">Choose how Kana is presented</h1>
              <div className="onboarding-fields two-column">
                <label>
                  Subtitle language
                  <select
                    value={draft.subtitleLanguage}
                    onChange={(event) =>
                      setDraft({ ...draft, subtitleLanguage: event.target.value })
                    }
                  >
                    {SUPPORTED_SUBTITLE_LANGUAGES.map((language) => (
                      <option key={language.code} value={language.code}>
                        {language.nativeLabel}
                      </option>
                    ))}
                  </select>
                  <small>Future replies only. Old subtitles never change.</small>
                </label>
                <label>
                  Japanese voice
                  <select
                    value={draft.voiceMode}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        voiceMode: event.target.value as KanaPreferences["voiceMode"],
                      })
                    }
                  >
                    <option value="qwen3">Local Qwen3-TTS</option>
                  </select>
                  <small>Qwen runs as a separate local service.</small>
                </label>
                <label>
                  Avatar
                  <select
                    value={draft.avatarMode}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        avatarMode: event.target.value as KanaPreferences["avatarMode"],
                      })
                    }
                  >
                    <option value="live2d">Official Live2D sample</option>
                  </select>
                  <small>You can import another Cubism model later.</small>
                </label>
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="onboarding-copy">
              <p className="eyebrow">Setup summary</p>
              <h1 id="onboarding-title">Kana is ready</h1>
              <dl className="onboarding-summary">
                <div><dt>Agent</dt><dd>{draft.agentMode}</dd></div>
                <div><dt>Subtitles</dt><dd>{draft.subtitleLanguage}</dd></div>
                <div><dt>Voice</dt><dd>{draft.voiceMode}</dd></div>
                <div><dt>Avatar</dt><dd>{draft.avatarMode}</dd></div>
              </dl>
              <p>
                You can change every presentation setting later. Kana never
                patches Hermes and does not add another model for translation.
              </p>
            </div>
          ) : null}

          {notice ? <p className="onboarding-notice" role="status">{notice}</p> : null}
        </div>

        <div className="onboarding-actions">
          {step > 0 ? (
            <button
              className="secondary-button"
              type="button"
              disabled={saving}
              onClick={() => {
                setNotice(null);
                setStep((current) => Math.max(0, current - 1));
              }}
            >
              Back
            </button>
          ) : <span />}
          <button
            className="primary-button"
            type="button"
            disabled={saving}
            onClick={() =>
              step === STEPS.length - 1
                ? void finish(draft)
                : (setNotice(null), setStep((current) => current + 1))
            }
          >
            {saving
              ? "Saving…"
              : step === STEPS.length - 1
                ? "Enter Kana"
                : "Continue"}
          </button>
        </div>
      </section>
    </div>
  );
}
