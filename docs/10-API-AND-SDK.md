# API pública y SDK

La ampliación storefront v1 y sus rutas/identidades separadas se especifican en [15-BUYER-STOREFRONT.md](15-BUYER-STOREFRONT.md). Export SDK opt-in `@changedesk/react/storefront`; no cambia la autoridad ni contratos de catálogo de las rutas siguientes.

Contrato normativo propuesto. Una implementación futura debe producir OpenAPI 3.1 real a partir de las rutas y validadores. No inventar una OpenAPI completa que parezca ejecutable antes de construir los handlers.

## SDK React v1

Exportar `ChangeDeskProvider`, `ChangeDeskLauncher`, `ChangeDeskPanel`, `ChangeDeskAction` y tipos públicos. El launcher no carga el panel/LLM hasta interacción. Usar React como peer dependency y CSS encapsulado sin reset global. No observar ni parchear el DOM de Medusa. Crear una UI route de extensión para selección múltiple y un widget soportado para acceso contextual.

El cliente usa `fetch`, `crypto` y `AbortController` nativos. Importa los contratos TypeScript como type-only y carga schemas solo cuando una función explícita lo requiere; Ajv y el SDK Medusa no entran en el bundle del SDK por defecto. Vite se usa únicamente para el bundle browser/librería exigido, no como orquestador general.

Configuración pública del provider:

```ts
type ChangeDeskConfig = {
  endpoint: string; // fijado por desarrollador; no por prompt
  getSession: () => Promise<{ accessToken: string; expiresAt: string }>;
  locale: "es" | "en";
  getContext: () => { selectedProductIds: string[]; surface: string };
  onEvent?: (event: SafeUiEvent) => void;
};
```

`getSession` usa el bridge del host y nunca lee una API key privilegiada. Mantener accessToken en memoria, no localStorage, no logs. El contexto es una sugerencia no confiable: todo ID y selección se reautoriza en backend. No confiar en roles/config de cliente. `endpoint` se valida contra configuración del despliegue, no se convierte en permiso para SSRF. No permitir personalizar ejecutores desde la configuración del navegador.

Eventos UI mínimos: `panel_opened`, `candidate_offered`, `candidate_selected`, `plan_ready`, `execution_updated`, `action_installed`, `error`. Payload solo IDs opacos y estado permitido; no prompts, tokens ni productos completos por defecto. Exportar callback de telemetría opt-in; sin trackers externos incorporados.

Métodos imperativos del cliente: `createRequest`, `getRequest`, `selectCandidate`, `createPlan`, `approvePlan`, `startExecution`, `getExecution`, `cancelExecution`, `getInstallations`. SDK no tiene `executeCode`, `rawFetch`, `setTenant` ni `grantRole`. Componentes no asumen que quien ve el panel pueda aprobar.

## Transporte y errores

HTTPS fuera de localhost; JSON UTF-8. Bearer de sesión corta y `Idempotency-Key` para mutaciones de control; CSRF y Origin verificados en el bridge basado en cookies. Body máximo inicial 64 KiB salvo endpoint de receta con límite específico; message 4.000 caracteres. No IDs de tenant en URL/cuerpo de estas rutas: tenant/actor provienen de sesión verificada y recursos recuperados con su ámbito.

Errores uniformes: `{ error: { code, message, requestId, retryable, details? } }`. details no revela objetos de otro tenant, prompts de otros usuarios, secretos ni stack. 400 formato, 401 sesión, 403 acción prohibida, 404 recurso ausente o fuera de ámbito, 409 stale/conflict, 413 tamaño, 422 validación, 429 cuota con Retry-After, 503 dependencia no disponible. No reintentar ciegamente una escritura por `retryable`; usar clave/ledger y reconciliación.

Paginación con cursor opaco ligado a tenant, actor/scope y query; límite ≤50. Búsqueda/caché también autorizadas. Respuestas privadas `Cache-Control: no-store`. CORS allowlist de orígenes exactos. El MVP obtiene progreso por polling HTTP con backoff/jitter (2 s activo, 10 s en segundo plano); no expone SSE ni WebSocket.

## Rutas mínimas

| Ruta | Entrada / resultado | Autoridad |
|---|---|---|
| `POST /v1/session/exchange` | Ticket efímero del bridge → sesión | Firma/audiencia/nonce/tenant/actor verificados; ticket de un uso |
| `POST /v1/requests` | request.schema → 202 `{requestId,status}` | requester/operator/admin; sin escrituras Medusa |
| `GET /v1/requests/:id` | Estado, mensaje seguro, candidatos | Actor dueño o rol autorizado, mismo tenant |
| `POST /v1/requests/:id/messages` | message + clientRequestId → 202 | Misma conversación autorizada; no aceptar role=system/tool |
| `GET /v1/requests/:id/candidates` | Ofertas con compatibilidad y coste estimado | Solo catálogo visible autorizado |
| `POST /v1/requests/:id/candidate` | candidateId + version + choice reuse/adapt | Selección explícita; revalidar visibilidad |
| `GET /v1/resources/:kind` | Opciones finitas category/channel configuradas por admin del servidor | Solo IDs de la allowlist server-side; recuperar detalle mediante capacidades `retrieve` declaradas. No listado arbitrario, URL libre ni capacidades `list` no declaradas |
| `POST /v1/plans` | requestId/installationId, selección y parámetros → 202 | Revalidar recursos y generar preview privado |
| `GET /v1/plans/:id` | planHash, versión, efectos, exclusiones, evidencia, expiry | ACL del plan; jamás publicarlo en catálogo |
| `POST /v1/approvals` | approval-request.schema → approvalId | operator/admin autorizado para todos los efectos |
| `POST /v1/executions` | approvalId + idempotencyKey → executionId | Aprobación válida, usuario aún autorizado, cuota disponible |
| `GET /v1/executions/:id` | Estado/resumen por registro | Ámbito del tenant y permiso de lectura |
| `POST /v1/executions/:id/cancel` | cancelación idempotente | Dueño autorizado/operator/admin; frena nuevos pasos |
| `POST /v1/executions/:id/resume` | resolución/reintento seguro del mismo ledger | Reautorizar; no salta unknown ni aprobación expirada |
| `GET /v1/installations` | Instalaciones, ofertas autorizadas e identidad de presentación del usuario (ADR-010/011) | Scope + grants vigentes + firma/compatibilidad + política actual |
| `POST /v1/installations` | artifactHash + configuración validada | admin; fija versión, nunca copia datos de origen |
| `POST /v1/installations/:id/disable` | deshabilitar nuevas ejecuciones | admin; reconciliar en curso |
| `POST /v1/publications` | artifactHash + visibility + consentimiento | admin con derecho a compartir; revisión de contenido genérico |
| `POST /v1/publications/:id/withdraw` | retirar oferta de nuevas instalaciones | publicador autorizado |
| `POST /v1/publications/:id/revoke` | security_revoked + razón | publicador/operador plataforma autorizado; nuevos pasos bloqueados |
| `GET /v1/evidence/:id` | Evidencia redactada según permisos | Tenant scope; evidencia compartida solo si genérica aprobada |

Los nombres de tablas pueden cambiar mediante ADR; los endpoints y tipos públicos cambian solo con versión o migración documentada. Viewer no puede mutar aunque conozca IDs. Requester no puede approve/execute. Un admin tampoco puede convertir texto recuperado en autoridad.

## Plan privado y aprobación

El servidor materializa un plan: `id`, `schemaVersion`, `tenantId`, `actorId`, `requestId`, `artifactHash`, `adapterVersion`, `policyVersion`, `capabilityManifestHash`, `parameters`, `selectionSnapshot`, `perRecordEffects`, `exclusions`, `limits`, `createdAt`, `expiresAt`, `planVersion`, `planHash`, `evidenceRefs`.

No almacenar valores completos de precio/stock si un digest y lecturas puntuales bastan para el oráculo; los fixtures pueden conservar snapshots completos ficticios para tests. El hash cubre identidad/ámbito, selección normalizada, parámetros, efectos, precondiciones, política, versiones y límites. Orden de arrays semánticos se normaliza explícitamente antes de JCS.

Aprobación inmutable del mismo hash. Unique de negocio `(tenantId, planId, planVersion, actorId)`, independiente de `idempotencyKey`; la clave HTTP conserva su propio registro `(tenantId, actorId, operation, idempotencyKey)`, y repetirla con body distinto produce 409. Crear ejecución y consumir la aprobación en la misma transacción, con unique de ejecución `(tenantId, planId, planVersion)`: dos pestañas con claves distintas no crean dos ejecuciones. Un nuevo uso de la función requiere nuevo plan/aprobación; no reutilizar autorización histórica.

El plan es privado y ligado al actor que lo creó. Un requester no puede delegar su plan/hash/chat a un operator para aprobarlo. Cuando la propuesta aún no está instalada, un admin instala el artefacto genérico validado; entonces el operator crea una petición y un plan nuevos bajo su propia identidad y revisa un preview recién calculado antes de aprobar.

TTL inicial: bridge ticket60s de un uso; sesión5min; aprobación10min o menos si plan expira. Revocación de actor/política invalida autoridad aunque el JWT no haya caducado. En workers revalidar antes de cada efecto; un mensaje de cola no es un permiso. El reloj de servidor gobierna; los tests inyectan tiempo.

`POST /v1/executions/:id/resume` continúa el mismo ledger únicamente mientras aprobación, plan, política y precondiciones sigan vigentes. Si cualquiera expiró o cambió, el servidor impide efectos nuevos, reconcilia primero pasos `unknown` y termina la ejecución antigua como `partial` o `failed` según los efectos observados. Continuar requiere crear por las rutas existentes un plan nuevo con `priorExecutionId` que incluya solo efectos aún ausentes, seguido de preview, aprobación y ejecución nuevos; no se añade una API especial, no se repiten efectos confirmados y no se altera el plan histórico.

## Planificador y adaptador

Interfaz del planner: entrada redactada y estructurada + capabilities aprobadas → candidato IR o `needs_clarification`/`unsupported`. No recibe credenciales ni herramientas mutadoras. Output validado contra JSON Schema, semántica, autorización y compatibilidad. Reintentos de generación acotados y contabilizados; salida inválida no se ejecuta.

`proofRequired` no pertenece a esa IR. Es una decisión de política confiable calculada por el servidor, que planner y navegador no pueden fijar ni rebajar, y queda vinculada a `policyVersion`, `planHash`, alcance y evidencia aplicable.

Interfaz adapter conceptual: `describeCapabilities()`, `authorize(actor, operation, resources)`, `read(...)`, `preview(...)`, `executeAuthorizedStep(...)`, `reconcile(...)`. Origen del backend y credenciales provienen del registro de tenant en servidor. El adapter registra efectos observables; nunca declara éxito a partir del mensaje del LLM.

Estados, límites y capacidades canónicas están en [00-DECISIONS.md](00-DECISIONS.md). La seguridad exacta de host ticket/firma y frontera Medusa está en los documentos de integración y seguridad. Un endpoint proxy genérico o una API key admin global invalidan este contrato.
