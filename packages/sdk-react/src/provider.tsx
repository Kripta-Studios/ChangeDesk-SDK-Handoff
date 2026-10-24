import React, { createContext, useContext, useMemo } from "react";
import { createChangeDeskClient, type ChangeDeskClient } from "./client.js";
import type { ChangeDeskConfig } from "./types.js";

type ResumeState = { requestId: string | undefined; planId: string | undefined; executionId: string | undefined };
type ContextValue = { config: ChangeDeskConfig; client: ChangeDeskClient; resume: ResumeState; remember: (next: Partial<ResumeState>) => void; forget: () => void };
const Context = createContext<ContextValue | undefined>(undefined);

export function ChangeDeskProvider({ config, client, children }: { config: ChangeDeskConfig; client?: ChangeDeskClient; children: React.ReactNode }) {
  const resume = React.useRef<ResumeState>({ requestId: undefined, planId: undefined, executionId: undefined });
  const value = useMemo<ContextValue>(() => ({ config, client: client ?? createChangeDeskClient(config), resume: resume.current, remember: (next) => Object.assign(resume.current, next), forget: () => { Object.assign(resume.current, { requestId: undefined, planId: undefined, executionId: undefined }); } }), [client, config]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useChangeDesk(): ContextValue {
  const value = useContext(Context);
  if (!value) throw new Error("ChangeDeskProvider es obligatorio");
  return value;
}
