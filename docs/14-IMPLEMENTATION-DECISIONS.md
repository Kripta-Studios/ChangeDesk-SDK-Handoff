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

## ADR-004 — Frontera host y reconciliación (2026-10-24)

Estado: contrato aceptado; garantía pendiente de pruebas contra Medusa.

Hay tres operaciones distintas: lectura autorizada para preview, efecto autorizado y reconciliación acotada a una operación histórica. Una revocación impide nuevos efectos; no impide reconciliar el recibo/postcondición de una operación ya enviada. Esta última autoridad no permite lecturas arbitrarias.

El recibo host tiene unicidad por `(tenant, operationKey)` y liga inmutablemente capability, argumentos/hash semántico, ejecución, fila y paso. Se registra intención antes del workflow. Repetición idéntica consulta el recibo; cuerpo distinto devuelve conflicto. Un nonce de transporte de un uso es distinto de la identidad estable de la operación.

El fencing corresponde a job/ejecución/operación, no a un contador global del actor. La autoridad de efecto comprueba lease vigente, aprobación, plan, política y revocación antes de cada delegación; el host comprueba además identidad y permisos actuales. Una lectura previa más un mutex del worker no acredita atomicidad. La prueba de concurrencia debe incluir escritura nativa privilegiada de estado bajo el mismo guard host; denegar únicamente a actores demo no prueba esa garantía.

Una fila ya satisfecha sigue siendo elegible con efectos `no_op`; no se cuenta como excluida. Los DTO de presentación se separan del cuerpo inmutable del plan.

## ADR-005 — Codex local como proveedor live de demo (2026-10-24)

El usuario solicita utilizar su Codex local autenticado por defecto y permitir configuración posterior de DeepSeek/OpenCode/OpenAI por API key. No se extraen ni copian credenciales de Codex. El CLI instalado observado es 0.164.0; `codex exec` admite autenticación guardada, ejecución efímera y salida estructurada según la documentación oficial de modo no interactivo: https://learn.chatgpt.com/docs/non-interactive-mode.

Se implementará un adaptador de proveedor invocado con ejecutable/argumentos fijos y `shell:false`, stdin para datos no confiables, timeout y límites de llamadas/salida. Debe comprobarse ausencia de autoridad efectiva para shell, lectura de archivos, red, escritura, apps, plugins, MCP y subagentes, además del sandbox read-only y ausencia de instrucciones del proyecto. Una instrucción de prompt que diga «no uses herramientas» no cumple esa frontera. Si no puede verificarse, este proveedor queda BLOCKED y no se disfraza como fake.

Resultado de investigación posterior: CLI0.164.0 conserva una definición residual de `functions.exec`, pero desactivar `code_mode_host` hace que sus llamadas fallen antes del despacho. Un ensayo live acotado del asesor Astra observó ese rechazo y ninguna operación efectiva de shell, archivos, red, escritura ni subagentes. Por ello el invariante aceptado es **cero autoridad efectiva**, no ausencia textual de toda definición. El adaptador debe repetir un probe ligado a versión/flags/configuración exactos y fallar cerrado ante cambios, herramientas efectivas o salida desconocida. Se usan `--ignore-user-config`, `--ignore-rules`, ejecución efímera, directorio aislado vacío, documentación del proyecto desactivada y allowlist de entorno. No se usa app-server si carga conexiones MCP del usuario. El ensayo observó 104.520 tokens de entrada: es un riesgo de coste/latencia, no prueba de bajo overhead.

Codex solo propone JSON; el parser, autorización, preview, aprobación y runner permanecen independientes. Registrar proveedor, modelo realmente observado, tokens y latencia; precio desconocido permanece desconocido. APIs facturables requieren configuración externa y presupuesto explícito; los nombres de modelo solicitados no se sustituyen silenciosamente ni se presentan como disponibles sin verificación.

## ADR-006 — Hash de argumentos del bridge (2026-10-24)

`argsHash` usa `hashCanonical("bridge-arguments", "1", args)`. `semanticInputHash` usa un dominio distinto, `semantic-input`, para la identidad del efecto. El framing es UTF-8 de cuatro segmentos unidos mediante un byte NUL: `changedesk`, dominio, versión y JCS del valor. No se intercambian hashes de artefacto, plan, argumentos y efecto.

El plugin host usa también `canonicalize@5.1.0` para JCS, sustituyendo el serializador recursivo preliminar. La dependencia aprobada cubre servicio y backend del plugin; sigue fuera del bundle del SDK. No se crea dependencia plugin→service: la fórmula del protocolo y vectores conocidos verifican igualdad. Los sobres Ed25519 firman los bytes JCS exactos y sus claims incluyen un `typ` fijo por dominio. El uso de formato entero para timestamps no sustituye una canonicalización contrastada.

## ADR-007 — Visibilidad e instalación (2026-10-24)

`POST /v1/publications` acepta `visibility: provider_catalog | shared_allowlist` y consentimiento explícito. La privacidad es el estado predeterminado de un artefacto; guardarlo no lo publica. No hay publicación global. El servidor deriva la audiencia permitida desde política; una selección del navegador solo puede reducirla. En el laboratorio el catálogo del proveedor concede acceso explícito a las tiendas registradas autorizadas, con grants por tenant.

`POST /v1/installations` conserva la entrada normativa `artifactHash + configuration`. Un admin puede instalar un artefacto privado genérico validado de su tenant sin publicarlo primero. Para un artefacto compartido se comprueban grants, firma, clave, estado y compatibilidad. La instalación nunca requiere transferir chat/plan/hash de plan privado del requester a otro actor. Los bindings deben coincidir exactamente con los parámetros de esa receta y resolverse bajo autoridad local.
