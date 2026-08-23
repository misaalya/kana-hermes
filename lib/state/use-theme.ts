"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

export type ThemeMode = "dark" | "light";

const STORAGE_KEY = "kana.theme";

// Dual-tone theme as an external store: the source of truth is the
// [data-theme] attribute on <html>, persisted per browser. Dark is default.
const listeners = new Set<() => void>();

function currentTheme(): ThemeMode {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function emitChange() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function persistTheme(mode: ThemeMode) {
  document.documentElement.dataset.theme = mode;
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Storage can be unavailable in hardened browsers; the session still works.
  }
}

function hydrateStoredTheme() {
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    stored = null;
  }
  const next: ThemeMode = stored === "light" ? "light" : "dark";
  if (currentTheme() !== next) {
    persistTheme(next);
    emitChange();
  }
}

export function useTheme(): { theme: ThemeMode; toggleTheme: () => void } {
  const theme = useSyncExternalStore(subscribe, currentTheme, () => "dark" as const);

  useEffect(() => {
    hydrateStoredTheme();
  }, []);

  const toggleTheme = useCallback(() => {
    persistTheme(currentTheme() === "dark" ? "light" : "dark");
    emitChange();
  }, []);

  return { theme, toggleTheme };
}
