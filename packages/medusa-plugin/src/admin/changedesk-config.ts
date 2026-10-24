import type { ChangeDeskConfig } from "@changedesk/react";

type BridgeTicket = { ticket: string; expiresAt: string };
type ExchangedSession = { accessToken: string; expiresAt: string };

const endpoint = import.meta.env.VITE_CHANGEDESK_ENDPOINT as string | undefined;
if (!endpoint) throw new Error("VITE_CHANGEDESK_ENDPOINT es obligatorio para montar Change Desk");

async function getSession(): Promise<ExchangedSession> {
  const bridge = await fetch("/admin/changedesk/session", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", "X-ChangeDesk-CSRF": "1" },
    body: "{}",
  });
  if (!bridge.ok) throw new Error("No se pudo acreditar la sesión de Medusa");
  const { ticket } = await bridge.json() as BridgeTicket;
  const exchange = await fetch(`${endpoint!.replace(/\/$/, "")}/v1/session/exchange`, {
    method: "POST",
    credentials: "omit",
    headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({ ticket }),
  });
  if (!exchange.ok) throw new Error("No se pudo abrir una sesión de Change Desk");
  return exchange.json() as Promise<ExchangedSession>;
}

export function medusaChangeDeskConfig(getSelectedProductIds: () => string[], surface: string): ChangeDeskConfig {
  return { endpoint, getSession, locale: "es", getContext: () => ({ selectedProductIds: getSelectedProductIds(), surface }) };
}
