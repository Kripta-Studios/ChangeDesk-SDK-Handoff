# Decisiones de implementación

## ADR-001 — Contratos compartidos y terminología (2026-10-24)

Estado: aceptado para implementación; no acredita ejecución.

- `contracts/*.schema.json` sigue siendo la fuente normativa. `packages/contracts` distribuye copias verificadas byte a byte por un test; no se modifican de forma independiente.
- El nombre público de identidad de receta es `artifactHash`. `artifactDigest` y `recipeDigest` en documentos narrativos son alias de ese mismo hash, no algoritmos diferentes. Los hashes de planes, parámetros y evidencia tienen dominios separados.
- Toda mutación de control requiere `Idempotency-Key`. Los cuerpos normativos que también incluyen `idempotencyKey` conservan ese campo: debe coincidir exactamente con la cabecera; discrepancia devuelve 400 antes de efectos. `clientRequestId` sirve además para deduplicar mensajes, no aporta autoridad. Las restricciones de unicidad de aprobación/ejecución siguen siendo independientes de ambas claves.
- Estados públicos de solicitud: `received`, `searching`, `candidate_offered`, `generating`, `needs_configuration`, `plan_ready`, `rejected`, `error`. Las etiquetas visibles se traducen aparte. Se añade `needs_clarification` para la salida explícita del planner ya exigida por el contrato.
- Filas: `pending`, `running`, `succeeded`, `skipped`, `failed`, `unknown`, `needs_review`. No se añade un estado alternativo de ejecución para representar incertidumbre.
- Progreso v1 únicamente mediante polling HTTP. La mención de streaming opcional no amplía el perfil tecnológico.
- Resultado de leyes `verified/failed/unavailable/not_applicable` se traduce a evidencia `passed/failed/blocked/not_applicable`; nunca se confunden pruebas del modelo puro con efectos externos.

Impacto: tipos públicos, validadores REST, SDK, persistencia y tests de igualdad/idempotencia deben seguir estas decisiones. Se conserva la forma de los schemas v1 existentes.

## ADR-002 — Canonicalización RFC 8785 (2026-10-24)

Estado: dependencia aprobada condicionada a verificación de versión/licencia por el propietario del entorno.

Carencia observada: Node no ofrece JCS y el contrato exige una implementación contrastada, prohibiendo una ordenación recursiva propia. Se elige `canonicalize@5.1.0` (Apache-2.0, implementación del coautor de RFC 8785), frente a `json-canonicalize@3.0.1` y una implementación propia descartada por el contrato. Solo se incorpora al servicio; no al bundle por defecto del SDK. Registrar fuente, integridad y fecha en `evidence/environment.json`, y probar vectores RFC, entradas no I-JSON y separación de dominios antes de aceptar sus hashes.

## ADR-003 — Routing del swarm (2026-10-24)

El mapa público de `collaboration.spawn_agent` ofrece explícitamente `gpt-6.1-sol` y `gpt-6-astra` y esfuerzo `high`. Se solicitan overrides exactos con `fork_turns=none`, sin `agent_type` que los sustituya. La respuesta pública de creación devuelve nombre de tarea, no confirma metadatos internos del modelo; se registra esa limitación de observabilidad sin afirmar el modelo actual de la sesión principal. El agente Astra de arquitectura asesora coordinación y se reservará un Astra fresco de solo lectura para revisión final. Estas instrucciones del usuario prevalecen sobre los modelos predeterminados de la skill de orquestación.
