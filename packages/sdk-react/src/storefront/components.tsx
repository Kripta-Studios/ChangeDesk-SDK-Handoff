import React, { useEffect, useState } from "react";
import type { StorefrontAdminProposalPreview, StorefrontOverrides } from "@changedesk/contracts";
import { StorefrontApiError, type StorefrontAdminClient } from "./client.js";
import { useStorefront } from "./provider.js";
import "./storefront.css";

type RootProps = { children: React.ReactNode; className?: string };
type Field = keyof StorefrontOverrides;
const labels: Record<Field, string> = { theme: "Tema", density: "Densidad", productLayout: "Distribución de productos" };
const options = {
  theme: [["light", "Claro"], ["dark", "Oscuro"], ["system", "Sistema"]],
  density: [["comfortable", "Cómoda"], ["compact", "Compacta"]],
  productLayout: [["grid", "Cuadrícula"], ["list", "Lista"]],
} as const;

export function StorefrontRoot({ children, className = "" }: RootProps) {
  const { preview } = useStorefront();
  const densityTokens = preview.density === "compact" ? { "--changedesk-storefront-card-gap": "0.625rem", "--changedesk-storefront-card-padding": "0.75rem" } : { "--changedesk-storefront-card-gap": "1.25rem", "--changedesk-storefront-card-padding": "1.25rem" };
  return <div className={`changedesk-storefront-root ${className}`.trim()} style={densityTokens as React.CSSProperties} data-theme={preview.theme} data-density={preview.density} data-product-layout={preview.productLayout}>{children}</div>;
}

function errorMessage(cause: unknown): string {
  if ((cause instanceof StorefrontApiError || (cause && typeof cause === "object" && "status" in cause)) && (cause as { status?: number }).status === 409) return "La configuración ha cambiado; debes recargar y revisar antes de continuar.";
  return cause instanceof Error ? cause.message : "No se pudo completar la operación.";
}

export function StorefrontPreferencesPanel() {
  const { client, preferences, draft, preview, loading, error, setDraft, refresh, accept } = useStorefront();
  const [busy, setBusy] = useState<"save" | "reset" | "propose" | null>(null);
  const [message, setMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const change = (field: Field, value: string) => {
    const next = { ...draft } as Record<string, string>;
    if (value === "") delete next[field]; else next[field] = value;
    setDraft(next as StorefrontOverrides); setMessage(""); setActionError("");
  };
  const run = async (kind: "save" | "reset" | "propose") => {
    if (!preferences) return;
    const controller = new AbortController();
    setBusy(kind); setMessage(""); setActionError("");
    try {
      if (kind === "propose") {
        await client.createGlobalProposal({ baseGlobalRevision: preferences.globalRevision, proposed: preview }, controller.signal);
        setMessage("Propuesta enviada: queda pendiente de revisión administrativa y todavía no se ha aplicado.");
      } else {
        const response = await client.replacePreferences({ expectedRevision: preferences.buyerRevision, overrides: kind === "reset" ? {} : draft }, controller.signal);
        accept(response);
        setMessage(kind === "reset" ? "Tus preferencias vuelven a heredar la configuración de la tienda." : "Preferencias guardadas solo para ti.");
      }
    } catch (cause) { setActionError(errorMessage(cause)); }
    finally { setBusy(null); }
  };
  return <section className="changedesk-storefront-panel" aria-labelledby="changedesk-storefront-title">
    <header className="changedesk-storefront-panel__header"><div><p className="changedesk-storefront-eyebrow">Tu escaparate</p><h2 id="changedesk-storefront-title">Ajusta cómo compras</h2></div><span className="changedesk-storefront-revision">rev. {preferences?.buyerRevision ?? "—"}</span></header>
    <p className="changedesk-storefront-intro">Previsualiza al instante. Nada se guarda hasta que eliges una acción.</p>
    {loading ? <p role="status">Cargando preferencias…</p> : null}
    {error ? <div className="changedesk-storefront-alert" role="alert"><span>{error.message}</span><button type="button" onClick={() => void refresh()}>Reintentar</button></div> : null}
    <div className="changedesk-storefront-fields">
      {(Object.keys(labels) as Field[]).map((field) => <label key={field} className="changedesk-storefront-field"><span>{labels[field]}</span><select value={draft[field] ?? ""} onChange={(event) => change(field, event.target.value)} disabled={!preferences || busy !== null}><option value="">Heredar configuración de tienda</option>{options[field].map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>)}
    </div>
    <div className="changedesk-storefront-actions">
      <button className="changedesk-storefront-button changedesk-storefront-button--primary" type="button" disabled={!preferences || busy !== null} onClick={() => void run("save")}>{busy === "save" ? "Guardando…" : "Solo para mí"}</button>
      <button className="changedesk-storefront-button" type="button" disabled={!preferences || busy !== null} onClick={() => void run("reset")}>{busy === "reset" ? "Restableciendo…" : "Restablecer mis preferencias"}</button>
      <button className="changedesk-storefront-button changedesk-storefront-button--proposal" type="button" disabled={!preferences || busy !== null} onClick={() => void run("propose")}>{busy === "propose" ? "Enviando…" : "Proponer para toda la tienda"}</button>
    </div>
    <div className="changedesk-storefront-status" aria-live="polite">{actionError ? <p role="alert">{actionError}</p> : message ? <p>{message}</p> : null}</div>
  </section>;
}

const valueLabels = { theme: "Tema", density: "Densidad", productLayout: "Productos" } as const;
const enumLabels: Record<string, string> = { light: "Claro", dark: "Oscuro", system: "Sistema", comfortable: "Cómoda", compact: "Compacta", grid: "Cuadrícula", list: "Lista" };
const statusLabels: Record<StorefrontAdminProposalPreview["status"], string> = { pending: "Pendiente", approved: "Aprobada", rejected: "Rechazada" };
function ProposalCard({ proposal, client, onUpdate }: { proposal: StorefrontAdminProposalPreview; client: StorefrontAdminClient; onUpdate(next: StorefrontAdminProposalPreview, message: string): void }) {
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState("");
  const decide = async (decision: "approve" | "reject") => {
    const controller = new AbortController(); setBusy(decision); setError("");
    try {
      const next = decision === "approve"
        ? await client.approveProposal(proposal.proposalId, proposal.proposalRevision, proposal.globalRevision, controller.signal)
        : await client.rejectProposal(proposal.proposalId, proposal.proposalRevision, controller.signal);
      onUpdate(next, decision === "approve" ? "Cambio global aplicado correctamente." : "Propuesta rechazada. No se cambió la configuración global.");
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(null); }
  };
  return <article className="changedesk-storefront-proposal">
    <header><div><span className="changedesk-storefront-status-chip">{statusLabels[proposal.status]}</span><h3>Propuesta {proposal.proposalId}</h3></div><span>Versión global {proposal.globalRevision}</span></header>
    <dl className="changedesk-storefront-diff">{(Object.keys(valueLabels) as Array<keyof typeof valueLabels>).map((field) => <div key={field}><dt>{valueLabels[field]}</dt><dd><span>{enumLabels[proposal.current[field]]}</span><b aria-hidden="true">→</b><strong>{enumLabels[proposal.proposed[field]]}</strong></dd></div>)}</dl>
    <p className="changedesk-storefront-notice">{proposal.precedenceNotice}</p>
    {proposal.status === "pending" ? <div className="changedesk-storefront-actions"><button className="changedesk-storefront-button changedesk-storefront-button--primary" type="button" disabled={busy !== null} onClick={() => void decide("approve")}>{busy === "approve" ? "Aprobando…" : "Aprobar cambio global"}</button><button className="changedesk-storefront-button" type="button" disabled={busy !== null} onClick={() => void decide("reject")}>{busy === "reject" ? "Rechazando…" : "Rechazar propuesta"}</button></div> : null}
    {error ? <p className="changedesk-storefront-error" role="alert">{error}</p> : null}
  </article>;
}

export function StorefrontAdminPanel({ client }: { client: StorefrontAdminClient }) {
  const [proposals, setProposals] = useState<readonly StorefrontAdminProposalPreview[]>([]);
  const [status, setStatus] = useState("Cargando propuestas…");
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    client.listProposals(controller.signal).then(({ proposals: items }) => { setProposals(items); setStatus(items.length ? "" : "No hay propuestas pendientes."); }, (cause) => { if ((cause as { name?: string }).name !== "AbortError") { setError(errorMessage(cause)); setStatus(""); } });
    return () => controller.abort();
  }, [client]);
  const update = (next: StorefrontAdminProposalPreview, message: string) => { setProposals((items) => items.map((item) => item.proposalId === next.proposalId ? next : item)); setStatus(message); };
  return <section className="changedesk-storefront-panel changedesk-storefront-admin" aria-labelledby="changedesk-storefront-admin-title"><header className="changedesk-storefront-panel__header"><div><p className="changedesk-storefront-eyebrow">Revisión global</p><h2 id="changedesk-storefront-admin-title">Propuestas de compradores</h2></div><span className="changedesk-storefront-count">{proposals.length}</span></header>{error ? <p className="changedesk-storefront-error" role="alert">{error}</p> : null}<div className="changedesk-storefront-status" aria-live="polite">{status ? <p>{status}</p> : null}</div><div className="changedesk-storefront-proposals">{proposals.map((proposal) => <ProposalCard key={proposal.proposalId} proposal={proposal} client={client} onUpdate={update} />)}</div></section>;
}

export const StorefrontAdminReview = StorefrontAdminPanel;
