import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { createMedusaBuyerSession, createStorefrontClient, StorefrontAdminPanel, StorefrontPreferencesPanel, StorefrontProvider, StorefrontRoot, type StorefrontAdminClient, type StorefrontClient } from "../../packages/sdk-react/src/storefront/index.js";
import "./demo.css";

const initial = { overrides: {}, inherited: { theme: "system" as const, density: "comfortable" as const, productLayout: "grid" as const }, effective: { theme: "system" as const, density: "comfortable" as const, productLayout: "grid" as const }, buyerRevision: 4, globalRevision: 12 };
const fixtureClient: StorefrontClient = {
  getPreferences: async () => initial,
  replacePreferences: async (input) => ({ ...initial, overrides: input.overrides, effective: { ...initial.effective, ...input.overrides }, buyerRevision: initial.buyerRevision + 1 }),
  createGlobalProposal: async (input) => ({ id: "proposal_demo", ...input, status: "pending", proposalRevision: 1, createdAt: new Date(0).toISOString() }),
  getOwnProposal: async () => { throw new Error("No usado en este fixture"); }, subscribeSessionInvalidation: () => () => {}, clearSession() {},
};
const products = [["01", "Arcilla", "Vaso de taller", "24 €"], ["02", "Lino", "Bolsa de mercado", "38 €"], ["03", "Roble", "Bandeja del norte", "52 €"]];
const adminPreview = { proposalId: "proposal_demo", proposalRevision: 3, current: initial.inherited, proposed: { theme: "dark" as const, density: "compact" as const, productLayout: "list" as const }, globalRevision: 12, precedenceNotice: "Los overrides personales se conservan; el cambio global solo afecta a los campos heredados.", status: "pending" as const };
const adminClient: StorefrontAdminClient = {
  listProposals: async () => ({ proposals: [adminPreview] }), getProposal: async () => adminPreview,
  approveProposal: async () => ({ ...adminPreview, proposalRevision: 4, globalRevision: 13, current: adminPreview.proposed, status: "approved" }),
  rejectProposal: async () => ({ ...adminPreview, proposalRevision: 4, status: "rejected" }), subscribeSessionInvalidation: () => () => {}, clearSession() {},
};

function Catalog() {
  return <StorefrontRoot className="demo-catalog"><div className="demo-catalog__heading"><div><p>Selección de octubre</p><h1>Objetos honestos,<br />hechos para durar.</h1></div><span>03 piezas</span></div><div className="changedesk-storefront-products">{products.map(([number, material, name, price]) => <article key={number}><div className={`demo-object demo-object--${number}`} aria-hidden="true" /><div className="demo-product-meta"><span>{number} / {material}</span><h2>{name}</h2><strong>{price}</strong></div></article>)}</div></StorefrontRoot>;
}
function BuyerSurface({ client, sessionKey, tenant, onLogout }: { client: StorefrontClient; sessionKey: string; tenant: string; onLogout(): Promise<void> }) {
  return <StorefrontProvider client={client} sessionKey={sessionKey}><main className="demo-shell"><header className="demo-masthead"><span>ChangeDesk / buyer live</span><strong>{tenant.toUpperCase()} · Objects for daily rituals</strong><button className="demo-link" type="button" onClick={() => void onLogout()}>Cerrar sesión</button></header><div className="demo-layout"><StorefrontPreferencesPanel /><Catalog /></div></main></StorefrontProvider>;
}
function LiveDemo() {
  const [tenant, setTenant] = useState<"atlas" | "boreal">("atlas"); const [authenticated, setAuthenticated] = useState(false); const [sessionKey, setSessionKey] = useState(0); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const host = `http://127.0.0.1:${tenant === "atlas" ? "9001" : "9002"}`;
  const publishableApiKey = tenant === "atlas" ? import.meta.env.VITE_MEDUSA_PUBLISHABLE_API_KEY_ATLAS as string | undefined : import.meta.env.VITE_MEDUSA_PUBLISHABLE_API_KEY_BOREAL as string | undefined;
  const session = useMemo(() => createMedusaBuyerSession({ host, endpoint: "http://127.0.0.1:4100", publishableApiKey }), [host, publishableApiKey]);
  const client = useMemo(() => createStorefrontClient({ endpoint: "http://127.0.0.1:4100", getSession: session.getSession }), [session]);
  useEffect(() => client.subscribeSessionInvalidation(() => setAuthenticated(false)), [client]);
  const login = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError(""); const form = event.currentTarget; const data = new FormData(form);
    try { await session.login({ email: String(data.get("email") ?? ""), password: String(data.get("password") ?? "") }); setSessionKey((value) => value + 1); setAuthenticated(true); form.reset(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo iniciar sesión"); } finally { setBusy(false); }
  };
  const logout = async () => { setBusy(true); setError(""); client.clearSession(); try { await session.logout(); } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo cerrar sesión"); } finally { setAuthenticated(false); setSessionKey((value) => value + 1); setBusy(false); } };
  if (authenticated) return <BuyerSurface client={client} sessionKey={`${tenant}:${sessionKey}`} tenant={tenant} onLogout={logout} />;
  return <main className="demo-login"><section><p className="demo-kicker">ChangeDesk / buyer live</p><h1>Tu escaparate,<br />a tu manera.</h1><p>Autentícate como customer sintético. Tu sesión y preferencias quedan aisladas por comprador y tienda.</p><form onSubmit={login}><label><span>Tienda</span><select aria-label="Tienda" value={tenant} onChange={(event) => { setTenant(event.target.value as "atlas" | "boreal"); setError(""); }} disabled={busy}><option value="atlas">Atlas · :9001</option><option value="boreal">Boreal · :9002</option></select></label><label><span>Email customer</span><input name="email" type="email" autoComplete="username" required /></label><label><span>Contraseña</span><input name="password" type="password" autoComplete="current-password" required /></label><button type="submit" disabled={busy}>{busy ? "Abriendo sesión…" : "Entrar al escaparate"}</button></form>{error ? <p className="demo-error" role="alert">{error}</p> : null}<p className="demo-note">Las credenciales no se guardan en el navegador. El SDK conserva solo el token buyer efímero en memoria.</p></section></main>;
}
function FixtureDemo() { return <StorefrontProvider client={fixtureClient} sessionKey="fixture-buyer"><main className="demo-shell"><header className="demo-masthead"><span>ChangeDesk / SDK fixture explícito</span><strong>ATLAS · Objects for daily rituals</strong></header><div className="demo-layout"><StorefrontPreferencesPanel /><Catalog /></div></main></StorefrontProvider>; }
function AdminFixture() { return <main className="demo-shell"><header className="demo-masthead"><span>ChangeDesk / SDK admin fixture</span><strong>ATLAS · Global review</strong></header><StorefrontAdminPanel client={adminClient} /></main>; }
const params = new URLSearchParams(location.search); const fixture = params.get("mode") === "fixture";
createRoot(document.getElementById("root")!).render(fixture && params.get("admin") === "1" ? <AdminFixture /> : fixture ? <FixtureDemo /> : <LiveDemo />);
