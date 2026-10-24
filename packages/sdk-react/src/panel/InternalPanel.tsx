import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Candidate, CatalogOffer, ExecutionView, IdentityView, Installation, PlanView, RequestView, ResourceOption } from "../types.js";
import { ChangeDeskApiError } from "../client.js";
import { PanelErrorBoundary } from "../error-boundary.js";
import { pollResource, type PollController } from "../polling.js";
import { useChangeDesk } from "../provider.js";
import panelStyles from "./panel.css?inline";

type Screen = "request" | "configure" | "plan" | "execution" | "library" | "evidence";
const messages = {
  es: { kicker: "CONTROL DE CAMBIOS", selected: "productos seleccionados", request: "Solicitud", actions: "Acciones", evidence: "Evidencia", describe: "Describe el resultado", reauthorized: "La selección y los permisos se comprobarán de nuevo en el servidor.", prompt: "¿Qué necesitas cambiar?", clarify: "Aclara la petición", placeholder: "Ej.: Añade estos productos a la categoría y al canal de campaña.", sending: "Enviando…", search: "Buscar una función", sendClarification: "Enviar aclaración", footer: "Los efectos requieren preview y aprobación del servidor.", ready: "Listo" },
  en: { kicker: "CHANGE CONTROL", selected: "selected products", request: "Request", actions: "Actions", evidence: "Evidence", describe: "Describe the outcome", reauthorized: "The server will verify the selection and permissions again.", prompt: "What do you need to change?", clarify: "Clarify the request", placeholder: "Example: Add these products to the campaign category and channel.", sending: "Sending…", search: "Find a function", sendClarification: "Send clarification", footer: "Effects require a server preview and approval.", ready: "Ready" },
} as const;
const terminalRequest = new Set(["candidate_offered", "needs_configuration", "needs_clarification", "plan_ready", "rejected", "error"]);
const terminalExecution = new Set(["succeeded", "partial", "failed", "cancelled"]);

const stateLabel: Record<string, string> = {
  received: "Petición recibida", searching: "Buscando funciones", candidate_offered: "Funciones disponibles", generating: "Preparando una función", needs_configuration: "Falta configuración", needs_clarification: "Necesita aclaración", plan_ready: "Plan preparado", rejected: "Petición rechazada", error: "Error",
  queued: "En cola", running: "En curso", waiting_reconciliation: "Comprobando efectos", succeeded: "Completado", partial: "Parcial", failed: "Fallido", cancelled: "Cancelado", pending: "Pendiente", skipped: "Sin cambios", unknown: "Efecto desconocido", needs_review: "Requiere revisión",
};

function Status({ value }: { value: string }) { return <span className={`cd-status cd-status--${value}`}>{stateLabel[value] ?? value}</span>; }

function InternalPanel({ onClose, initialInstallationId }: { onClose?: (() => void) | undefined; initialInstallationId?: string | undefined }) {
  const { client, config, bindScope, remember, forget } = useChangeDesk();
  const titleId = useId();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const poller = useRef<PollController>();
  const [screen, setScreen] = useState<Screen>("request");
  const [message, setMessage] = useState("");
  const [request, setRequest] = useState<RequestView>();
  const [candidate, setCandidate] = useState<Candidate>();
  const [installationId, setInstallationId] = useState<string | undefined>(initialInstallationId);
  const [offer, setOffer] = useState<CatalogOffer>();
  const [resources, setResources] = useState<ResourceOption[]>([]);
  const [parameters, setParameters] = useState<Record<string, string>>({});
  const [plan, setPlan] = useState<PlanView>();
  const [execution, setExecution] = useState<ExecutionView>();
  const [installations, setInstallations] = useState<readonly Installation[]>([]);
  const [offers, setOffers] = useState<readonly CatalogOffer[]>([]);
  const [permissions, setPermissions] = useState<readonly string[]>([]);
  const [identity, setIdentity] = useState<IdentityView>();
  const [evidence, setEvidence] = useState<Array<{ id: string; status: string; scope: string; verifierVersion: string }>>([]);
  const [publicationId, setPublicationId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const copy = messages[config.locale];
  const selection = useMemo(() => config.getContext().selectedProductIds.slice(0, 100), [config]);
  const selectionKey = selection.join("\u0000");
  const previousSelection = useRef(selectionKey);

  useEffect(() => {
    if (previousSelection.current === selectionKey) return;
    previousSelection.current = selectionKey;
    poller.current?.abort(); setPlan(undefined); setExecution(undefined); remember({ planId: undefined, executionId: undefined });
    if (screen === "plan" || screen === "execution") setScreen(candidate || installationId ? "configure" : "request");
    setError("La selección cambió. El preview anterior se invalidó; prepara uno nuevo.");
  }, [selectionKey]);

  useEffect(() => {
    client.getInstallations().then(async (value) => {
      setInstallations(value.installations); setOffers(value.offers ?? []); setPermissions(value.permissions); setIdentity(value.identity);
      const resume = bindScope(value.identity?.scopeId);
      if (initialInstallationId) await configureInstallation(initialInstallationId, value.installations);
      else if (resume.executionId) { setScreen("execution"); watchExecution(resume.executionId); }
      else if (resume.planId) {
        const saved = await client.getPlan(resume.planId);
        const currentSelection = [...selection].sort().join("\u0000");
        const plannedSelection = [...saved.plan.selectionSnapshot].sort().join("\u0000");
        if (currentSelection !== plannedSelection) { remember({ planId: undefined }); setError("La selección cambió. El preview anterior se invalidó; prepara uno nuevo."); }
        else { setPlan(saved); setScreen("plan"); }
      }
      else if (resume.requestId) watchRequest(resume.requestId);
    }).catch((reason) => { forget(); showError(reason); });
    queueMicrotask(() => inputRef.current?.focus());
    return () => { poller.current?.abort(); client.clearSession(); };
  }, [client]);

  function showError(reason: unknown) {
    const apiError = reason instanceof ChangeDeskApiError ? reason : undefined;
    setError(apiError?.message ?? "No se pudo completar la operación.");
    config.onEvent?.({ type: "error", code: apiError?.code ?? "ui_error", ...(apiError ? { requestId: apiError.requestId } : {}) });
  }

  function watchRequest(id: string) {
    remember({ requestId: id });
    poller.current?.abort();
    poller.current = pollResource((signal) => client.getRequest(id, signal), {
      isTerminal: (value) => terminalRequest.has(value.status),
      onValue: (value) => {
        setRequest(value); setPermissions(value.permissions ?? []); if (value.identity) setIdentity(value.identity);
        value.candidates.forEach((item) => config.onEvent?.({ type: "candidate_offered", candidateId: item.id }));
      }, onError: showError,
    });
  }

  async function submitRequest(event: React.FormEvent) {
    event.preventDefault(); setError(undefined);
    if (!message.trim()) { setError("Describe el cambio antes de continuar."); return; }
    if (selection.length === 0) { setError("Selecciona al menos un producto en Medusa."); return; }
    setBusy(true);
    try {
      const created = await client.createRequest({ message: message.trim(), selectedProductIds: selection, locale: config.locale, clientRequestId: crypto.randomUUID() });
      watchRequest(created.requestId);
    } catch (reason) { showError(reason); } finally { setBusy(false); }
  }

  async function chooseCandidate(item: Candidate, choice: "reuse" | "adapt") {
    if (!request) return;
    setBusy(true); setError(undefined);
    try {
      await client.selectCandidate(request.requestId, { candidateId: item.id, version: item.version, choice });
      setCandidate(item); config.onEvent?.({ type: "candidate_selected", candidateId: item.id });
      setInstallationId(undefined);
      const kinds = item.missingParameters.map((field) => field === "categoryId" ? "category" as const : "channel" as const);
      const lists = await Promise.all([...new Set(kinds)].map((kind) => client.getResources(kind)));
      setResources(lists.flatMap((list) => list.resources)); setScreen("configure");
    } catch (reason) { showError(reason); } finally { setBusy(false); }
  }

  async function sendClarification(event: React.FormEvent) {
    event.preventDefault(); if (!request || !message.trim()) return;
    setBusy(true); setError(undefined);
    try { await client.sendMessage(request.requestId, { message: message.trim(), clientRequestId: crypto.randomUUID() }); setMessage(""); watchRequest(request.requestId); }
    catch (reason) { showError(reason); } finally { setBusy(false); }
  }

  function parameterNamesForInstallation(item: Installation | undefined): Array<"categoryId" | "channelId"> {
    if (!item) return [];
    if (item.recipeKey === "catalog.category.assign.v1") return ["categoryId"];
    if (item.recipeKey === "catalog.channel.assign.v1") return ["channelId"];
    return ["categoryId", "channelId"];
  }

  async function configureInstallation(id: string, available = installations) {
    const item = available.find((entry) => entry.id === id);
    if (!item || item.state !== "active") { setError("La acción instalada no está disponible."); return; }
    setInstallationId(id); setOffer(undefined); setCandidate(undefined); setPlan(undefined); setExecution(undefined); setParameters({});
    const names = parameterNamesForInstallation(item);
    const kinds = names.map((name) => name === "categoryId" ? "category" as const : "channel" as const);
    const lists = await Promise.all([...new Set(kinds)].map((kind) => client.getResources(kind)));
    setResources(lists.flatMap((list) => list.resources)); setScreen("configure");
  }

  async function configureOffer(item: CatalogOffer) {
    setOffer(item); setInstallationId(undefined); setCandidate(undefined); setPlan(undefined); setExecution(undefined); setParameters({}); setError(undefined);
    const kinds = item.requiredParameters.map((name) => name === "categoryId" ? "category" as const : "channel" as const);
    try { const lists = await Promise.all([...new Set(kinds)].map((kind) => client.getResources(kind))); setResources(lists.flatMap((list) => list.resources)); setScreen("configure"); }
    catch (reason) { showError(reason); }
  }

  async function installOffer(event: React.FormEvent) {
    event.preventDefault(); if (!offer) return;
    if (offer.requiredParameters.some((name) => !parameters[name])) { setError("Completa todos los recursos requeridos."); return; }
    setBusy(true); setError(undefined);
    try { const result = await client.installAction({ artifactHash: offer.artifactHash, configuration: parameters }); config.onEvent?.({ type: "action_installed", installationId: result.installationId }); const list = await client.getInstallations(); setInstallations(list.installations); setOffers(list.offers ?? []); setOffer(undefined); setScreen("library"); }
    catch (reason) { showError(reason); } finally { setBusy(false); }
  }

  async function preparePlan(event: React.FormEvent) {
    event.preventDefault();
    const names = candidate?.missingParameters ?? parameterNamesForInstallation(installations.find((item) => item.id === installationId));
    if (names.some((name) => !parameters[name])) { setError("Completa todos los recursos requeridos."); return; }
    setBusy(true); setError(undefined);
    try {
      const created = await client.createPlan({ ...(installationId ? { installationId } : request ? { requestId: request.requestId } : {}), selectedProductIds: selection, parameters });
      const view = await client.getPlan(created.planId); setPlan(view); setPermissions(view.permissions); setScreen("plan"); remember({ planId: created.planId });
      config.onEvent?.({ type: "plan_ready", planId: created.planId });
    } catch (reason) { showError(reason); } finally { setBusy(false); }
  }

  async function approveAndExecute() {
    if (!plan) return;
    setBusy(true); setError(undefined);
    try {
      const key = crypto.randomUUID();
      const approved = await client.approvePlan({ planId: plan.plan.id, planHash: plan.plan.planHash, expectedPlanVersion: plan.plan.planVersion, idempotencyKey: key });
      const created = await client.startExecution({ approvalId: approved.approvalId });
      setScreen("execution"); remember({ executionId: created.executionId }); watchExecution(created.executionId);
    } catch (reason) { showError(reason); } finally { setBusy(false); }
  }

  function watchExecution(id: string) {
    poller.current?.abort();
    poller.current = pollResource((signal) => client.getExecution(id, signal), {
      isTerminal: (value) => terminalExecution.has(value.state),
      onValue: (value) => { setExecution(value); setPermissions(value.permissions); config.onEvent?.({ type: "execution_updated", executionId: value.id, status: value.state }); },
      onError: showError,
    });
  }

  async function cancel() { if (!execution) return; try { setExecution(await client.cancelExecution(execution.id)); } catch (reason) { showError(reason); } }
  async function resumeCurrentExecution() { if (!execution) return; try { setExecution(await client.resumeExecution(execution.id)); watchExecution(execution.id); } catch (reason) { showError(reason); } }
  async function install() { if (!candidate) return; try { const result = await client.installAction({ artifactHash: candidate.artifactHash, configuration: parameters }); config.onEvent?.({ type: "action_installed", installationId: result.installationId }); const list = await client.getInstallations(); setInstallations(list.installations); } catch (reason) { showError(reason); } }
  async function publish() { if (!candidate) return; try { const result = await client.publishAction({ artifactHash: candidate.artifactHash, visibility: "provider_catalog", consent: true }); setPublicationId(result.publicationId); } catch (reason) { showError(reason); } }
  async function revoke() { if (!publicationId) return; try { await client.revokePublication(publicationId, "Revocación solicitada desde administración"); setPublicationId(undefined); } catch (reason) { showError(reason); } }
  async function loadEvidence() {
    if (!plan) return;
    try { const values = await Promise.all(plan.plan.evidenceRefs.map((id) => client.getEvidence(id))); setEvidence(values.map((value) => value.evidence)); setScreen("evidence"); } catch (reason) { showError(reason); }
  }

  function containKeyboardFocus(event: React.KeyboardEvent) {
    if (event.key === "Escape" && onClose) { event.preventDefault(); onClose(); return; }
    if (event.key !== "Tab") return;
    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), textarea:not([disabled]), select:not([disabled]), input:not([disabled]), a[href]') ?? [])];
    if (!focusable.length) return;
    const first = focusable[0]!; const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  return (
    <><style>{panelStyles}</style><div className="cd-backdrop" role="presentation">
      <aside ref={dialogRef} className="cd-panel" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={containKeyboardFocus}>
        <PanelErrorBoundary onReset={client.clearSession}>
          <header className="cd-header"><div><span className="cd-kicker">{copy.kicker}</span><h1 id={titleId}>Change Desk</h1><p>{identity ? `${identity.tenantName} · ${identity.actorName} · ${identity.role} · ` : ""}{selection.length} {copy.selected} · {config.getContext().surface}</p></div>{onClose ? <button className="cd-icon-button" type="button" aria-label={config.locale === "es" ? "Cerrar Change Desk" : "Close Change Desk"} onClick={onClose}>×</button> : null}</header>
          <nav className="cd-nav" aria-label={config.locale === "es" ? "Secciones" : "Sections"}><button aria-current={screen === "request"} onClick={() => setScreen("request")}>{copy.request}</button><button aria-current={screen === "library"} onClick={() => setScreen("library")}>{copy.actions}</button>{plan ? <><button aria-current={screen === "plan"} onClick={() => setScreen("plan")}>Preview</button><button aria-current={screen === "evidence"} onClick={loadEvidence}>{copy.evidence}</button></> : null}</nav>
          <main className="cd-content">
            {error ? <div className="cd-alert" role="alert">{error}</div> : null}
            {screen === "request" ? <section><div className="cd-step"><span>01</span><div><h2>{copy.describe}</h2><p>{copy.reauthorized}</p></div></div><form onSubmit={request?.status === "needs_clarification" ? sendClarification : submitRequest}><label htmlFor={`${titleId}-message`}>{request?.status === "needs_clarification" ? copy.clarify : copy.prompt}</label><textarea ref={inputRef} id={`${titleId}-message`} maxLength={4000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={copy.placeholder}/><div className="cd-form-footer"><span>{message.length}/4000</span><button className="cd-button" disabled={busy} type="submit">{busy ? copy.sending : request?.status === "needs_clarification" ? copy.sendClarification : copy.search}</button></div></form>{request ? <RequestResult request={request} busy={busy} onChoose={chooseCandidate} /> : null}</section> : null}
            {screen === "configure" && (candidate || installationId || offer) ? <Configuration title={offer?.displayName ?? candidate?.displayName ?? installations.find((item) => item.id === installationId)?.displayName ?? "Acción instalada"} parameterNames={offer?.requiredParameters ?? candidate?.missingParameters ?? parameterNamesForInstallation(installations.find((item) => item.id === installationId))} resources={resources} parameters={parameters} setParameters={(next) => { setPlan(undefined); setParameters(next); }} onSubmit={offer ? installOffer : preparePlan} busy={busy} submitLabel={offer ? "Instalar con esta configuración" : undefined} /> : null}
            {screen === "plan" && plan ? <PlanPreview view={plan} canApprove={plan.canApprove && permissions.includes("approve") && permissions.includes("execute")} busy={busy} onEdit={() => { setPlan(undefined); remember({ planId: undefined }); setScreen("configure"); }} onApprove={approveAndExecute} onInstall={permissions.includes("install") && !installations.some((item) => item.artifactHash === plan.plan.artifactHash) ? install : undefined} onPublish={permissions.includes("share") ? publish : undefined} publicationId={publicationId} onRevoke={permissions.includes("revoke") ? revoke : undefined} /> : null}
            {screen === "execution" ? <ExecutionProgress execution={execution} onCancel={permissions.includes("execute") ? cancel : undefined} onResume={permissions.includes("execute") ? resumeCurrentExecution : undefined} /> : null}
            {screen === "library" ? <Library installations={installations} offers={offers} canInstall={permissions.includes("install")} onRun={configureInstallation} onConfigureOffer={configureOffer} /> : null}
            {screen === "evidence" ? <EvidenceList evidence={evidence} /> : null}
          </main>
          <footer className="cd-footer"><span>{copy.footer}</span><span aria-live="polite">{request ? stateLabel[request.status] ?? request.status : copy.ready}</span></footer>
        </PanelErrorBoundary>
      </aside>
    </div></>
  );
}

function RequestResult({ request, busy, onChoose }: { request: RequestView; busy: boolean; onChoose: (candidate: Candidate, choice: "reuse" | "adapt") => void }) {
  return <section className="cd-result" aria-live="polite"><div className="cd-result__head"><Status value={request.status}/><span className={`cd-provider cd-provider--${request.providerMode}`}>{request.providerMode === "fake" ? "Proveedor simulado" : request.providerMode === "live" ? "Proveedor real" : "Proveedor no disponible"}</span></div><p>{request.safeMessage}</p>{request.candidates.map((item) => <article className="cd-candidate" key={item.id}><div><span className="cd-kicker">{item.recipeKey} · v{item.version}</span><h3>{item.displayName}</h3><p>{item.requiredCapabilities.join(" · ")}</p></div><div><Status value={item.evidenceStatus}/><button className="cd-button" disabled={busy || item.compatibility === "incompatible"} type="button" onClick={() => onChoose(item, item.compatibility === "adaptation_required" ? "adapt" : "reuse")}>{item.compatibility === "adaptation_required" ? "Adaptar" : "Usar esta función"}</button></div></article>)}</section>;
}

function Configuration({ title, parameterNames, resources, parameters, setParameters, onSubmit, busy, submitLabel = "Preparar preview" }: { title: string; parameterNames: readonly string[]; resources: ResourceOption[]; parameters: Record<string, string>; setParameters: React.Dispatch<React.SetStateAction<Record<string, string>>>; onSubmit: (event: React.FormEvent) => void; busy: boolean; submitLabel?: string | undefined }) {
  return <section><div className="cd-step"><span>02</span><div><h2>Configuración local</h2><p>{title}. Los recursos proceden de la allowlist del servidor.</p></div></div><form onSubmit={onSubmit}>{parameterNames.map((name) => { const kind = name === "categoryId" ? "category" : "channel"; return <label key={name}>{name === "categoryId" ? "Categoría" : "Canal"}<select value={parameters[name] ?? ""} onChange={(e) => setParameters((current) => ({ ...current, [name]: e.target.value }))}><option value="">Selecciona…</option>{resources.filter((item) => item.kind === kind).map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>; })}<button className="cd-button" disabled={busy} type="submit">{submitLabel}</button></form></section>;
}

export function PlanPreview({ view, canApprove, busy, onEdit, onApprove, onInstall, onPublish, publicationId, onRevoke }: { view: PlanView; canApprove: boolean; busy: boolean; onEdit?: (() => void) | undefined; onApprove: () => void; onInstall?: (() => void) | undefined; onPublish?: (() => void) | undefined; publicationId?: string | undefined; onRevoke?: (() => void) | undefined }) {
  const plan = view.plan;
  const applyEffects = plan.perRecordEffects.filter((effect) => effect.expected === "apply");
  const noOpEffects = plan.perRecordEffects.filter((effect) => effect.expected === "no_op");
  const eligible = new Set(plan.perRecordEffects.map((effect) => effect.recordId)).size;
  const summary = view.summary ?? { selected: plan.selectionSnapshot.length, eligible, additions: applyEffects.length, noOp: noOpEffects.length, excluded: plan.exclusions.length, blocked: 0 };
  return <section><div className="cd-step"><span>03</span><div><h2>Preview del plan</h2><p>{view.title} · v{plan.planVersion} · vence {new Date(plan.expiresAt).toLocaleString("es")}</p></div></div><div className="cd-summary"><div><strong>{summary.additions}</strong><span>Adiciones reales</span></div><div><strong>{summary.eligible}</strong><span>Elegibles</span></div><div><strong>{summary.noOp}</strong><span>Sin cambios</span></div><div><strong>{summary.excluded}</strong><span>Excluidos</span></div><div><strong>{summary.blocked}</strong><span>Bloqueados</span></div></div><div className="cd-table-wrap"><table><caption>Cambios reales derivados del plan materializado</caption><thead><tr><th>Producto</th><th>Estado / antes</th><th>Adiciones / resultado</th></tr></thead><tbody>{view.rows?.map((row) => <tr key={row.recordId}><td>{row.productLabel}</td><td>{row.observedStatus}<br/>{row.before.join(", ") || "Sin asociaciones"}</td><td>{row.additions.join(", ") || "Sin cambios"}<br/>{row.reason ?? stateLabel[row.outcome] ?? row.outcome}</td></tr>) ?? <>{plan.perRecordEffects.map((effect) => <tr key={`${effect.recordId}:${effect.stepId}`}><td>{effect.recordId}</td><td>Contexto autorizado no disponible</td><td>{effect.expected === "no_op" ? "Sin cambios" : effect.capability.includes("categories") ? "Añadir categoría" : "Añadir canal"}</td></tr>)}{plan.exclusions.map((item) => <tr key={`excluded:${item.recordId}`}><td>{item.recordId}</td><td>Excluido</td><td>{item.reason}</td></tr>)}</>}</tbody></table></div><div className="cd-actions">{onEdit ? <button className="cd-button cd-button--secondary" type="button" onClick={onEdit}>Editar selección o parámetros</button> : null}{canApprove ? <button className="cd-button" disabled={busy || plan.state !== "ready"} onClick={onApprove}>Aprobar y ejecutar</button> : <p className="cd-note">Tu rol puede revisar este plan, pero el servidor no permite aprobarlo y ejecutarlo.</p>}{onInstall ? <button className="cd-button cd-button--secondary" onClick={onInstall}>Instalar acción</button> : null}{onPublish && !publicationId ? <button className="cd-button cd-button--secondary" onClick={onPublish}>Compartir con catálogo del proveedor</button> : null}{publicationId && onRevoke ? <button className="cd-button cd-button--danger" onClick={onRevoke}>Revocar publicación</button> : null}</div></section>;
}

export function ExecutionProgress({ execution, onCancel, onResume }: { execution?: ExecutionView | undefined; onCancel?: (() => void) | undefined; onResume?: (() => void) | undefined }) {
  if (!execution) return <div role="status">Iniciando ejecución…</div>;
  return <section><div className="cd-step"><span>04</span><div><h2>Resultado por registro</h2><Status value={execution.state}/></div></div><div className="cd-table-wrap"><table><caption>Progreso durable de la ejecución</caption><thead><tr><th>Registro</th><th>Estado</th><th>Pasos</th></tr></thead><tbody>{execution.rows.map((row) => <tr key={row.rowId}><td>{row.resourceRef}</td><td><Status value={row.state}/></td><td>{row.steps.map((step) => <span className="cd-step-token" key={step.stepId}>{step.stepId}: {stateLabel[step.state] ?? step.state}</span>)}</td></tr>)}</tbody></table></div><div className="cd-actions">{onCancel && ["queued", "running", "waiting_reconciliation"].includes(execution.state) ? <button className="cd-button cd-button--danger" onClick={onCancel}>Cancelar pasos futuros</button> : null}{onResume && ["partial", "failed", "waiting_reconciliation"].includes(execution.state) ? <button className="cd-button" onClick={onResume}>Reconciliar y reanudar</button> : null}</div></section>;
}

function Library({ installations, offers, canInstall, onRun, onConfigureOffer }: { installations: readonly Installation[]; offers: readonly CatalogOffer[]; canInstall: boolean; onRun: (id: string) => void; onConfigureOffer: (offer: CatalogOffer) => void }) { return <section><div className="cd-step"><span>↻</span><div><h2>Acciones instaladas</h2><p>Las ejecuciones repetidas no necesitan volver a generar la receta.</p></div></div>{installations.length ? <div className="cd-card-grid">{installations.map((item) => <article className="cd-library-card" key={item.id}><Status value={item.state}/><h3>{item.displayName}</h3><p>{item.recipeKey} · v{item.version}</p><p>Evidencia: {stateLabel[item.evidenceStatus] ?? item.evidenceStatus}</p>{item.updateAvailable ? <strong>Actualización disponible</strong> : null}<button className="cd-button" type="button" disabled={item.state !== "active" || !item.permissions.includes("execute")} onClick={() => onRun(item.id)}>Configurar y ejecutar</button></article>)}</div> : <p className="cd-empty">Aún no hay acciones instaladas para este usuario.</p>}<div className="cd-step"><span>+</span><div><h2>Ofertas compartidas</h2><p>Artefactos genéricos autorizados; la configuración y los recursos serán propios de esta tienda.</p></div></div>{offers.length ? <div className="cd-card-grid">{offers.map((item) => <article className="cd-library-card" key={item.artifactHash}><Status value={item.evidenceStatus}/><h3>{item.displayName}</h3><p>{item.recipeKey} · v{item.version}</p><p>{item.requiredParameters.join(" · ")}</p><button className="cd-button" type="button" disabled={!canInstall} onClick={() => onConfigureOffer(item)}>{canInstall ? "Configurar e instalar" : "Requiere un administrador"}</button></article>)}</div> : <p className="cd-empty">No hay ofertas compartidas autorizadas.</p>}</section>; }
function EvidenceList({ evidence }: { evidence: Array<{ id: string; status: string; scope: string; verifierVersion: string }> }) { return <section><div className="cd-step"><span>✓</span><div><h2>Evidencia</h2><p>Alcance y versión explícitos; no certifica la API externa.</p></div></div>{evidence.length ? evidence.map((item) => <article className="cd-library-card" key={item.id}><Status value={item.status}/><h3>{item.scope}</h3><p>Verificador {item.verifierVersion}</p></article>) : <p className="cd-empty">No hay evidencia visible o todavía no se ha ejecutado.</p>}</section>; }

export default InternalPanel;
