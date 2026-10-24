import type { StorefrontSession } from "./client.js";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type Credentials = { email: string; password: string };
export type MedusaBuyerSession = {
  login(credentials: Credentials): Promise<void>;
  logout(): Promise<void>;
  getSession(): Promise<StorefrontSession>;
};

function fixedOrigin(value: string, label: string): string {
  const parsed = new URL(value);
  const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && local)) throw new TypeError(`${label} requiere HTTPS fuera de localhost`);
  if (parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname !== "/" && parsed.pathname !== "")) throw new TypeError(`${label} debe ser un origen fijo sin ruta, credenciales, query ni fragmento`);
  return parsed.origin;
}

async function json(response: Response, message: string): Promise<Record<string, unknown>> {
  const value = await response.json().catch(() => null) as unknown;
  if (!response.ok || !value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

/** Cookie bootstrap adapter for a Medusa 2.22 customer host. Credentials are never retained. */
export function createMedusaBuyerSession(options: { host: string; endpoint: string; publishableApiKey?: string; fetch?: typeof fetch }): MedusaBuyerSession {
  const host = fixedOrigin(options.host, "host");
  const endpoint = fixedOrigin(options.endpoint, "endpoint");
  const fetcher: FetchLike = options.fetch ?? globalThis.fetch.bind(globalThis);
  const hostHeaders = options.publishableApiKey ? { "x-publishable-api-key": options.publishableApiKey } : {};
  return {
    async login(credentials) {
      const login = await fetcher(`${host}/auth/customer/emailpass`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json", ...hostHeaders }, body: JSON.stringify(credentials),
      });
      const payload = await json(login, "No se pudo autenticar el comprador en Medusa");
      if (typeof payload.token !== "string" || !payload.token) throw new Error("No se pudo autenticar el comprador en Medusa");
      const cookie = await fetcher(`${host}/auth/session`, { method: "POST", credentials: "include", headers: { Authorization: `Bearer ${payload.token}`, ...hostHeaders } });
      if (!cookie.ok) throw new Error("No se pudo abrir la sesión cookie de Medusa");
    },
    async logout() {
      const response = await fetcher(`${host}/auth/session`, { method: "DELETE", credentials: "include", headers: hostHeaders });
      if (!response.ok && response.status !== 401) throw new Error("No se pudo cerrar la sesión de Medusa");
    },
    async getSession() {
      const bootstrap = await fetcher(`${host}/store/customers/me/changedesk/session`, {
        method: "POST", credentials: "include", headers: { "X-ChangeDesk-CSRF": "1", ...hostHeaders },
      });
      const ticketPayload = await json(bootstrap, "No se pudo acreditar la sesión customer de Medusa");
      if (typeof ticketPayload.ticket !== "string" || !ticketPayload.ticket) throw new Error("Ticket storefront de Medusa inválido");
      const exchange = await fetcher(`${endpoint}/v1/storefront/session/exchange`, {
        method: "POST", credentials: "omit", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ ticket: ticketPayload.ticket }),
      });
      const session = await json(exchange, "No se pudo abrir la sesión buyer de Change Desk");
      if (typeof session.accessToken !== "string" || !session.accessToken || typeof session.expiresAt !== "string" || !Number.isFinite(Date.parse(session.expiresAt))) throw new Error("Sesión storefront inválida");
      return { accessToken: session.accessToken, expiresAt: session.expiresAt };
    },
  };
}
