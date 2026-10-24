import React, { createContext, useContext, useMemo } from "react";
import { createChangeDeskClient, type ChangeDeskClient } from "./client.js";
import type { ChangeDeskConfig } from "./types.js";

type ContextValue = { config: ChangeDeskConfig; client: ChangeDeskClient };
const Context = createContext<ContextValue | undefined>(undefined);

export function ChangeDeskProvider({ config, client, children }: { config: ChangeDeskConfig; client?: ChangeDeskClient; children: React.ReactNode }) {
  const value = useMemo<ContextValue>(() => ({ config, client: client ?? createChangeDeskClient(config) }), [client, config]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useChangeDesk(): ContextValue {
  const value = useContext(Context);
  if (!value) throw new Error("ChangeDeskProvider es obligatorio");
  return value;
}
