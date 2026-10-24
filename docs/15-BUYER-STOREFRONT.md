# Storefront personalizable por compradores

Estado: contrato v1 aceptado por el coordinador el 2026-10-24 tras revisión independiente; implementación y gates pendientes. Solicitud del usuario amplía el alcance originalmente administrativo. Rama `feat/buyer-storefront`; baseline de integración `325c81e`. No implica completar ni sustituir los gates del SDK principal.

## ADR-SF-001 — Alcance y autoridad

Compradores autenticados personalizan presentación dentro de capacidades finitas: `theme: light|dark|system`, `density: comfortable|compact`, `productLayout: grid|list`. No se modifica catálogo, precios, inventario, carrito, checkout, permisos ni código. No se admiten HTML, CSS, JavaScript, URLs, schemas aportados por usuario/modelo ni nuevos componentes en runtime. No hace falta LLM para configurar estas preferencias. Anónimos, personalización mediante lenguaje natural y nuevas capacidades quedan fuera de esta primera ampliación y no se representan como implementados.

Identidad comprador separada de `ActorRole` administrativo. `BuyerContext` incluye discriminante `kind: buyer`, tenant, buyerId, hostSessionId, policyVersion, expiración; todos proceden de autenticación/reautorización de servidor. No añadir `buyer` a los roles viewer/requester/operator/admin ni convertir un customer en requester. Tickets/sesiones storefront usan dominio y audiencia propios; los tokens administrativos y de comprador se rechazan mutuamente. Reutilizar criptografía revisada es aceptable; reutilizar autoridad no.

Los cambios personales no requieren aprobación administrativa: solo afectan al comprador autenticado dentro de su tienda. La propuesta global es otro recurso y exige consentimiento explícito de envío y aprobación de un administrador vigente del mismo tenant. No se comparte conversación, fila personal ni plan privado. Aprobar no concede permisos al comprador.

## ADR-SF-002 — Preferencias y concurrencia

Guardar overrides parciales por `(tenantId,buyerId)`. Precedencia por campo: override personal > valores globales del tenant > defaults del producto (`system`, `comfortable`, `grid`). Ausencia de clave significa heredar; PUT reemplaza el objeto completo; `{}` restablece herencia. No aceptar `null` para evitar dos semánticas de borrado. Conservación de una revisión monotónica incluso al restablecer, evitando ABA.

GET `/v1/storefront/me/preferences` devuelve `{overrides,effective,buyerRevision,globalRevision}`. PUT misma ruta recibe exclusivamente `{expectedRevision,overrides}` y `Idempotency-Key` UUID. Identidad nunca en URL/body/query. CAS atómico: revisión obsoleta => 409 sin efectos. Replay mismo actor/operación/key/body => misma respuesta; misma key con otro body => 409. Lectura y respuesta privadas `Cache-Control: no-store`.

## ADR-SF-003 — Cambios globales revisados

POST `/v1/storefront/global-change-proposals` recibe `{baseGlobalRevision,proposed}` más Idempotency-Key. `proposed` es un objeto completo con los tres campos permitidos. Crea propuesta inmutable `pending`, sin cambiar preferencias globales ni personales. Rechazar base global obsoleta. GET `/v1/storefront/global-change-proposals/:id` permite al comprador ver únicamente propuestas propias; ajena/ausente => mismo 404. Admisión acotada por cuota de propuestas pending por comprador/tenant; valores iniciales 5/100.

Rutas staff bajo `/v1/storefront/admin/global-change-proposals`: GET lista acotada a 50; GET `/:id` devuelve preview derivado de datos del servidor. POST `/:id/approve` recibe `{expectedProposalRevision,expectedGlobalRevision}`; POST `/:id/reject` recibe `{expectedProposalRevision}`. Todas las mutaciones requieren Idempotency-Key. Solo admin vigente del mismo tenant, reautorizado en cada petición. Buyer nunca puede acceder a estas rutas aunque conozca IDs.

Preview administrativo incluye `proposalId`, revisión, valores actuales/propuestos, revisión global y aviso de precedencia: los overrides personales se conservan. El contenido propuesto no cambia; propuesta stale requiere nueva propuesta/preview, no aprobación que silenciosamente rebase datos. La aprobación liga identidad administrativa, tenant, propuesta inmutable y revisiones; CAS/transacción aplican actualización global + estado approved + registro de decisión + idempotencia atómicamente. Doble aprobación no duplica efecto. Reject no cambia globales. No existen rutas de escritura global directa sin aprobación.

La aprobación aquí es una operación local sobre configuración, no la aprobación de un plan de catálogo. Se conserva intacto D22: ningún admin/operator ejecuta un plan privado de un comprador. No se añaden jobs ni capacidades Medusa para preferencias propias del SDK.

## Integración y ownership

Exactamente cuatro workspaces. Nuevos tipos/schemas en `packages/contracts` y `contracts/storefront-*`; módulo interno `apps/service/src/storefront`; UI/cliente en `packages/sdk-react/src/storefront`; frontera customer en `packages/medusa-plugin/src/storefront` y ruta store explícita si la API del pin queda verificada.

Export público `@changedesk/react/storefront`: cliente finito, provider/hook, controles accesibles y raíz de presentación opt-in. Configuración endpoint/getSession consistente con SDK vigente; sin setter de tenant/actor/rol, rawFetch ni mutadores administrativos en cliente buyer. Cliente admin separado usa sesión staff. No parchear DOM fuera de raíz; tokens solo en memoria; cambio de sesión/invalidation limpia datos y respuestas tardías. UI distingue “Solo para mí”, “Restablecer mis preferencias” y “Proponer para toda la tienda”; nunca presenta propuesta pendiente como aplicada. Preview local no guarda hasta acción explícita. Errores 409 requieren recarga/revisión.

Backend: registrar rutas mediante módulo explícito en la API existente, sin nuevo proceso/servicio. Almacén PostgreSQL parametrizado, RLS forzada y contexto transaccional tenant+buyer separado del actor staff; tablas propias con prefijo storefront, CAS e idempotencia durables. Migración nueva asignada exclusivamente al implementador y numerada sin colisión tras inspección. No alterar migraciones previas. Adaptadores de prueba en memoria deben quedar solo en tests y etiquetados como tales.

El implementador posee únicamente nuevos módulos/contratos/tests storefront y su evidencia en esta rama. Cambios imprescindibles en manifests, exports, config Vite, middleware/entrypoints se entregan en commit de integración separado; no cambia lockfile/dependencias ni archivos de otros worktrees. El coordinador conserva este documento y apéndices docs00/10. No fusionar sobre master activo de la otra sesión.

## Verificación requerida

TDD por comportamiento con fallo esperado y green registrados. Probar handlers reales Fastify y efectos persistidos, distinguiendo test de repositorio mock de PostgreSQL real. Casos: personal entre dos buyers y dos tenants; spoof/unknown fields; token buyer/staff cruzado; revocación; CAS concurrente; idempotencia de cuerpo igual/distinto; propuesta sin efecto; admin único aprobador; stale/rechazo sin efecto; global no pisa overrides; reset hereda; XSS/URL/código rechazados; no-store; cuotas; logout/cambio de sesión y respuestas tardías; errores y navegación teclado.

Gates separados: unit/contrato backend, SDK DOM, PostgreSQL/RLS real, auth customer Medusa real, browser E2E dos tiendas y empaquetado subpath. No sustituir integración real por fixture ni declarar LOCAL_VERIFIED según docs11 con solo Fastify/mocks. Si infraestructura/host en implementación concurrente no permite gate live, completar lo independiente y documentar BLOCKED/NOT_RUN y pasos exactos. Sin proveedor LLM nuevo ni gastos.

Hipótesis cuestionada y resuelta: snapshot completo de preferencias impediría herencia futura; se usan overrides parciales. Aprobar “la versión actual” sin modelar precedencia sería engañoso; preview conserva y explica overrides. Código y UI en otra sesión siguen cambiando: la integración se revisará contra HEAD observado, nunca se fuerza sobre sus cambios sin commit/handoff.
