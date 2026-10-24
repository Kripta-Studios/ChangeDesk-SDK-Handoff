import React, { createContext, useContext, useMemo } from "react";
import { createChangeDeskClient, type ChangeDeskClient } from "./client.js";
import type { ChangeDeskConfig } from "./types.js";

type ResumeState = { requestId: string | undefined; planId: string | undefined; executionId: string | undefined };
type ContextValue = { config: ChangeDeskConfig; client: ChangeDeskClient; resume: ResumeState; remember: (next: Partial<ResumeState>) => void; forget: () => void };
const Context = createContext<ContextValue | undefined>(undefined);

const emptyResume = (): ResumeState => ({ requestId: undefined, planId: undefined, executionId: undefined });
function resumeStorage(config: ChangeDeskConfig) {
  const key = `changedesk:resume:${new URL(config.endpoint).origin}`;
  const read = (): ResumeState => {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(key) ?? "{}") as Partial<ResumeState>;
      const safe = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9._:-]{1,120}$/.test(value) ? value : undefined;
      return { requestId: safe(parsed.requestId), planId: safe(parsed.planId), executionId: safe(parsed.executionId) };
    } catch { return emptyResume(); }
  };
  const write = (value: ResumeState) => { try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* identifiers remain in memory */ } };
  const clear = () => { try { sessionStorage.removeItem(key); } catch { /* no persistent state available */ } };
  return { read, write, clear };
}

export function ChangeDeskProvider({ config, client, children }: { config: ChangeDeskConfig; client?: ChangeDeskClient; children: React.ReactNode }) {
  const storage = useMemo(() => resumeStorage(config), [config.endpoint]);
  const resume = React.useRef<ResumeState>();
  resume.current ??= storage.read();
  const value = useMemo<ContextValue>(() => ({ config, client: client ?? createChangeDeskClient(config), resume: resume.current!, remember: (next) => { Object.assign(resume.current!, next); storage.write(resume.current!); }, forget: () => { Object.assign(resume.current!, emptyResume()); storage.clear(); } }), [client, config, storage]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useChangeDesk(): ContextValue {
  const value = useContext(Context);
  if (!value) throw new Error("ChangeDeskProvider es obligatorio");
  return value;
}
