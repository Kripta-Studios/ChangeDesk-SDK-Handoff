import type {
  CreateStorefrontProposalInput,
  ReplaceStorefrontPreferencesInput,
  StorefrontAdminProposalPreview,
  StorefrontPreferencesResponse,
  StorefrontProposalView,
  StorefrontValues,
} from "@changedesk/contracts";

export type StorefrontSession = { accessToken: string; expiresAt: string };
export type StorefrontClientOptions = { endpoint: string; getSession: () => Promise<StorefrontSession>; fetch?: typeof fetch; now?: () => number };

export interface StorefrontClient {
  getPreferences(signal?: AbortSignal): Promise<StorefrontPreferencesResponse>;
  replacePreferences(input: ReplaceStorefrontPreferencesInput, signal?: AbortSignal): Promise<StorefrontPreferencesResponse>;
  createGlobalProposal(input: CreateStorefrontProposalInput, signal?: AbortSignal): Promise<StorefrontProposalView>;
  getOwnProposal(id: string, signal?: AbortSignal): Promise<StorefrontProposalView>;
  clearSession(): void;
}

export interface StorefrontAdminClient {
  listProposals(signal?: AbortSignal): Promise<{ proposals: readonly StorefrontAdminProposalPreview[] }>;
  getProposal(id: string, signal?: AbortSignal): Promise<StorefrontAdminProposalPreview>;
  approveProposal(id: string, expectedProposalRevision: number, expectedGlobalRevision: number, signal?: AbortSignal): Promise<StorefrontAdminProposalPreview>;
  rejectProposal(id: string, expectedProposalRevision: number, signal?: AbortSignal): Promise<StorefrontAdminProposalPreview>;
  clearSession(): void;
}

export class StorefrontApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly requestId = "unknown",
    public readonly retryable = false,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "StorefrontApiError";
  }
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type Parser<T> = (value: unknown) => T;
type JsonObject = Record<string, unknown>;
const themes = ["light", "dark", "system"] as const;
const densities = ["comfortable", "compact"] as const;
const layouts = ["grid", "list"] as const;
const statuses = ["pending", "approved", "rejected"] as const;

function normalizeEndpoint(endpoint: string): string {
  const parsed = new URL(endpoint);
  const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && local)) throw new TypeError("Change Desk storefront requiere HTTPS fuera de localhost");
  if (parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname !== "/" && parsed.pathname !== "")) throw new TypeError("endpoint debe ser un origen fijo sin ruta, credenciales, query ni fragmento");
  return parsed.origin;
}

function object(value: unknown, keys: readonly string[], label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`Respuesta ${label} inválida`);
  const record = value as JsonObject;
  if (Object.keys(record).some((key) => !keys.includes(key))) throw new TypeError(`Respuesta ${label} inválida: campos desconocidos`);
  return record;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new TypeError(`Respuesta ${label} inválida`);
  return value as T;
}

function integer(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new TypeError(`Respuesta ${label} inválida`);
  return value as number;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`Respuesta ${label} inválida`);
  return value;
}

function values(value: unknown, label: string): StorefrontValues {
  const record = object(value, ["theme", "density", "productLayout"], label);
  return { theme: oneOf(record.theme, themes, label), density: oneOf(record.density, densities, label), productLayout: oneOf(record.productLayout, layouts, label) };
}

function overrides(value: unknown, label: string): StorefrontPreferencesResponse["overrides"] {
  const record = object(value, ["theme", "density", "productLayout"], label);
  return {
    ...(record.theme === undefined ? {} : { theme: oneOf(record.theme, themes, label) }),
    ...(record.density === undefined ? {} : { density: oneOf(record.density, densities, label) }),
    ...(record.productLayout === undefined ? {} : { productLayout: oneOf(record.productLayout, layouts, label) }),
  };
}

const parsePreferences: Parser<StorefrontPreferencesResponse> = (value) => {
  const record = object(value, ["overrides", "effective", "buyerRevision", "globalRevision"], "de preferencias");
  return { overrides: overrides(record.overrides, "de preferencias"), effective: values(record.effective, "de preferencias"), buyerRevision: integer(record.buyerRevision, "de preferencias"), globalRevision: integer(record.globalRevision, "de preferencias") };
};

const parseProposal: Parser<StorefrontProposalView> = (value) => {
  const record = object(value, ["id", "baseGlobalRevision", "proposed", "status", "proposalRevision", "createdAt", "decidedAt"], "de propuesta");
  return {
    id: requiredString(record.id, "de propuesta"), baseGlobalRevision: integer(record.baseGlobalRevision, "de propuesta"), proposed: values(record.proposed, "de propuesta"),
    status: oneOf(record.status, statuses, "de propuesta"), proposalRevision: integer(record.proposalRevision, "de propuesta"), createdAt: requiredString(record.createdAt, "de propuesta"),
    ...(record.decidedAt === undefined ? {} : { decidedAt: requiredString(record.decidedAt, "de propuesta") }),
  };
};

const parseAdminPreview: Parser<StorefrontAdminProposalPreview> = (value) => {
  const record = object(value, ["proposalId", "proposalRevision", "current", "proposed", "globalRevision", "precedenceNotice", "status"], "de preview administrativo");
  return {
    proposalId: requiredString(record.proposalId, "de preview administrativo"), proposalRevision: integer(record.proposalRevision, "de preview administrativo"), current: values(record.current, "de preview administrativo"),
    proposed: values(record.proposed, "de preview administrativo"), globalRevision: integer(record.globalRevision, "de preview administrativo"), precedenceNotice: requiredString(record.precedenceNotice, "de preview administrativo"), status: oneOf(record.status, statuses, "de preview administrativo"),
  };
};

function abortError(): DOMException { return new DOMException("La sesión storefront cambió", "AbortError"); }

function createTransport(options: StorefrontClientOptions) {
  const endpoint = normalizeEndpoint(options.endpoint);
  const fetcher: FetchLike = options.fetch ?? globalThis.fetch.bind(globalThis);
  const now = options.now ?? Date.now;
  let session: StorefrontSession | undefined;
  let pendingSession: Promise<StorefrontSession> | undefined;
  let generation = 0;
  const active = new Set<AbortController>();

  async function token(expectedGeneration: number): Promise<string> {
    if (session && Date.parse(session.expiresAt) - now() > 15_000) return session.accessToken;
    pendingSession ??= options.getSession().then((value) => {
      if (!value.accessToken || !Number.isFinite(Date.parse(value.expiresAt))) throw new TypeError("Sesión storefront inválida");
      if (expectedGeneration !== generation) throw abortError();
      session = value;
      return value;
    }).finally(() => { pendingSession = undefined; });
    const result = await pendingSession;
    if (expectedGeneration !== generation) throw abortError();
    return result.accessToken;
  }

  async function request<T>(path: string, parser: Parser<T>, init: RequestInit = {}, idempotencyKey?: string): Promise<T> {
    const expectedGeneration = generation;
    const accessToken = await token(expectedGeneration);
    if (expectedGeneration !== generation) throw abortError();
    const controller = new AbortController();
    active.add(controller);
    const external = init.signal;
    const abort = () => controller.abort(external?.reason);
    if (external?.aborted) abort(); else external?.addEventListener("abort", abort, { once: true });
    try {
      const response = await fetcher(`${endpoint}${path}`, {
        ...init, signal: controller.signal, cache: "no-store", credentials: "omit",
        headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}`, ...(init.body ? { "Content-Type": "application/json" } : {}), ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}), ...init.headers },
      });
      const payload = await response.json().catch(() => undefined) as unknown;
      if (expectedGeneration !== generation) throw abortError();
      if (!response.ok) {
        if (response.status === 401) session = undefined;
        const wrapper = payload && typeof payload === "object" ? (payload as JsonObject).error : undefined;
        const error = wrapper && typeof wrapper === "object" ? wrapper as JsonObject : {};
        throw new StorefrontApiError(response.status, typeof error.code === "string" ? error.code : "http_error", typeof error.message === "string" ? error.message : "La solicitud storefront no pudo completarse", typeof error.requestId === "string" ? error.requestId : "unknown", error.retryable === true, error.details);
      }
      return parser(payload);
    } finally {
      active.delete(controller);
      external?.removeEventListener("abort", abort);
    }
  }

  function clearSession() {
    generation += 1; session = undefined; pendingSession = undefined;
    for (const controller of active) controller.abort(abortError());
    active.clear();
  }

  const get = <T>(path: string, parser: Parser<T>, signal?: AbortSignal) => request(path, parser, signal ? { signal } : {});
  const mutate = <T>(method: "POST" | "PUT", path: string, body: unknown, parser: Parser<T>, signal?: AbortSignal) => request(path, parser, { method, body: JSON.stringify(body), ...(signal ? { signal } : {}) }, crypto.randomUUID());
  return { get, mutate, clearSession };
}

export function createStorefrontClient(options: StorefrontClientOptions): StorefrontClient {
  const transport = createTransport(options);
  return {
    getPreferences: (signal) => transport.get("/v1/storefront/me/preferences", parsePreferences, signal),
    replacePreferences: (input, signal) => transport.mutate("PUT", "/v1/storefront/me/preferences", input, parsePreferences, signal),
    createGlobalProposal: (input, signal) => transport.mutate("POST", "/v1/storefront/global-change-proposals", input, parseProposal, signal),
    getOwnProposal: (id, signal) => transport.get(`/v1/storefront/global-change-proposals/${encodeURIComponent(id)}`, parseProposal, signal),
    clearSession: transport.clearSession,
  };
}

export function createStorefrontAdminClient(options: StorefrontClientOptions): StorefrontAdminClient {
  const transport = createTransport(options);
  const listParser: Parser<{ proposals: readonly StorefrontAdminProposalPreview[] }> = (value) => {
    const record = object(value, ["proposals"], "de lista administrativa");
    if (!Array.isArray(record.proposals)) throw new TypeError("Respuesta de lista administrativa inválida");
    return { proposals: record.proposals.map(parseAdminPreview) };
  };
  const base = "/v1/storefront/admin/global-change-proposals";
  return {
    listProposals: (signal) => transport.get(base, listParser, signal),
    getProposal: (id, signal) => transport.get(`${base}/${encodeURIComponent(id)}`, parseAdminPreview, signal),
    approveProposal: (id, expectedProposalRevision, expectedGlobalRevision, signal) => transport.mutate("POST", `${base}/${encodeURIComponent(id)}/approve`, { expectedProposalRevision, expectedGlobalRevision }, parseAdminPreview, signal),
    rejectProposal: (id, expectedProposalRevision, signal) => transport.mutate("POST", `${base}/${encodeURIComponent(id)}/reject`, { expectedProposalRevision }, parseAdminPreview, signal),
    clearSession: transport.clearSession,
  };
}
