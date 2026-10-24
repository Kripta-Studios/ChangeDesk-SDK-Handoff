# Revisión de integración en curso

2026-10-24. Revisión del coordinador y asesor Astra integration_advisor, **no council final**.

| Hallazgo | Estado comprobado | Propietario |
|---|---|---|
| SQL CRLF/LF daba checksum distinto | Normalización LF en código con test de cambio semántico; vertical PostgreSQL PASS | runtime |
| Plan/instalación/candidato no componían flujo real | Vertical Fastify+PG+worker completo PASS en7b6b6f4, host/proveedor fixtures explícitos; Medusa pendiente | runtime |
| Fingerprint invalidaba paso propio o ignoraba relaciones externas | ADR009 y vectores implementados; carrera host real pendiente | runtime/medusa |
| Plantilla privada mismo hash parecía ACL global | Migración011 owner+hash; grants por artifactID;19testsPGautor PASS | storage |
| Codex salida no validaba DSL y probe solo versión | Schema cerrado y hash/flags ligados; un smoke real semántico PASS; E2E pendiente | planner |
| Budget se reiniciaba con proceso | Ledger PG fenced, tres intentos totales, overruns rechazados; suite planner PASS | planner/storage |
| SDK build emitía JS en src | declarationOnly y tarball consumidor limpio PASS; JSX/Reactpeer/bundle verificados | frontend |
| Recarga mostraba estado de otro actor o selección vieja | Scope server derivado tenant/actor y comparación selección;18units PASS | frontend/runtime |
| Biblioteca no permitía descubrir oferta remota | ADR011 aceptado; GETinstallations offers ACL-first + UI en desarrollo; E2E anterior no cerraba reuse | planner/runtime/frontend |
| Root store instalado incompleto | TypeScript reparado; suite162assertions PASS pero SDKsuite no carga SetLike; gate total FAIL hasta reparación/retest | environment |
| Launcher integrado no inicia cuatro procesos | dev.ps1 viejo solo PG+pnpm; reemplazo/validación en curso, no readiness acreditada | environment |
| Plugin layout/exports incorrectos | Builds plugin/host PASS; rootDir y exports corregidos; db:generate PASS; migrate/seed pendientes | medusa/environment |
| CI parcial parecía cierre P8 |50tests deterministas PASS, no equivale a fullbuild/PG/host/browser; ampliación asignada | core |
| Rendimiento catálogo/admission supera objetivos | Retest real1191.16/426.03ms p95 FAIL; query aislada mejor no sustituye gate | core/storage |
| Bend checker contado como kernel | Lanes separadas; kernel BLOCKED hasta Lean/BendTT; false-law pendiente real | core/environment |
| Evaluación independiente no puede continuar | Dos rechazos del filtro runtime documentados; no reintentar/rerutear; holdout sellado sin leer | root |

Antes del cierre faltan dos tiendas/8actores/readiness, efectos nativos y readback, recovery real, reuse firmado con mismo hash y bindings privados, Codex E2E, kernel, overhead/coste/fairness, runbook limpio, CI amplia, browser demo y reviewer fresco. Cada resultado fake, PostgreSQL, host real, browser y LLM conserva su alcance. No declarar LOCAL_VERIFIED por tests unitarios o solo presencia de handlers.
