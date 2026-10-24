import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { StorefrontOverrides, StorefrontPreferencesResponse, StorefrontValues } from "@changedesk/contracts";
import type { StorefrontClient } from "./client.js";

export interface StorefrontContextValue {
  readonly client: StorefrontClient;
  readonly preferences: StorefrontPreferencesResponse | null;
  readonly draft: StorefrontOverrides;
  readonly preview: StorefrontValues;
  readonly loading: boolean;
  readonly error: Error | null;
  setDraft(next: StorefrontOverrides): void;
  refresh(): Promise<void>;
  accept(response: StorefrontPreferencesResponse): void;
}

const defaults: StorefrontValues = { theme: "system", density: "comfortable", productLayout: "grid" };
const Context = createContext<StorefrontContextValue | null>(null);

export function StorefrontProvider({ client, sessionKey = "default", children }: { client: StorefrontClient; sessionKey?: string; children: React.ReactNode }) {
  const [preferences, setPreferences] = useState<StorefrontPreferencesResponse | null>(null);
  const [draft, setDraft] = useState<StorefrontOverrides>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const stateEpoch = useRef(0);

  const load = useCallback(async (signal?: AbortSignal) => {
    const expectedEpoch = stateEpoch.current;
    setLoading(true); setError(null);
    try {
      const response = await client.getPreferences(signal);
      if (signal?.aborted || expectedEpoch !== stateEpoch.current) return;
      setPreferences(response); setDraft(response.overrides);
    } catch (cause) {
      if ((cause as { name?: string }).name !== "AbortError") setError(cause instanceof Error ? cause : new Error("No se pudieron cargar las preferencias"));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    const controller = new AbortController();
    const unsubscribe = client.subscribeSessionInvalidation(() => {
      stateEpoch.current += 1;
      controller.abort();
      setPreferences(null); setDraft({}); setError(null); setLoading(false);
    });
    setPreferences(null); setDraft({});
    void load(controller.signal);
    return () => { unsubscribe(); controller.abort(); client.clearSession(); };
  }, [client, sessionKey, load]);

  const accept = useCallback((response: StorefrontPreferencesResponse) => { setPreferences(response); setDraft(response.overrides); setError(null); }, []);
  const preview = useMemo<StorefrontValues>(() => {
    const inherited = preferences?.inherited ?? defaults;
    return { theme: draft.theme ?? inherited.theme, density: draft.density ?? inherited.density, productLayout: draft.productLayout ?? inherited.productLayout };
  }, [draft, preferences]);
  const value = useMemo<StorefrontContextValue>(() => ({ client, preferences, draft, preview, loading, error, setDraft, refresh: () => load(), accept }), [accept, client, draft, error, load, loading, preferences, preview]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useStorefront(): StorefrontContextValue {
  const value = useContext(Context);
  if (!value) throw new Error("StorefrontProvider es obligatorio");
  return value;
}
