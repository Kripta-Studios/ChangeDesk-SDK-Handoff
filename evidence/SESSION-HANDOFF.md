# Estado de implementación

2026-10-24. EN CURSO. Aún no LOCAL_VERIFIED, LIVE_VERIFIED ni PILOT_COMPLETE. Leer Git antes de integrar. Este estado sustituye el historial acumulativo anterior.

## Entorno y propiedad

Repo master local, baseline8cfc8c0, sin remotos. Solo esta carpeta/worktrees. Conservar sesión independiente buyer-storefront y su documento sin integrar cambios parciales. Overrides solicitados Sol6.1/high implementación y Astra/high asesoría/revisión, fork none; spawn no confirma modelo observado ni modelo root.

Environment es único propietario de manifests/lock/tooling/scripts/infra. Medusa posee backend plugin/host/seed. Frontend SDK/admin/E2E. Runtime API/adapter/worker y temporalmente storage/migrations.ts + test checksum. Core núcleo/leyes/CI/perf. Planner/storage terminaron. Root documentos/aceptación/integración. Asesor Astra integration_advisor es solo lectura y NO reviewer final. No escritores concurrentes.

Node22.23.4 en `.worktrees/environment/.tools/node-v22.23.4-win-x64/node.exe`, pnpm11.22.0; evitar Node25 sistema. Environment reparó root TypeScript5.9.3 y verificó Vitest4.0.16 con frozen install limpio. No usar pnpm desde worktrees: auto-installs causaron corrupción parcial. Chromium156rev1248 en environment .tools/ms-playwright. Docker29.4.2/PG17.11 real, proyecto changedesk-sdk-local, contenedor changedesk-sdk-local-postgres-1, puerto5432; DBs changedesk/atlas/boreal, roles separados no SUPER/BYPASS. Secretos .env ignorado, no imprimir. SQL hasta014 aplicado; LF checksum normativo. No resets globales.

## Código y verificación actual

Integrados runtime ed158a2, planner bfe2051, storage e089170/ffa56ba, frontend e42faec, Medusa30900d1, envd8d18af. Pendientes inmediatos merge runtime7b6b6f4 (vertical realPG), frontend2fa24d1 (selección resume). Core ancestry contiene cherry-picks ajenos: integrar solo commits propios por cherry-pick. Parser3b3d837 integrado b0eee7f; kernel docs eb434a4 como9d467af. Core8a3d3a9 cleanup benchmark pendiente integrar.

Servicio compuesto API/worker, sesiones durables, JIT por efecto, approvals, leases/fences, generación/catálogo/budgets. Runtime vertical realPG completo PASS: Fastify/SessionManager/StorageApiOperations/Store/JobStore/DurableWorker reales, ticket→request→generation→candidate→install→plan→approval→execution→succeeded. Solo host y proveedor fake-test explícitos. 20/20 runtime y service tsc PASS; no Medusa E2E. Checksum CRLF→LF corregido sin aceptar cambios semánticos.

Plugin y host Medusa2.22.1 backend/frontend build PASS. Admin exports .js/.cjs, rootDir preserva src. db:generate changedesk PASS, migración nonce/receipt30900d1 revisada. Env sigue migrate/seed/arranque; aún no dos endpoints/seed confirmados. Necesita dev/stop reproducible + configuración JIT/signing/Codex. Core canceló solo259jobs benchmark con3runIDs+tenant+kind+texto exactos; verificado pendientes/leased0, sin borrar filas. Worker ya puede arrancar tras config correcta.

SDK18 tests, tarball clean6 y browser Chromium fijado PASS según agente:39353B, launcher3484gzip, panel9290gzip, idle0/open1/postclose0. Cinco journeys Medusa authored, pendientes hostcredentials; no E2ErealPASS. Identidad server/scopeId particiona caché; instalación conserva preview; resume selección distinta invalida plan. ADR009 precondición por paso; ADR010 identidad/caché.

Root service TypeScript --noEmit y verify-locks PASS. Core ejecutó root verify-ci.mjs:50tests/9files + tipos core/contracts/laws + pins/frozenlock PASS; CI determinista parcial, NO PG/Medusa/browser/live. Suite integrada antigua73/73 evidencia parent-integration-tests. Root suite actual escribe parent-current-tests.json: inspeccionar antes de afirmar PASS. Autores planner30/storage19PG/runtime20/frontend18/core29+laws10; respetar alcances.

## Gates pendientes y fallos

Performance FAIL: query aislada ACL-first141.939→29.914ms, pero retest completo p95catálogo1191.1576ms/admission426.0304ms fuera250/300. Conservar todos fallos; contención solo hipótesis. Falta overheadMedusa/memoriaCPU/fairness; no repetir hasta verde. Bend checker ordinario PASS; kernel --verdict bloqueado esperando Lean4.34/BendTT, exige ley falsa rechazada.

Codex0.164.0 local autorizado como default. Hash/flags/aislamiento ligados y herramientas efectivamente denegadas, auth externo sin leer. Un smoke live válido13554in/227out/11705ms; modelo configurado gpt-6.1-sol, observado null, precio null. No E2E ni benchmark. APIs OpenAI/DeepSeek/OpenCode configurables sin llamadas pagadas, requieren credenciales y presupuesto explícito.

Security completó tests acotados antes de dos rechazos filtro runtime, incluido seguimiento defensivo. evaluation-runtime-blocker.json: NO reintentar ni rerutear el encargo bloqueado. Continuar trabajo funcional original. Holdout privado no leer:35pares26expectedexposed, SHA124a58d491d8b4fac9f184b9a2aad4f51a3675ea23643a2412f9457644f3d3e9, SEALED_NOT_RUN, sinASR. No es reviewfinal.

## Siguiente

Integrar checkpoints anteriores, migrate/seed8actores, arrancar Atlas9001/Boreal9002/API4100/worker con PIDs propios/readiness. E2E fake y Codex separados, reutilización mismo hash/bindings distintos, verificaciones funcionales pendientes. Completar Bend y medidas/CI/runbook limpio; abrir demo real/capturas. Crear acceptance.json y FINAL-REPORT con todos ACC PASS/FAIL/BLOCKED/NOT_RUN. Reviewer Astra fresco read-only al final y corregir hallazgos. No terminar por existencia de código ni compacción.

## Última instrucción del usuario: prioridad funcional

El usuario excluye expresamente TODO objetivo de rendimiento. ADR012 prevalece: no más benchmarks/optimización perf; ACC015 NOT_APPLICABLE por instrucción del usuario. Conservar FAIL históricos. Prioridad inmediata finalizar app y features funcionando, dos hosts/chat/generación/aprobación/ejecución/reuse. Mantener tests funcionales/permisos y límites de gasto, sin esperar medidas de rendimiento para cerrar.
