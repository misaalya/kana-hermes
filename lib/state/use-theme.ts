"use client";

import { useEffect, useState } from "react";
import { useStore } from "zustand";
import { createThemeStore, type ThemeMode } from "@/lib/store/theme-store";

export type { ThemeMode };

/** Dark/light theme for one page; the choice persists per browser. */
export function useTheme(): { theme: ThemeMode; toggleTheme: () => void } {
  const [store] = useState(() => createThemeStore());
  const theme = useStore(store, (state) => state.theme);
  const toggleTheme = useStore(store, (state) => state.toggle);

  useEffect(() => {
    store.getState().hydrate();
  }, [store]);

  return { theme, toggleTheme };
}
