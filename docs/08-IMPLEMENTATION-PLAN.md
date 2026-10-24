# Plan de implementación de principio a fin

Objetivo final: SDK real instalado dentro de dos Medusa locales, chat conectado a proveedor real cuando esté disponible, varias funciones y usuarios, reutilización autorizada, pruebas y evidencia. No se acepta como entrega final una página con un chat simulado ni un mock de Medusa.

Cada fase: diseñar un test de comportamiento que falle por la razón correcta; implementar; pasar el gate; registrar evidencia. Puede paralelizarse trabajo sobre contratos ya fijados, no saltarse dependencias. No estimar horas como garantía.

## P0 — Entorno y spike de viabilidad

**Propietarios:** coordinador + agente Medusa.

- Inventariar herramientas disponibles sin leer secretos. Verificar Docker Engine/Compose; Node LTS compatible con Medusa; pnpm y Python para harness si procede.
- Pin candidato Medusa `2.22.1`; confirmar paquete publicado y documentación del mismo tag. Fijar todos los paquetes Medusa a versión coherente y registrar imagen/digest, Node y lockfile. Si pin no instalable, ADR antes de cambiar.
- Crear exactamente los cuatro workspaces de `../contracts/technology-profile.json`, Git local si falta, `.gitignore` y `.env.example` sin valores secretos. Compose mínimo con nombres/volúmenes propios y bind localhost: un único source/build Medusa ejecutado dos veces, un único artefacto Change Desk con entrypoints API/worker y un servidor PostgreSQL con tres bases/roles/secretos.
- Fijar versión exacta compatible de Node LTS. Configurar pnpm, `tsc -b` y Vite solo para browser/librería o donde Medusa lo exija. Verificar Ajv 8 Draft 2020-12 explícito; no confiar en el dialecto default de Fastify.
- Demostrar login de usuario, extensión UI actual, lectura de producto y asociaciones categoría/canal usando APIs reales. Probar readback y comportamiento repetido de add. Registrar request/response redactados.
- Probar política de usuarios restringidos directamente contra API nativa Medusa. Enumerar rutas públicas/mutadoras y caminos alternativos que afecten invariantes, no solo dos endpoints del SDK.
- Definir garantía implementable ante concurrencia: si exige guard transaccional en host, implementarlo y probarlo antes de declarar aislamiento fuerte. No basta mutex del proceso del runner.

**Gate:** capacidad nativa real observada, permisos y límites conocidos, ambiente reproducible. Si falla, corregir adapter/alcance mediante ADR; continuar tareas independientes del bloque.

## P1 — Contratos, núcleo y persistencia

**Propietarios:** módulos internos core + storage dentro de `apps/service`; root controla contratos/migraciones.

- JSON Schema + validación semántica de recetas, objetos inmutables, canonical hashing, validación inputs, manifiesto de capacidades registrado por servidor.
- Modelos request/recipe/installation/plan/approval/execution/evidence y migraciones SQL numeradas pequeñas con checksum/advisory lock; RLS y FKs compuestas por tenant. Usar `pg` y SQL parametrizado, sin ORM/query builder ni framework de migraciones.
- Interfaces planner/adapter/policy/evidence/provider fake; los fakes se etiquetan como tales.
- Crear fixtures ficticios y oráculo de estados independiente.

**Gate:** tests de schema, autorización, referencias, aciclicidad, caps, hash, RLS y rechazo cross-tenant con PostgreSQL real. No exponer todavía mutaciones a planner.

## P2 — Primer corte vertical sin generación live

**Propietarios:** adapter + runner + UI con contrato congelado.

- Una receta fixture campaign, una tienda y un operador.
- Panel integrado → elegir parámetros y productos → preview → aprobar → job durable → categoría → canal → readback → resultados por registro.
- El runner consume plan materializado, no reinterpreta lenguaje natural.
- Aprobación y start idempotentes; segunda petición idéntica retorna mismo resultado/ejecución.

**Gate:** Playwright sobre Medusa real, 5 elegibles y 3 excluidos, 3 adiciones de cada asociación, producto ya asociado no-op. Base final coincide con oráculo; se conservan invariantes. Esto es solo `pipeline_fake_verified`, no SDK live completo.

## P3 — Worker confiable y varios usuarios

**Propietarios:** runtime + security.

- Una tabla SQL `jobs` con kind generation/execution/reconcile, leases, fencing, heartbeats, timeouts, cuotas, fairness y recuperación. Insertar request/ejecución + job en la misma transacción; worker por polling con jitter, sin outbox, LISTEN/NOTIFY, librería de cola, Redis o Temporal.
- Fault hooks in-process antes de write, después de write antes de receipt, caída worker, sesión revocada, plan stale, cambios concurrentes y cancelación. Mantener el gate real de respuesta perdida post-commit contra Medusa; no hacer obligatorio un proxy de fallos.
- Implementar los cuatro roles y ocho cuentas, guard nativo, revalidación por efecto, límites de egress. Interfaz muestra parcial/unknown sin inventar éxito.

**Gate:** suite recovery/security real y casos directos API nativa. Un timeout no duplica efectos ni autoriza ejecución por otro tenant. Un worker vencido no puede marcar ledger exitoso; efectos remotos tardíos requieren reconciliación.

## P4 — Catálogo, funciones persistentes y segunda tienda

**Propietarios:** reuse + frontend.

- Instalaciones privadas con referencias a artefacto, configuración separada y acciones visibles por política.
- Atlas/Boreal con bindings distintos; publicación admin explícita de plantilla saneada, firma, catálogo permitido, oferta al solicitante, instalación admin y aprobación operator.
- Exact match sin LLM cuando identificable mediante acción/contrato estructurado; petición de texto ambigua puede necesitar interpretación y debe contabilizarse. No afirmar cero LLM para cualquier búsqueda en lenguaje natural.
- Matching compatible configurado antes de adaptar/generar, private default, revocación/retirada, no leak de embeddings/nombres/conteos.

**Gate:** segunda tienda instala el mismo artifactHash cuando es compatible, pero usa IDs/secretos/config diferentes. Petición no autorizada no revela candidato. Petición realmente diferente selecciona o crea receta category-only/channel-only; ningún cambio se cuela en una instalación fijada.

## P5 — Chat y planner real

**Propietarios:** planner + frontend; security revisa frontera.

- Provider neutral con configuración externa, timeouts, token/cost budgets y contadores. Reintentos limitados; sin key ejecutar modo fake claramente indicado y dejar gate live bloqueado.
- Chat con aclaraciones, recursos autorizados, candidatos y límites, streaming opcional. Texto recuperado no es instrucción privilegiada.
- Generación estructurada de las tres formas permitidas y UI declarativa; invalid/unsupported rechaza con explicación. No acceder a shell/red libre ni herramientas mutadoras desde el planner.
- Preservar conversación privada y redactar contexto; no enviar inventario entero ni historial de otros tenants.

**Gate:** live end-to-end con peticiones en español diferentes y paráfrasis, matching, preview, aprobación y efectos correctos. Guardar proveedor/modelo/fecha/semilla si existe/tokens/coste/latencia, no secretos. Fake y live tienen evidencia separada.

## P6 — Ataques dirigidos por cambios y Bend

**Propietarios:** security + eval + agente leyes.

- Diff de recipe/adapter/policy/model → obligaciones afectadas → regresión y nuevos ataques. Conservar baseline completo periódico y holdout; selección incremental no sustituye cobertura global.
- Harness paired clean/attack con oráculo externo, cobertura por superficie, métricas ASR y utilidad, fallos críticos y costes. Ataques solo entorno sintético aislado.
- Adaptador Bend: modelo puro de selección/asociación y leyes de preservación/no duplicado/no cruce de scope. Guardar fuentes, versiones, hash, verdict y boundary. Fixture con ley falsa debe fallar.
- Integración del proof result en evidencia del plan; `proofRequired` bloquea si falta prueba. Flujo que no exige prueba muestra unavailable/not_applicable honestamente y depende de controles runtime verificables.

**Gate:** benchmark determinista + live, cero efectos críticos observados en corpus (no garantía universal); Bend real o gate experimental bloqueado explícito. No contabilizar una prueba generada pero no ejecutada como passed.

## P7 — Coste, overhead y ergonomía

**Propietarios:** performance + integrador independiente.

- Medir bundle launcher y panel gzip, duplicación React, parse time, idle network, memoria/CPU, throughput y latencia con entorno registrado.
- Comparar ejecución directa de las mismas operaciones Medusa frente SDK; separar preview/planificación/reconciliación del coste del backend. Carga bajo límites; colas no crecen sin control.
- Confirmar ninguna llamada LLM en repetición de acción instalada; reportar búsqueda/interpretación por separado.
- Agente integrador desde checkout limpio sigue quickstart y mide cambios/archivos/minutos/incidencias. Contar guard y adapter, no solo líneas de JSX.

**Gate:** objetivos de docs05/06 medidos; si no se alcanzan, ajustar implementación o documentar límite y decisión, no reescribir métricas para pasar.

## P8 — CI, empaquetado y cierre

**Propietarios:** CI + reviewer fresco + root.

- Activar plantilla CI solo tras scripts reales y SHAs/digests fijados. Lint/types/unit/property/integration/Medusa E2E/security/recovery. Live separado con secrets y presupuesto, jamás en PR no confiable.
- Construir paquetes SDK con exports/types y smoke install desde tarball en app Medusa limpia; workspace linking no basta para probar distribución.
- Verificar bundle: launcher ≤15 KiB gzip y panel lazy ≤150 KiB gzip como objetivos duros aún no medidos; ≤60 KiB panel es stretch. Informar medida excluyendo peers y total all-in.
- Migración up/restart comprobada, backup/restore local cuando forma parte del flujo, retención y revocación verificadas.
- Documentar arranque/parada/seed/reset únicamente proyecto, URLs y modo fake/live. Crear video/capturas demostrativas y FINAL-REPORT.
- Council read-only sobre diffs/evidencia; corregir fallos, reejecutar pruebas afectadas y emitir nuevo veredicto.

**Gate:** todos los ACC aplicables con evidencia real, limitaciones explícitas y cero bloqueantes ocultos. Si faltan credenciales o Bend, no decir «todo verificado»: indicar estado de cada gate.

## Árbol objetivo mínimo de código

```text
apps/service/                    un source/build/imagen; entrypoints api y worker
  src/{core,policy,storage}/     módulos internos, no paquetes/deploys
  src/{planner,adapter}/         módulos internos, no paquetes/deploys
  src/{evals,laws}/              evaluación y Bend on-demand, no daemon
  migrations/                    SQL numerado + checksums + advisory lock
packages/contracts/              JSON Schema 2020-12 + tipos públicos
packages/sdk-react/              native fetch/crypto/AbortController + UI lazy
packages/medusa-plugin/          UI host + bridge + guard + capacidades
examples/medusa/                 un source/build ejecutado como Atlas y Boreal
tests/                           suites lógicas Vitest + Playwright
infra/                           Compose y health checks mínimos, sin fault proxy
scripts/                         bootstrap, seed, verify, teardown acotado
evidence/                        resultados redactados, manifiestos, reportes
```

Solo `apps/service` y los tres `packages/*` son workspaces. `examples/medusa`, tests, infra, scripts y evidence no lo son. No crear paquetes para core/policy/storage/planner/adapter/evals/laws. Fastify, `pg` y Ajv 8 son las dependencias runtime propias iniciales; `jose` solo si las primitivas verificadas no bastan. Sin DI container, LangChain, embeddings, vector DB, Nx/Turbo, runtime genérico de agentes, SSE/WebSocket, S3/CDN u OpenTelemetry collector. Cada dependencia nueva exige carencia observada, alternativas y decisión.
