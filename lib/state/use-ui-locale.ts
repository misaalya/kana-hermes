"use client";

import { useEffect, useState } from "react";
import { useStore } from "zustand";
import {
  createUiLocaleStore,
  type UiLocaleStore,
} from "@/lib/store/ui-locale-store";
import type { UiLocale } from "@/lib/ui/copy";

/**
 * The stored interface locale for a page that renders outside the workspace:
 * the two fatal error pages. The store is created per mount, as the theme's is,
 * so no page shares another page's reading.
 */
export function useUiLocale(): UiLocale {
  const [store] = useState<UiLocaleStore>(() => createUiLocaleStore());
  const locale = useStore(store, (state) => state.locale);

  useEffect(() => {
    store.getState().hydrate();
  }, [store]);

  return locale;
}
