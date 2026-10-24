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
## ADR-008 — Identidad de contenido y propiedad privada

El digest identifica contenido, pero no constituye una ACL global. Dos tenants pueden persistir por separado el mismo contenido privado y obtener IDs opacos propios; la unicidad es `(ownerTenantId, artifactHash)`. Publicaciones y grants se vinculan al ID concreto del artefacto. Adivinar un hash no concede lectura, instalación ni evidencia. La migración011 elimina la unicidad global que impedía REUSE-08; se conserva el mismo algoritmo de hash y se prueba el caso contra PostgreSQL real.

Una propuesta nueva del modelo primero pasa el schema y la validación semántica. Antes de persistir el artefacto, el servicio reconstruye sus metadatos genéricos desde las tres formas revisadas, manteniendo su semántica. El texto privado queda en conversación/configuración. Así la publicación de una nueva función conserva su hash, mientras Atlas/Boreal mantienen bindings y autoridad separados. Los artefactos históricos no se rehashean ni las instalaciones se actualizan silenciosamente. La comparación semántica usa JCS; el orden de claves no altera aceptación y las capacidades se comparan como conjunto.

## ADR-009 — Precondición por paso y relaciones concurrentes

El digest de campos protegidos del producto excluye relaciones, porque una asociación aprobada cambia el estado esperado del paso siguiente. Esa exclusión por sí sola no basta para detectar cambios ajenos. Cada paso materializa `hashCanonical("medusa-step-precondition", "1", {protectedDigest, categoryIds, channelIds})`, con ambos conjuntos ordenados y sin duplicados.

El compilador parte del snapshot autorizado y predice únicamente las adiciones aprobadas en el orden de ejecución de cada producto; un no-op conserva el estado. El host recalcula la precondición completa dentro del lock compartido antes de cada efecto. Así la categoría añadida por el paso propio permite ejecutar el canal aprobado, mientras un cambio externo de relaciones o campos protegidos exige replanificar. Se conserva el formato del claim existente `preconditionFingerprint`; no se añade autoridad ni información privada al modelo. Comparar vectores entre compilador y host y probar la carrera real antes de aceptar este gate.


## ADR-010 — Identidad del servidor y caché del navegador

La respuesta de instalaciones incorpora identidad de presentación (`tenantName`, `actorName`, `role`) y un `scopeId` derivado en el servidor del tenant y actor autenticados. El SDK espera esa identidad antes de recuperar estado de sesión y particiona su caché por ese scope. El identificador estable permite recargar la misma sesión y evita mostrar conversaciones de otro actor al cambiar de cuenta. No concede autoridad: cada lectura y mutación vuelve a pasar por sesión, política y RLS. No se añade una clave privilegiada a la configuración pública del widget.

## ADR-011 — Descubrimiento de ofertas autorizadas en la biblioteca

Carencia observada: una tienda destinataria no puede instalar una publicación desde la interfaz si la API solo enumera instalaciones existentes; exigir conocer el hash por fuera del producto no cumple reutilización ofrecida. Se amplía `GET /v1/installations` con `offers`, sin añadir infraestructura ni endpoint.

El servidor obtiene primero el conjunto visible por grants vigentes y política del actor. Valida publicación/firma/clave y compatibilidad antes de devolver metadatos genéricos: `artifactHash`, `recipeKey`, `displayName`, `version`, `requiredParameters` y `evidenceStatus`. No entrega IDs, nombres de recursos, bindings, conversaciones ni identidad del tenant de origen. Una oferta retirada/revocada o sin grant desaparece; conocer el hash no suple autorización. No se marcan evidencias ausentes como aprobadas.

La biblioteca muestra la oferta explícita y un administrador configura parámetros con recursos de su propia tienda. El endpoint existente de instalación vuelve a validar toda la autorización y fija el mismo artefacto inmutable; el operador crea después su propio plan y aprobación. La UI no instala automáticamente ni copia el plan privado del solicitante. Probar publicación Atlas, descubrimiento/instalación Boreal con mismo hash y bindings distintos, retiro y ausencia para actores/tenants sin permiso, separando pruebas PostgreSQL de las de navegador/Medusa.

## ADR-012 — Objetivos de rendimiento fuera del encargo por instrucción del usuario

El usuario solicita explícitamente: «ignora todo el tema de objetivos de rendimiento y acaba la aplicación y sus features y funcionalidades funcionando cuanto antes». Esta instrucción prevalece sobre los gates de rendimiento de docs05/06/08/11. Se retiran del cierre solicitado los umbrales y benchmarks de coste/latencia/bundle/CPU/memoria/throughput/fairness y las optimizaciones dedicadas a esos objetivos. No se repiten benchmarks. Los resultados históricos FAIL se conservan sin convertirlos en PASS.

ACC-015 queda `NOT_APPLICABLE` por exclusión explícita del usuario. La parte de P7 relativa a rendimiento deja de ser trabajo pendiente; las comprobaciones funcionales de instalación e integración siguen siendo aplicables. Permanecen las cuotas y límites que controlan autorización, ejecución acotada y gasto del proveedor, y las pruebas funcionales de permisos, efectos, recuperación e instalación. Prioridad inmediata: dos hosts operativos, chat, creación, aprobación, ejecución y reutilización desde la interfaz.

## ADR-013 — Una reserva durable por llamada al proveedor

Carencia observada al cablear APIs: GenerationProcessor ya reserva y contabiliza cada intento en PostgreSQL, mientras el proveedor API independiente exige otro puerto de reserva. Contabilizar ambos duplica gasto/uso y una implementación vacía del segundo puerto ocultaría la falta de autoridad.

La composición de producción usa una única reserva durable del procesador como autoridad de presupuesto. El proveedor API recibe contexto interno de llamada reservada, inaccesible a salida del modelo y al navegador. Debe rechazar invocaciones sin ese contexto; el procesador comprueba reserva/fence/límites antes de llamar y persiste uso, fallos y overruns después. No se exige una segunda reserva ni se acepta un puerto no-op. El proveedor independiente conserva su requisito de presupuesto o solo se expone mediante la composición que lo garantiza. Tests negativos y uso contable deben demostrar una sola reserva y contabilización por intento. Configuración API real exige referencia externa a clave y presupuesto explícito; Codex continúa como default.

## ADR-014 — Identidad y versión del adaptador en el manifiesto

La composición real detectó que generación comparaba `capabilityManifest.adapterVersion` con el ID `medusa-v2`, mientras planes y bridge utilizan la versión `medusa-2.22.1/changedesk-1`. El campo de versión conserva semántica de versión: `adapterVersion = medusa-2.22.1/changedesk-1`. El cuerpo del manifiesto declara por separado `adapter = medusa-v2`, `capabilityContract = 1` y `verifiedMedusaVersion = 2.22.1`. Generación comprueba los cuatro valores; aprovisionamiento, plan y bridge usan el mismo contrato. Las fixtures de tests se corrigen y no se aceptan manifiestos con ID en lugar de versión. No se cambian hashes históricos ni planes existentes para ocultar la discrepancia.

## ADR-015 — Evidencia de leyes vinculada al plan

Carencia observada: activar `proofRequired` bloqueaba todos los planes porque la composición siempre proporcionaba evidencia `blocked`, aunque existe un verificador revisado. Se conecta ese verificador mediante configuración confiable del servidor; no se añaden dependencias ni se modifican leyes para obtener verde.

Antes de verificar, el servidor reserva una referencia opaca de evidencia y compila el plan con esa referencia. El hash final del plan se entrega a `LawVerifier` junto con artefacto y versión de política. Así no hay dependencia circular entre el hash y el contenido de la evidencia. Solo un resultado `verified` con bindings y versiones exactos puede persistirse como `passed`; evidencia y plan listo se guardan transaccionalmente. Ausencia, fallo o indisponibilidad del verificador bloquean el plan requerido. La ejecución comprueba evidencia aplicable al plan; publicación requerida valida evidencia aplicable sin publicar planes, identidad ni datos privados.

El alcance `association-set-laws-v1` conserva las leyes del modelo puro revisado en `evidence/laws-decision.md`. No demuestra autenticación, IO, traducción ni efectos de Medusa. Los resultados de prueba controlados no acreditan ejecución del kernel. Cambios de artefacto, política o versiones aplicables invalidan la evidencia; `proofRequired=false` mantiene su alcance explícito sin invocar Bend.

## ADR-016 — Storefront real del laboratorio

El consumidor comprador se sirve en `http://127.0.0.1:8001`, con selección explícita de Atlas o Boreal y autenticación customer por cookie. El puerto inicialmente propuesto, 8000, está reservado por un servicio HTTP.sys ajeno al proyecto; se cambia el puerto sin detenerlo ni modificarlo. Los orígenes confiables del host y la API incluyen exactamente el origen 8001 junto a los administrativos. Se conservan las audiencias e identidades separadas de buyer y staff, la protección CSRF y el catálogo finito de preferencias. La configuración de puerto/origen y arranque pertenece al laboratorio; el ejemplo no crea otro workspace fuente.

Los compradores sintéticos se aprovisionan de forma idempotente y sus credenciales se guardan únicamente en archivos locales ignorados. No se reseedea ni borra el namespace activo para añadir compradores. El fixture visual, cuando se utilice, permanece explícitamente separado del modo conectado y no acredita el gate Medusa real.
