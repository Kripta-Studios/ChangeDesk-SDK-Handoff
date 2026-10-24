# Protocolo de swarm y council

El usuario solicita agentes cooperando hasta completar la implementación. El número de agentes se adapta a los slots reales y al grafo de dependencias; más agentes no justifican más complejidad de producto.

## Roles y ownership

| Rol | Responsabilidad | No debe hacer |
|---|---|---|
| Coordinador | Contratos, ADR, roadmap, integración, evidencias y aceptación | Delegar autoridad final a una votación |
| Medusa/integración | Bootstrap real, plugin, auth bridge, fixture seeding | Asumir RBAC o endpoints no probados |
| Core/storage | IR, tipos, planes, migraciones, RLS | Cambiar contratos compartidos sin coordinar |
| Runtime | Jobs, approvals, recuperación, adapter execution | Reintentar efectos unknown a ciegas |
| Producto/frontend | Chat, ofertas, previews, acciones, accesibilidad | Inventar backend o esconder permisos solo en UI |
| Planner/reuse | Provider, compilación, matching, publicaciones | Tratar embeddings/LLM como autorización |
| Security/evals | Invariantes, adversarial, Bend y evidencia | Generar y evaluar con el mismo oráculo sin control independiente |
| CI/performance | Build, test lanes, paquetes, budgets | Publicar secretos o hacer gates falsamente verdes |
| Reviewer fresco | Revisión read-only de código y evidencia final | Revisar solo resúmenes de los autores |

No tienen que ser nueve agentes simultáneos. Mantener 3–5 implementadores activos según independencia y slots, y reemplazar agentes al terminar una fase. Pruebas del módulo son responsabilidad de su implementador; evaluador independiente revisa invariantes transversales y holdout.

## Política normativa de modelos

El mapa ejecutable está en `../contracts/agent-policy.json`: implementación y tests usan exactamente `gpt-6.1-sol` con reasoning `high`; ideas, coordinación/orquestación y revisión final usan exactamente `gpt-6-astra` con reasoning `high`. La sesión principal conserva el modelo seleccionado por el usuario al lanzarla; un agente no puede cambiar su propio modelo ni debe afirmar cuál es sin evidencia del runtime.

Antes de crear un agente, comprobar el mapa de capacidades disponible. En el spawn nativo se usa `fork_turns="none"`, override explícito de modelo/reasoning y encargo autocontenido; no usar `agent_type` si impone un modelo distinto. No hay fallback silencioso: si falta el modelo requerido, registrar el routing `BLOCKED` y pedir una alternativa concreta solo si esa tarea no puede avanzar. La ausencia no obliga a detener documentación u otro trabajo independiente.

Ejemplos de argumentos para la API nativa, solo después de confirmar que el runtime ofrece el modelo (se omite deliberadamente `agent_type`):

```json
{"task_name":"runtime_impl","fork_turns":"none","model":"gpt-6.1-sol","reasoning_effort":"high","message":"OBJECTIVE: ... encargo autocontenido completo ..."}
```

```json
{"task_name":"final_review","fork_turns":"none","model":"gpt-6-astra","reasoning_effort":"high","message":"OBJECTIVE: revisión final read-only ... encargo autocontenido completo ..."}
```

## Olas de trabajo

1. **Viabilidad:** Medusa spike + core contracts + security threat review. Root congela contrato tras respuestas.
2. **Corte vertical:** adapter, core/storage y UI trabajan en carpetas separadas; runtime se integra cuando storage estabiliza.
3. **Producto completo:** reuse/planner + UI + runtime/recovery, con control explícito de interfaces.
4. **Verificación:** adversarial/Bend + CI/performance + integrador desde tarball limpio.
5. **Council final:** reviewers frescos inspeccionan implementación y evidencia; root decide correcciones/entrega.

En contextos pequeños usar worktree por rol; los documentos originales se conservan en rama base. Los agentes reciben solo contexto necesario y fixture sintético, no credenciales. Cuando compartan filesystem asignar archivo exacto y evitar escritores concurrentes sobre lockfile/migraciones/API.

## Formato de encargo obligatorio

```text
OBJECTIVE: resultado concreto observable; ID de tarea/fase.
FILES AND OWNERSHIP: carpetas/archivos exclusivos y archivos read-only.
INTERFACES: versión de contratos; entradas/salidas; dependencias existentes.
CONSTRAINTS: límites, seguridad, estado fake/live, no amplíes alcance silenciosamente.
VERIFICATION: test red esperado, comandos green y evidencia exigida.
RETURN: archivos cambiados, decisiones, pruebas, resultados, riesgos, siguiente consumidor.
```

Un agente puede proponer un cambio en archivo de otro; no editarlo sin traspaso de ownership. El coordinador resuelve bloqueos con información, no esperando repetidamente a todos. No activar agentes esperando contratos aún inexistentes.

## Council técnico, no consenso por cortesía

En cada cierre importante recoger objeciones independientes de integración, seguridad y operabilidad. Cada uno devuelve un veredicto `ship`, `fix-first` o `rethink`, con archivo/línea/test que lo sustenta, y por separado declara alcance `LOCAL_VERIFIED`, `LIVE_VERIFIED` y lista de `blockers`. Una opinión favorable sin inspección no cuenta. El coordinador mantiene `evidence/decisions.jsonl` con argumentos, decisión, alcance y pendientes. El alcance no sustituye al veredicto: por ejemplo, `ship` local con un blocker live no significa `LIVE_VERIFIED`.

- `ship`: comportamiento y evidencia suficientes dentro del alcance.
- `fix-first`: fallo concreto corregible; bloquear gate afectado, corregir y revisar de nuevo.
- `rethink`: contrato o garantía no implementable; ADR y replanificación antes de seguir.

No exigir unanimidad artificial. Toda objeción crítica debe resolverse con prueba o alcance explícito; un voto mayoritario no convierte un bypass de permisos en aceptable. Si dos reviewers discrepan, ejecutar el caso mínimo reproducible.

## Continuidad entre sesiones

Mantener `TASKBOARD.json` y `evidence/SESSION-HANDOFF.md`. Una tarea pasa por `not_started`, `in_progress`, `blocked`, `review`, `done`. `done` exige link a evidencia, no basta commit. Registrar motivo concreto de bloqueo y trabajo independiente restante. Al compactar o reanudar, leer el handoff y continuar; no repetir instalaciones ni regenerar recetas/datos sin necesidad.

El nuevo handoff registra servicios/pids del proyecto, puertos, rama/commit, última migración, fixture seed, acciones pendientes, ubicación de secretos por referencia sin valor, tests pendientes y próximos comandos. No dar por finalizado el objetivo por agotamiento de contexto o presupuesto.
