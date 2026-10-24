import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Candidate, ExecutionView, Installation, PlanView, RequestView, ResourceOption } from "../types.js";
import { ChangeDeskApiError } from "../client.js";
import { PanelErrorBoundary } from "../error-boundary.js";
import { pollResource, type PollController } from "../polling.js";
import { useChangeDesk } from "../provider.js";
import "./panel.css";

type Screen = "request" | "configure" | "plan" | "execution" | "library" | "evidence";
const terminalRequest = new Set(["candidate_offered", "needs_configuration", "needs_clarification", "plan_ready", "rejected", "error"]);
const terminalExecution = new Set(["succeeded", "partial", "failed", "cancelled"]);

const stateLabel: Record<string, string> = {
  received: "Petición recibida", searching: "Buscando funciones", candidate_offered: "Funciones disponibles", generating: "Preparando una función", needs_configuration: "Falta configuración", needs_clarification: "Necesita aclaración", plan_ready: "Plan preparado", rejected: "Petición rechazada", error: "Error",
  queued: "En cola", running: "En curso", waiting_reconciliation: "Comprobando efectos", succeeded: "Completado", partial: "Parcial", failed: "Fallido", cancelled: "Cancelado", pending: "Pendiente", skipped: "Sin cambios", unknown: "Efecto desconocido", needs_review: "Requiere revisión",
};

function Status({ value }: { value: string }) { return <span className={`cd-status cd-status--${value}`}>{stateLabel[value] ?? value}</span>; }

function InternalPanel({ onClose }: { onClose?: (() => void) | undefined }) {
  const { client, config } = useChangeDesk();
  const titleId = useId();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const poller = useRef<PollController>();
  const [screen, setScreen] = useState<Screen>("request");
  const [message, setMessage] = useState("");
  const [request, setRequest] = useState<RequestView>();
  const [candidate, setCandidate] = useState<Candidate>();
  const [resources, setResources] = useState<ResourceOption[]>([]);
  const [parameters, setParameters] = useState<Record<string, string>>({});
  const [plan, setPlan] = useState<PlanView>();
  const [execution, setExecution] = useState<ExecutionView>();
  const [installations, setInstallations] = useState<readonly Installation[]>([]);
  const [permissions, setPermissions] = useState<readonly string[]>([]);
  const [evidence, setEvidence] = useState<Array<{ id: string; status: string; scope: string; verifierVersion: string }>>([]);
  const [publicationId, setPublicationId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const selection = useMemo(() => config.getContext().selectedProductIds.slice(0, 100), [config]);

  useEffect(() => {
    client.getInstallations().then((value) => { setInstallations(value.installations); setPermissions(value.permissions); }).catch(showError);
    queueMicrotask(() => inputRef.current?.focus());
    return () => { poller.current?.abort(); client.clearSession(); };
  }, [client]);

  function showError(reason: unknown) {
    const apiError = reason instanceof ChangeDeskApiError ? reason : undefined;
    setError(apiError?.message ?? "No se pudo completar la operación.");
    config.onEvent?.({ type: "error", code: apiError?.code ?? "ui_error", ...(apiError ? { requestId: apiError.requestId } : {}) });
  }

  function watchRequest(id: string) {
    poller.current?.abort();
    poller.current = pollResource((signal) => client.getRequest(id, signal), {
      isTerminal: (value) => terminalRequest.has(value.status),
      onValue: (value) => {
        setRequest(value); setPermissions(value.permissions);
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
      const kinds = item.missingParameters.map((field) => field === "categoryId" ? "category" as const : "channel" as const);
      const lists = await Promise.all([...new Set(kinds)].map((kind) => client.getResources(kind)));
      setResources(lists.flatMap((list) => list.resources)); setScreen("configure");
    } catch (reason) { showError(reason); } finally { setBusy(false); }
  }

  async function preparePlan(event: React.FormEvent) {
    event.preventDefault(); if (!candidate) return;
    if (candidate.missingParameters.some((name) => !parameters[name])) { setError("Completa todos los recursos requeridos."); return; }
    setBusy(true); setError(undefined);
    try {
      const created = await client.createPlan({ ...(request ? { requestId: request.requestId } : {}), selectedProductIds: selection, parameters });
      const view = await client.getPlan(created.planId); setPlan(view); setPermissions(view.permissions); setScreen("plan");
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
      setScreen("execution"); watchExecution(created.executionId);
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
  async function resume() { if (!execution) return; try { setExecution(await client.resumeExecution(execution.id)); watchExecution(execution.id); } catch (reason) { showError(reason); } }
  async function install() { if (!candidate) return; try { const result = await client.installAction({ artifactHash: candidate.artifactHash, configuration: parameters }); config.onEvent?.({ type: "action_installed", installationId: result.installationId }); const list = await client.getInstallations(); setInstallations(list.installations); setScreen("library"); } catch (reason) { showError(reason); } }
  async function publish() { if (!candidate) return; try { const result = await client.publishAction({ artifactHash: candidate.artifactHash, visibility: "authorized_catalog", consent: true }); setPublicationId(result.publicationId); } catch (reason) { showError(reason); } }
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
    <div className="cd-backdrop" role="presentation">
      <aside ref={dialogRef} className="cd-panel" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={containKeyboardFocus}>
        <PanelErrorBoundary onReset={client.clearSession}>
          <header className="cd-header"><div><span className="cd-kicker">CONTROL DE CAMBIOS</span><h1 id={titleId}>Change Desk</h1><p>{selection.length} productos seleccionados · {config.getContext().surface}</p></div>{onClose ? <button className="cd-icon-button" type="button" aria-label="Cerrar Change Desk" onClick={onClose}>×</button> : null}</header>
          <nav className="cd-nav" aria-label="Secciones"><button aria-current={screen === "request"} onClick={() => setScreen("request")}>Solicitud</button><button aria-current={screen === "library"} onClick={() => setScreen("library")}>Acciones</button>{plan ? <button aria-current={screen === "evidence"} onClick={loadEvidence}>Evidencia</button> : null}</nav>
          <main className="cd-content">
            {error ? <div className="cd-alert" role="alert">{error}</div> : null}
            {screen === "request" ? <section><div className="cd-step"><span>01</span><div><h2>Describe el resultado</h2><p>La selección y los permisos se comprobarán de nuevo en el servidor.</p></div></div><form onSubmit={submitRequest}><label htmlFor={`${titleId}-message`}>¿Qué necesitas cambiar?</label><textarea ref={inputRef} id={`${titleId}-message`} maxLength={4000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Ej.: Añade estos productos a la categoría y al canal de campaña."/><div className="cd-form-footer"><span>{message.length}/4000</span><button className="cd-button" disabled={busy} type="submit">{busy ? "Enviando…" : "Buscar una función"}</button></div></form>{request ? <RequestResult request={request} busy={busy} onChoose={chooseCandidate} /> : null}</section> : null}
            {screen === "configure" && candidate ? <Configuration candidate={candidate} resources={resources} parameters={parameters} setParameters={setParameters} onSubmit={preparePlan} busy={busy} /> : null}
            {screen === "plan" && plan ? <PlanPreview view={plan} canApprove={plan.canApprove && permissions.includes("approve") && permissions.includes("execute")} busy={busy} onApprove={approveAndExecute} onInstall={permissions.includes("install") ? install : undefined} onPublish={permissions.includes("share") ? publish : undefined} publicationId={publicationId} onRevoke={permissions.includes("revoke") ? revoke : undefined} /> : null}
            {screen === "execution" ? <ExecutionProgress execution={execution} onCancel={permissions.includes("execute") ? cancel : undefined} onResume={permissions.includes("execute") ? resume : undefined} /> : null}
            {screen === "library" ? <Library installations={installations} /> : null}
            {screen === "evidence" ? <EvidenceList evidence={evidence} /> : null}
          </main>
          <footer className="cd-footer"><span>Los efectos requieren preview y aprobación del servidor.</span><span aria-live="polite">{request ? stateLabel[request.status] ?? request.status : "Listo"}</span></footer>
        </PanelErrorBoundary>
      </aside>
    </div>
  );
}

function RequestResult({ request, busy, onChoose }: { request: RequestView; busy: boolean; onChoose: (candidate: Candidate, choice: "reuse" | "adapt") => void }) {
  return <section className="cd-result" aria-live="polite"><div className="cd-result__head"><Status value={request.status}/><span className={`cd-provider cd-provider--${request.providerMode}`}>{request.providerMode === "fake" ? "Proveedor simulado" : request.providerMode === "live" ? "Proveedor real" : "Proveedor no disponible"}</span></div><p>{request.safeMessage}</p>{request.candidates.map((item) => <article className="cd-candidate" key={item.id}><div><span className="cd-kicker">{item.recipeKey} · v{item.version}</span><h3>{item.displayName}</h3><p>{item.requiredCapabilities.join(" · ")}</p></div><div><Status value={item.evidenceStatus}/><button className="cd-button" disabled={busy || item.compatibility === "incompatible"} type="button" onClick={() => onChoose(item, item.compatibility === "adaptation_required" ? "adapt" : "reuse")}>{item.compatibility === "adaptation_required" ? "Adaptar" : "Usar esta función"}</button></div></article>)}</section>;
}

function Configuration({ candidate, resources, parameters, setParameters, onSubmit, busy }: { candidate: Candidate; resources: ResourceOption[]; parameters: Record<string, string>; setParameters: React.Dispatch<React.SetStateAction<Record<string, string>>>; onSubmit: (event: React.FormEvent) => void; busy: boolean }) {
  return <section><div className="cd-step"><span>02</span><div><h2>Configuración local</h2><p>{candidate.displayName}. Los recursos proceden de la allowlist del servidor.</p></div></div><form onSubmit={onSubmit}>{candidate.missingParameters.map((name) => { const kind = name === "categoryId" ? "category" : "channel"; return <label key={name}>{name === "categoryId" ? "Categoría" : "Canal"}<select value={parameters[name] ?? ""} onChange={(e) => setParameters((current) => ({ ...current, [name]: e.target.value }))}><option value="">Selecciona…</option>{resources.filter((item) => item.kind === kind).map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>; })}<button className="cd-button" disabled={busy} type="submit">Preparar preview</button></form></section>;
}

export function PlanPreview({ view, canApprove, busy, onApprove, onInstall, onPublish, publicationId, onRevoke }: { view: PlanView; canApprove: boolean; busy: boolean; onApprove: () => void; onInstall?: (() => void) | undefined; onPublish?: (() => void) | undefined; publicationId?: string | undefined; onRevoke?: (() => void) | undefined }) {
  const plan = view.plan;
  return <section><div className="cd-step"><span>03</span><div><h2>Preview del plan</h2><p>Plan v{plan.planVersion} · vence {new Date(plan.expiresAt).toLocaleString("es")}</p></div></div><div className="cd-summary"><div><strong>{plan.perRecordEffects.length}</strong><span>Efectos</span></div><div><strong>{plan.exclusions.length}</strong><span>Exclusiones</span></div><div><strong>{plan.limits.maxRecords}</strong><span>Límite</span></div></div><div className="cd-table-wrap"><table><caption>Cambios reales derivados del plan materializado</caption><thead><tr><th>Registro</th><th>Operación</th><th>Resultado previsto</th></tr></thead><tbody>{plan.perRecordEffects.map((effect) => <tr key={`${effect.recordId}:${effect.stepId}`}><td>{effect.recordId}</td><td>{effect.capability}</td><td>{effect.expected === "no_op" ? "Sin cambios" : "Añadir asociación"}</td></tr>)}{plan.exclusions.map((item) => <tr key={`excluded:${item.recordId}`}><td>{item.recordId}</td><td>Excluido</td><td>{item.reason}</td></tr>)}</tbody></table></div><div className="cd-actions">{canApprove ? <button className="cd-button" disabled={busy || plan.state !== "ready"} onClick={onApprove}>Aprobar y ejecutar</button> : <p className="cd-note">Tu rol puede revisar este plan, pero el servidor no permite aprobarlo y ejecutarlo.</p>}{onInstall ? <button className="cd-button cd-button--secondary" onClick={onInstall}>Instalar acción</button> : null}{onPublish && !publicationId ? <button className="cd-button cd-button--secondary" onClick={onPublish}>Compartir con catálogo autorizado</button> : null}{publicationId && onRevoke ? <button className="cd-button cd-button--danger" onClick={onRevoke}>Revocar publicación</button> : null}</div></section>;
}

export function ExecutionProgress({ execution, onCancel, onResume }: { execution?: ExecutionView | undefined; onCancel?: (() => void) | undefined; onResume?: (() => void) | undefined }) {
  if (!execution) return <div role="status">Iniciando ejecución…</div>;
  return <section><div className="cd-step"><span>04</span><div><h2>Resultado por registro</h2><Status value={execution.state}/></div></div><div className="cd-table-wrap"><table><caption>Progreso durable de la ejecución</caption><thead><tr><th>Registro</th><th>Estado</th><th>Pasos</th></tr></thead><tbody>{execution.rows.map((row) => <tr key={row.rowId}><td>{row.resourceRef}</td><td><Status value={row.state}/></td><td>{row.steps.map((step) => <span className="cd-step-token" key={step.stepId}>{step.stepId}: {stateLabel[step.state] ?? step.state}</span>)}</td></tr>)}</tbody></table></div><div className="cd-actions">{onCancel && ["queued", "running", "waiting_reconciliation"].includes(execution.state) ? <button className="cd-button cd-button--danger" onClick={onCancel}>Cancelar pasos futuros</button> : null}{onResume && ["partial", "failed", "waiting_reconciliation"].includes(execution.state) ? <button className="cd-button" onClick={onResume}>Reconciliar y reanudar</button> : null}</div></section>;
}

function Library({ installations }: { installations: readonly Installation[] }) { return <section><div className="cd-step"><span>↻</span><div><h2>Acciones instaladas</h2><p>Las ejecuciones repetidas no necesitan volver a generar la receta.</p></div></div>{installations.length ? <div className="cd-card-grid">{installations.map((item) => <article className="cd-library-card" key={item.id}><Status value={item.state}/><h3>{item.displayName}</h3><p>{item.recipeKey} · v{item.version}</p><p>Evidencia: {stateLabel[item.evidenceStatus] ?? item.evidenceStatus}</p>{item.updateAvailable ? <strong>Actualización disponible</strong> : null}</article>)}</div> : <p className="cd-empty">Aún no hay acciones visibles para este usuario.</p>}</section>; }
function EvidenceList({ evidence }: { evidence: Array<{ id: string; status: string; scope: string; verifierVersion: string }> }) { return <section><div className="cd-step"><span>✓</span><div><h2>Evidencia</h2><p>Alcance y versión explícitos; no certifica la API externa.</p></div></div>{evidence.length ? evidence.map((item) => <article className="cd-library-card" key={item.id}><Status value={item.status}/><h3>{item.scope}</h3><p>Verificador {item.verifierVersion}</p></article>) : <p className="cd-empty">No hay evidencia visible o todavía no se ha ejecutado.</p>}</section>; }

export default InternalPanel;
