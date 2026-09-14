"use client";

import { useEffect, useRef, useState } from "react";
import { getCopy, type UiLocale } from "@/lib/ui/copy";
import { isBraveBrowser } from "@/lib/voice/brave-browser";
import { MicrophoneIcon } from "./icons";

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type SpeechWindow = Window & {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};

export function ComposerDictation({ locale, disabled, onText, onActive, onNotice }: {
  locale: UiLocale;
  disabled: boolean;
  onText(text: string): void;
  onActive(active: boolean): void;
  onNotice(text: string): void;
}) {
  const copy = getCopy(locale);
  const text = copy.composer;
  const [active, setActive] = useState(false);
  const recognition = useRef<Recognition | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const callbacks = useRef({ onText, onActive, onNotice });
  useEffect(() => { callbacks.current = { onText, onActive, onNotice }; });

  const dispose = () => {
    const current = recognition.current;
    recognition.current = null;
    if (current) {
      current.onresult = current.onerror = current.onend = null;
      current.abort();
    }
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  useEffect(() => () => { dispose(); callbacks.current.onActive(false); }, []);
  useEffect(() => {
    if (disabled && recognition.current) {
      dispose();
      queueMicrotask(() => { setActive(false); callbacks.current.onActive(false); });
    }
  }, [disabled]);

  const toggle = async () => {
    if (recognition.current) {
      recognition.current.stop();
      timers.current.push(setTimeout(() => {
        if (!recognition.current) return;
        dispose();
        setActive(false);
        callbacks.current.onActive(false);
        callbacks.current.onNotice(text.dictationStopped);
      }, 5_000));
      return;
    }
    const target = window as SpeechWindow;
    const Constructor = target.SpeechRecognition ?? target.webkitSpeechRecognition;
    if (!window.isSecureContext || !Constructor) {
      onNotice(text.dictationUnsupported);
      return;
    }
    if (await isBraveBrowser()) {
      onNotice(text.dictationBrave);
      return;
    }
    if (recognition.current) return;
    const current = new Constructor();
    recognition.current = current;
    // Subtitles follow what the user writes, so dictation listens in the
    // interface language; the user can always type in another language.
    current.lang = copy.dateLocale;
    current.continuous = false;
    current.interimResults = true;
    let receivedText = false;
    let failed = false;
    current.onresult = (event) => {
      if (recognition.current !== current) return;
      let interim = "";
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const result = event.results[index];
        if (result.isFinal && result[0].transcript.trim()) {
          receivedText = true;
          callbacks.current.onText(result[0].transcript.trim());
        } else interim += result[0].transcript;
      }
      callbacks.current.onNotice(interim || text.listening);
    };
    current.onerror = ({ error }) => {
      if (recognition.current !== current) return;
      failed = true;
      const message = error === "not-allowed" || error === "service-not-allowed"
        ? text.dictationPermission
        : error === "network"
          ? text.dictationNetwork
          : error === "no-speech"
            ? text.noSpeech
            : text.dictationFailed(error);
      callbacks.current.onNotice(message);
      finish();
    };
    const finish = () => {
      if (recognition.current !== current) return;
      dispose();
      setActive(false);
      callbacks.current.onActive(false);
      if (!failed) callbacks.current.onNotice(receivedText
        ? text.dictationComplete
        : text.noSpeech);
    };
    current.onend = finish;
    try {
      current.start();
      setActive(true);
      onActive(true);
      onNotice(text.listeningOnline);
      timers.current.push(setTimeout(() => { current.stop(); }, 60_000));
      timers.current.push(setTimeout(finish, 65_000));
    } catch {
      failed = true;
      onNotice(text.microphoneFailed);
      finish();
    }
  };

  const label = active ? text.stopDictation : text.startDictation;
  return <button type="button" aria-label={label} title={label} aria-pressed={active} disabled={disabled}
    className={`kana-focus inline-flex size-10 shrink-0 items-center justify-center rounded-lg hover:bg-white/12 disabled:opacity-40 ${active ? "bg-red-500/35 animate-pulse" : ""}`}
    onClick={() => void toggle()}><MicrophoneIcon className="size-[18px]" /></button>;
}
