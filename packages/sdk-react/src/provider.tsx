import React, { createContext, useContext, useMemo } from "react";
import { createChangeDeskClient, type ChangeDeskClient } from "./client.js";
import type { ChangeDeskConfig } from "./types.js";

type ResumeState = { requestId: string | undefined; planId: string | undefined; executionId: string | undefined };
type ContextValue = { config: ChangeDeskConfig; client: ChangeDeskClient; resume: ResumeState; bindScope: (scopeId: string | undefined) => ResumeState; remember: (next: Partial<ResumeState>) => void; forget: () => void };
const Context = createContext<ContextValue | undefined>(undefined);

const emptyResume = (): ResumeState => ({ requestId: undefined, planId: undefined, executionId: undefined });
function resumeStorage(config: ChangeDeskConfig) {
  const prefix = `changedesk:resume:${new URL(config.endpoint).origin}`;
  const activeKey = `${prefix}:active`;
  const safeScope = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9._:-]{1,120}$/.test(value);
  const read = (scopeId: string): ResumeState => {
    try {
      const priorScope = sessionStorage.getItem(activeKey);
      if (safeScope(priorScope) && priorScope !== scopeId) sessionStorage.removeItem(`${prefix}:${priorScope}`);
      sessionStorage.removeItem(prefix); // discard the pre-scoped format
      sessionStorage.setItem(activeKey, scopeId);
      const parsed = JSON.parse(sessionStorage.getItem(`${prefix}:${scopeId}`) ?? "{}") as Partial<ResumeState>;
      const safe = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9._:-]{1,120}$/.test(value) ? value : undefined;
      return { requestId: safe(parsed.requestId), planId: safe(parsed.planId), executionId: safe(parsed.executionId) };
    } catch { return emptyResume(); }
  };
  const write = (scopeId: string, value: ResumeState) => { try { sessionStorage.setItem(activeKey, scopeId); sessionStorage.setItem(`${prefix}:${scopeId}`, JSON.stringify(value)); } catch { /* identifiers remain in memory */ } };
  const clear = () => { try { const activeScope = sessionStorage.getItem(activeKey); if (safeScope(activeScope)) sessionStorage.removeItem(`${prefix}:${activeScope}`); sessionStorage.removeItem(activeKey); sessionStorage.removeItem(prefix); } catch { /* no persistent state available */ } };
  return { read, write, clear };
}

export function ChangeDeskProvider({ config, client, children }: { config: ChangeDeskConfig; client?: ChangeDeskClient; children: React.ReactNode }) {
  const storage = useMemo(() => resumeStorage(config), [config.endpoint]);
  const resume = React.useRef<ResumeState>(emptyResume());
  const scope = React.useRef<string>();
  const value = useMemo<ContextValue>(() => ({ config, client: client ?? createChangeDeskClient(config), resume: resume.current, bindScope: (scopeId) => {
    if (!scopeId || !/^[A-Za-z0-9._:-]{1,120}$/.test(scopeId)) { scope.current = undefined; Object.assign(resume.current, emptyResume()); storage.clear(); return resume.current; }
    if (scope.current !== scopeId) { scope.current = scopeId; Object.assign(resume.current, storage.read(scopeId)); }
    return resume.current;
  }, remember: (next) => { Object.assign(resume.current, next); if (scope.current) storage.write(scope.current, resume.current); }, forget: () => { scope.current = undefined; Object.assign(resume.current, emptyResume()); storage.clear(); } }), [client, config, storage]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useChangeDesk(): ContextValue {
  const value = useContext(Context);
  if (!value) throw new Error("ChangeDeskProvider es obligatorio");
  return value;
}
