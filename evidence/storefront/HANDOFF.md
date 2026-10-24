# Personalización del storefront — entrega de integración

La ampliación vive en `feat/buyer-storefront`, worktree `.worktrees/buyer-storefront`. El coordinador fijó alcance y contratos antes de delegar implementación. Backend y UI tuvieron propietarios y worktrees separados; los cambios UI se integran mediante commits. No se ha fusionado sobre el `master` activo de la otra sesión.

## Funcionalidad

- Compradores autenticados guardan preferencias personales de tema, densidad y disposición grid/list. Los overrides son parciales; restablecer recupera la herencia global. Preview y guardado son acciones distintas.
- Las propuestas globales son recursos independientes e inmutables. Solo un administrador vigente de la misma tienda puede aprobarlas. Proponer o rechazar no cambia la tienda; aprobar conserva los overrides personales.
- Identidad buyer separada de roles staff, reautorización del host por petición, CAS e idempotencia, RLS, cuotas y validación de valores finitos. No se ejecutan CSS, HTML, código ni URLs aportados por compradores.
- Subpath opt-in `@changedesk/react/storefront`, CSS exportado, cliente/provider/panel personal y cliente/panel administrativo separados. Se conserva la entrada principal del SDK.
- Extensión Medusa con bootstrap customer por cookie, registro opaco de sesión y comprobación del almacén nativo; ruta administrativa `/app/changedesk-storefront`.

Contrato normativo y decisiones: [docs15](../../docs/15-BUYER-STOREFRONT.md), apéndices de docs00/docs10, schemas `contracts/storefront-*` y copias empaquetadas. No hay dependencias nuevas ni quinto workspace. Esta ampliación no necesita un proveedor LLM.

## Coordinación de integración

Baseline congelado: `6adbb2f`. La rama ya absorbió snapshots anteriores del SDK principal; no aplicar a ciegas todos los commits históricos como cherry-picks. Revisar `git diff 6adbb2f..feat/buyer-storefront` y resolver contra el HEAD vigente de la sesión principal en un punto limpio.

Archivos compartidos que necesitan revisión del integrador:

- `apps/service/src/api.ts`, `api/server.ts`: registro de rutas y autenticador buyer.
- `packages/contracts/src/index.ts`: exports storefront; schemas nuevos.
- `packages/sdk-react/package.json`, `vite.config.ts`: subpaths y build de múltiples entradas, sin sustituir la entrada principal.
- `packages/medusa-plugin/src/api/middlewares.ts`, `bridge/native-guard.ts`, `bridge/native-policy.ts`: bootstrap/reautorización y logout customer conservando revocación staff.
- `vitest.config.ts`: selector explícito del gate PostgreSQL real; ausencia del entorno no se etiqueta PASS ni skip.
- `docs/00-DECISIONS.md`, `docs/10-API-AND-SDK.md`: apéndices storefront.

Migración reservada `1000_storefront_v1.sql`, posterior al stack001–013 probado. No renumerar ni reescribir migraciones aplicadas. La reserva inicial010 colisionó con la otra sesión y se corrigió antes de desplegar fuera de bases efímeras (ADR-SF005). Si la rama principal añade migraciones posteriores, comprobar el stack combinado antes de aplicar1000.

Dos correcciones previas de tipos se trajeron de la rama principal en commits separados: `b6b68b1` (hunk de parseStructuredIntent desde `a10ed1c`) y `e8a4e5b` (cherry-pick de `3ddb1e3`, tipos portables del harness Fastify). No son cambios funcionales de storefront.

## Evidencia y límites

Las pruebas se separan por capa. Los doubles de autenticación y el navegador con fixture no prueban integración real con Medusa.

| Capa | Resultado registrado | Evidencia |
|---|---|---|
| Backend Fastify y autenticación | RED/GREEN por comportamiento | `tdd-red.json`, `backend-green.json`, `auth-*`, `api-wiring-*`, `host-config-tdd.json` |
| Herencia, cola pendiente y validación | Regresiones RED/GREEN | `inherited-*`, `pending-queue-tdd-red.json`, `revision-validation-tdd.json` |
| Sesiones en memoria | Capacidad, concurrencia y expiración RED/GREEN | `session-capacity-tdd.json` |
| PostgreSQL real | 7/7 PASS; repetido independientemente por coordinador en e8a4e5b | `postgres-green.json`, `review-1.json` |
| SDK y navegador fixture | Tests DOM/cliente, capturas desktop/mobile/admin | `sdk-*.json`, `ui/` |
| Consumo desde tarballs reales | Instalación aislada offline, tipos, imports, CSS y peers PASS | `sdk-tarball-consumer.json` |
| Medusa Atlas/Boreal + navegador real | BLOCKED | `medusa-live-gate.json` |

PostgreSQL se probó tras implementar persistencia: no se presenta como storage TDD. El runner usa base y rol propios por runId, rol nonowner y RLS forzada; comprueba el proyecto Compose y exige bandera de cleanup. Los siete casos cubren aislamiento, CAS/idempotencia, propuesta sin efecto, conservación de overrides, constraints/cuotas, cola pendiente y replay durable buyer. Base y rol temporales se eliminaron correctamente.

El tarball se probó sobre el SDK integrado de e63f497, antes de ajustes posteriores de textos e invalidación admin. Acredita instalación y exports; no es un artefacto publicado ni una prueba live de esa revisión final. Ver los SHA de los tarballs en su evidencia.

Primera revisión fresca read-only sobre e8a4e5b: `fix-first`; encontró limpieza del panel admin, falta de límite/barrido de sesiones buyer y revisiones negativas. Informe conservado en `review-1.json`. Los arreglos y el veredicto final se registran por separado, sin sobrescribir el fallo inicial.

## Reproducción local

Desde este worktree, con las herramientas ya fijadas en `.worktrees/environment`:

```powershell
& '..\environment\.tools\node-v22.23.4-win-x64\node.exe' node_modules/vitest/vitest.mjs run tests/storefront tests/medusa/native-guard.test.ts tests/medusa/storefront-logout-middleware.test.ts tests/planner/generation-worker.test.ts --reporter=dot --pool=threads --maxWorkers=1
& '..\environment\.tools\node-v22.23.4-win-x64\node.exe' node_modules/typescript/bin/tsc -p apps/service/tsconfig.json --noEmit --pretty false
powershell -NoProfile -ExecutionPolicy Bypass -File tests/storefront/run-postgres-live.ps1 -ConfirmScopedCleanup
```

No ejecutar instalaciones automáticas desde worktrees sobre la instalación compartida; el otro coordinador gestiona ese entorno. El runner PG no reinicia contenedores ni limpia bases ajenas. Nunca copiar credenciales al repo.

## Paso pendiente para integración real

La sesión principal debe terminar de arrancar Atlas9001/Boreal9002 y el servicio4100, integrar el plugin/SDK y ejecutar la receta de `medusa-live-gate.json` con clientes sintéticos autenticados por cookie. Debe comprobar logout nativo, cambio de customer, aislamiento entre tiendas, preferencia persistida tras recarga, propuesta sin efecto y aprobación administrativa conservando overrides. La comprobación independiente más reciente encontró los tres puertos no disponibles.

La ampliación no acredita `LOCAL_VERIFIED`, `LIVE_VERIFIED` ni la finalización de todo el piloto según docs11. Por instrucción posterior del usuario, los objetivos de rendimiento quedan fuera de este cierre: no se ejecutan benchmarks ni se bloquea por presupuestos de latencia. Permanecen las comprobaciones funcionales y de autoridad.
