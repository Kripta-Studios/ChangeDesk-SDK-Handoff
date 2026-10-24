import type { ApprovalRequestInput, RequestInput } from "@changedesk/contracts";
import type {
  EvidenceView,
  ExecutionCreated,
  ExecutionView,
  InstallationList,
  PlanCreated,
  PlanView,
  RequestCreated,
  RequestView,
  ResourceList,
} from "./types.js";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type Session = { accessToken: string; expiresAt: string };
type ClientOptions = { endpoint: string; getSession: () => Promise<Session>; fetch?: FetchLike; now?: () => number };

export class ChangeDeskApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly requestId: string,
    public readonly retryable: boolean,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ChangeDeskApiError";
  }
}

export interface ChangeDeskClient {
  createRequest(input: RequestInput, signal?: AbortSignal): Promise<RequestCreated>;
  getRequest(id: string, signal?: AbortSignal): Promise<RequestView>;
  sendMessage(requestId: string, input: { message: string; clientRequestId: string }, signal?: AbortSignal): Promise<RequestCreated>;
  selectCandidate(requestId: string, input: { candidateId: string; version: string; choice: "reuse" | "adapt" }, signal?: AbortSignal): Promise<RequestCreated>;
  createPlan(input: { requestId?: string; installationId?: string; selectedProductIds: readonly string[]; parameters: Readonly<Record<string, string>>; priorExecutionId?: string }, signal?: AbortSignal): Promise<PlanCreated>;
  getPlan(id: string, signal?: AbortSignal): Promise<PlanView>;
  approvePlan(input: ApprovalRequestInput, signal?: AbortSignal): Promise<{ approvalId: string }>;
  startExecution(input: { approvalId: string; idempotencyKey?: string }, signal?: AbortSignal): Promise<ExecutionCreated>;
  getExecution(id: string, signal?: AbortSignal): Promise<ExecutionView>;
  cancelExecution(id: string, signal?: AbortSignal): Promise<ExecutionView>;
  resumeExecution(id: string, signal?: AbortSignal): Promise<ExecutionView>;
  getInstallations(signal?: AbortSignal): Promise<InstallationList>;
  getResources(kind: "category" | "channel", signal?: AbortSignal): Promise<ResourceList>;
  installAction(input: { artifactHash: string; configuration: Readonly<Record<string, string>> }, signal?: AbortSignal): Promise<{ installationId: string }>;
  publishAction(input: { artifactHash: string; visibility: "provider_catalog" | "shared_allowlist"; consent: true; allowedTenantIds?: readonly string[] }, signal?: AbortSignal): Promise<{ publicationId: string }>;
  revokePublication(id: string, reason: string, signal?: AbortSignal): Promise<{ publicationId: string; status: string }>;
  getEvidence(id: string, signal?: AbortSignal): Promise<EvidenceView>;
  clearSession(): void;
}

function normalizeEndpoint(endpoint: string): string {
  const parsed = new URL(endpoint);
  const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && local)) throw new TypeError("Change Desk requiere HTTPS fuera de localhost");
  if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new TypeError("endpoint debe ser un origen fijo sin credenciales, query ni fragmento");
  return parsed.href.replace(/\/$/, "");
}

export function createChangeDeskClient(options: ClientOptions): ChangeDeskClient {
  const endpoint = normalizeEndpoint(options.endpoint);
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  const now = options.now ?? Date.now;
  let session: Session | undefined;
  let pendingSession: Promise<Session> | undefined;
  let sessionGeneration = 0;

  async function getAccessToken(): Promise<string> {
    if (session && Date.parse(session.expiresAt) - now() > 15_000) return session.accessToken;
    const generation = sessionGeneration;
    pendingSession ??= options.getSession().then((value) => {
      if (!value.accessToken || !Number.isFinite(Date.parse(value.expiresAt))) throw new TypeError("Sesión host inválida");
      if (generation !== sessionGeneration) throw new DOMException("Sesión descartada", "AbortError");
      session = value;
      return value;
    }).finally(() => { if (generation === sessionGeneration) pendingSession = undefined; });
    return (await pendingSession).accessToken;
  }

  async function request<T>(path: string, init: RequestInit = {}, idempotencyKey?: string): Promise<T> {
    const token = await getAccessToken();
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    };
    const response = await fetcher(`${endpoint}${path}`, { ...init, headers: { ...headers, ...init.headers }, cache: "no-store", credentials: "omit" });
    const payload = await response.json().catch(() => undefined) as { error?: { code?: string; message?: string; requestId?: string; retryable?: boolean; details?: unknown } } | undefined;
    if (!response.ok) {
      if (response.status === 401) session = undefined;
      const error = payload?.error;
      throw new ChangeDeskApiError(response.status, error?.code ?? "http_error", error?.message ?? "La solicitud no pudo completarse", error?.requestId ?? "unknown", error?.retryable ?? false, error?.details);
    }
    return payload as T;
  }

  const mutate = <T>(path: string, body: unknown, signal?: AbortSignal, suppliedKey?: string) => {
    const key = suppliedKey ?? crypto.randomUUID();
    return request<T>(path, { method: "POST", body: JSON.stringify(body), ...(signal ? { signal } : {}) }, key);
  };

  return {
    createRequest: (input, signal) => mutate("/v1/requests", input, signal, input.clientRequestId),
    getRequest: (id, signal) => request(`/v1/requests/${encodeURIComponent(id)}`, signal ? { signal } : {}),
    sendMessage: (id, input, signal) => mutate(`/v1/requests/${encodeURIComponent(id)}/messages`, input, signal, input.clientRequestId),
    selectCandidate: (id, input, signal) => mutate(`/v1/requests/${encodeURIComponent(id)}/candidate`, input, signal),
    createPlan: (input, signal) => mutate("/v1/plans", input, signal),
    getPlan: (id, signal) => request(`/v1/plans/${encodeURIComponent(id)}`, signal ? { signal } : {}),
    approvePlan: (input, signal) => mutate("/v1/approvals", input, signal, input.idempotencyKey),
    startExecution: (input, signal) => { const key = input.idempotencyKey ?? crypto.randomUUID(); return mutate("/v1/executions", { approvalId: input.approvalId, idempotencyKey: key }, signal, key); },
    getExecution: (id, signal) => request(`/v1/executions/${encodeURIComponent(id)}`, signal ? { signal } : {}),
    cancelExecution: (id, signal) => mutate(`/v1/executions/${encodeURIComponent(id)}/cancel`, {}, signal),
    resumeExecution: (id, signal) => mutate(`/v1/executions/${encodeURIComponent(id)}/resume`, {}, signal),
    getInstallations: (signal) => request("/v1/installations", signal ? { signal } : {}),
    getResources: (kind, signal) => request(`/v1/resources/${encodeURIComponent(kind)}`, signal ? { signal } : {}),
    installAction: (input, signal) => mutate("/v1/installations", input, signal),
    publishAction: (input, signal) => mutate("/v1/publications", input, signal),
    revokePublication: (id, reason, signal) => mutate(`/v1/publications/${encodeURIComponent(id)}/revoke`, { reason }, signal),
    getEvidence: (id, signal) => request(`/v1/evidence/${encodeURIComponent(id)}`, signal ? { signal } : {}),
    clearSession: () => { sessionGeneration += 1; session = undefined; pendingSession = undefined; },
  };
}
