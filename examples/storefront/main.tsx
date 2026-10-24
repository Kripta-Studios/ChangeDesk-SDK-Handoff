import React from "react";
import { createRoot } from "react-dom/client";
import { StorefrontAdminPanel, StorefrontPreferencesPanel, StorefrontProvider, StorefrontRoot, type StorefrontAdminClient, type StorefrontClient } from "../../packages/sdk-react/src/storefront/index.js";
import "./demo.css";

const initial = { overrides: {}, inherited: { theme: "system" as const, density: "comfortable" as const, productLayout: "grid" as const }, effective: { theme: "system" as const, density: "comfortable" as const, productLayout: "grid" as const }, buyerRevision: 4, globalRevision: 12 };
const client: StorefrontClient = {
  getPreferences: async () => initial,
  replacePreferences: async (input) => ({ ...initial, overrides: input.overrides, effective: { ...initial.effective, ...input.overrides }, buyerRevision: initial.buyerRevision + 1 }),
  createGlobalProposal: async (input) => ({ id: "proposal_demo", ...input, status: "pending", proposalRevision: 1, createdAt: new Date(0).toISOString() }),
  getOwnProposal: async () => { throw new Error("No usado en este fixture"); },
  subscribeSessionInvalidation: () => () => {},
  clearSession() {},
};
const products = [
  ["01", "Arcilla", "Vaso de taller", "24 €"],
  ["02", "Lino", "Bolsa de mercado", "38 €"],
  ["03", "Roble", "Bandeja del norte", "52 €"],
];
const adminPreview = { proposalId: "proposal_demo", proposalRevision: 3, current: initial.inherited, proposed: { theme: "dark" as const, density: "compact" as const, productLayout: "list" as const }, globalRevision: 12, precedenceNotice: "Los overrides personales se conservan; el cambio global solo afecta a los campos heredados.", status: "pending" as const };
const adminClient: StorefrontAdminClient = {
  listProposals: async () => ({ proposals: [adminPreview] }),
  getProposal: async () => adminPreview,
  approveProposal: async () => ({ ...adminPreview, proposalRevision: 4, globalRevision: 13, current: adminPreview.proposed, status: "approved" }),
  rejectProposal: async () => ({ ...adminPreview, proposalRevision: 4, status: "rejected" }),
  subscribeSessionInvalidation: () => () => {},
  clearSession() {},
};

function Demo() {
  return <StorefrontProvider client={client} sessionKey="fixture-buyer">
    <main className="demo-shell">
      <header className="demo-masthead"><span>ChangeDesk / SDK browser fixture</span><strong>ATLAS · Objects for daily rituals</strong></header>
      <div className="demo-layout"><StorefrontPreferencesPanel /><StorefrontRoot className="demo-catalog"><div className="demo-catalog__heading"><div><p>Selección de octubre</p><h1>Objetos honestos,<br />hechos para durar.</h1></div><span>03 piezas</span></div><div className="changedesk-storefront-products">{products.map(([number, material, name, price]) => <article key={number}><div className={`demo-object demo-object--${number}`} aria-hidden="true" /><div className="demo-product-meta"><span>{number} / {material}</span><h2>{name}</h2><strong>{price}</strong></div></article>)}</div></StorefrontRoot></div>
    </main>
  </StorefrontProvider>;
}

function AdminDemo() { return <main className="demo-shell"><header className="demo-masthead"><span>ChangeDesk / SDK admin fixture</span><strong>ATLAS · Global review</strong></header><StorefrontAdminPanel client={adminClient} /></main>; }

createRoot(document.getElementById("root")!).render(location.search === "?admin" ? <AdminDemo /> : <Demo />);
