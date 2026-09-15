"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useStore } from "zustand";
import { createKanaWorkspace, type KanaWorkspace } from "@/lib/services/kana-workspace";
import type { KanaStores } from "@/lib/store/kana-stores";

const KanaWorkspaceContext = createContext<KanaWorkspace | null>(null);

/** Creates one workspace per mount; unmounting releases the Hermes client, audio, and avatar. */
export function KanaWorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspace] = useState(createKanaWorkspace);

  useEffect(() => {
    workspace.start();
    return () => workspace.dispose();
  }, [workspace]);

  return <KanaWorkspaceContext.Provider value={workspace}>{children}</KanaWorkspaceContext.Provider>;
}

export function useKanaWorkspace(): KanaWorkspace {
  const workspace = useContext(KanaWorkspaceContext);
  if (!workspace) throw new Error("useKanaWorkspace must be used inside KanaWorkspaceProvider.");
  return workspace;
}

type StoreState<Name extends keyof KanaStores> = ReturnType<KanaStores[Name]["getState"]>;

/**
 * Subscribe to one slice of one store. Components re-render only when the
 * selected value changes; wrap object selectors in useShallow.
 */
export function useKanaStore<Name extends keyof KanaStores, Selected>(
  name: Name,
  selector: (state: StoreState<Name>) => Selected,
): Selected {
  const store = useKanaWorkspace().stores[name] as unknown as Parameters<typeof useStore>[0];
  return useStore(store, selector as (state: unknown) => Selected);
}
