# Ejecución duradera, datos y consistencia

Estado: diseño normativo propuesto para implementación. `00-DECISIONS.md` y `../contracts/` fijan nombres canónicos. Consultar también `02-ARCHITECTURE.md`, `03-MEDUSA-INTEGRATION.md`, `04-SECURITY-AND-LAWS.md` y `05-REUSE-COST-AND-SCALE.md`.

## 1. Unidades distintas

| Unidad | Contenido | Ámbito |
|---|---|---|
| Solicitud | Texto del usuario, contexto autorizado, presupuesto | Privado tenant/actor |
| Receta | DSL genérico, UI schema, capacidades y versiones, leyes aplicables | Privada por defecto; compartible con consentimiento |
| Versión de artefacto | Bytes canónicos inmutables, digest, firma, estado | Ámbito de publicación explícito |
| Instalación | Referencia a versión, configuración, política y conexiones locales | Un tenant |
| Plan | Selección materializada, parámetros locales, efectos y precondiciones por fila | Un tenant, actor y ejecución prevista |
| Aprobación | Consentimiento para el hash exacto del plan, límites y vencimiento | Actor autorizado + tenant |
| Ejecución | Trabajo duradero, filas y pasos, efectos y reconciliación | Un tenant |
| Evidencia | Tests, versión de herramientas, resultado de leyes y enlaces a trazas | Genérica o privada según contenido |

No usar un único JSON que mezcle las siete unidades. Evita publicar accidentalmente un plan privado al compartir una receta.

## 2. Esquema de persistencia propuesto

Los nombres se concretan en SQL directo parametrizado con `pg`; no se usa ORM ni query builder. Conservar claves y restricciones. Las tablas tenant-scoped llevan `tenant_id NOT NULL`; sus referencias usan claves foráneas compuestas `(tenant_id, id)`. Un UUID global difícil de adivinar no sustituye autorización.

| Tabla | Columnas esenciales / restricciones |
|---|---|
| `tenants` | id, app_kind, status, policy_version; mapping a instalación host registrada, no URL del cliente |
| `host_connections` | tenant_id, id, connector_version, origin_allowlist_ref, secret_ref, state; secretos fuera de respuestas API |
| `actors` | tenant_id, actor_id, host_subject, state, last_policy_version; el host sigue siendo autoridad de roles |
| `requests` | tenant_id, id, actor_id, redacted_text, context_ref, state, budget, created_at |
| `recipe_artifacts` | id, owner_tenant_id nullable solo para provider, scope, digest, schema_version, canonical_body, state, signature_ref, created_at |
| `artifact_grants` | artifact_id, recipient_scope, rights, expires_at; cambios con auditoría |
| `installations` | tenant_id, id, artifact_id/digest, config, status, installed_by, policy_version; versión fijada |
| `plans` | tenant_id, id, request_id, installation_id nullable, actor_id, recipe_digest, body, plan_hash, capability_fingerprint, policy_version, expires_at |
| `approvals` | tenant_id, id, plan_id, plan_version, plan_hash, actor_id, scope, expires_at, consumed_execution_id; unique `(tenant_id, plan_id, plan_version, actor_id)`, no reutilización para otro plan |
| `executions` | tenant_id, id, plan_id, plan_version, approval_id, actor_id, prior_execution_id nullable, state, revision, cancel_requested_at, deadline_at; unique `(tenant_id, plan_id, plan_version)` |
| `execution_rows` | tenant_id, execution_id, row_id, resource_ref, state, precondition_fingerprint, final_observation_ref |
| `step_attempts` | tenant_id, execution_id, row_id, step_id, attempt_no, idempotency_key, fence, state, receipt_ref, error_code, timestamps |
| `jobs` | id, tenant_id, execution_id/request_id, kind (`generation`/`execution`/`reconcile`), status, next_attempt_at, lease_owner, lease_until, fence, attempt_count; única tabla de cola |
| `scheduler_tenants` | tenant_id, next_turn, admitted_count, active_count, cap; fairness explícita |
| `capacity_leases` | scope_type, scope_id, slot, owner, lease_until, fence; límite global/backend/tenant |
| `idempotency_records` | tenant_id, actor_id, operation, key, request_hash, resource_id, expires_at; unique conjunto anterior |
| `audit_events` | tenant_id, id, actor_id, subject_type/id, action, reason_code, trace_id, timestamp; acceso restringido |
| `evidence_bundles` | id, recipe_digest, environment_digest, suite_version, status, artifact_refs, privacy_scope; evitar trasladar evidencias privadas al catálogo público |

`recipe_artifacts` exige un tratamiento de permisos distinto al de datos tenant-scoped: una vista/consulta autorizada une ownership y grants. No usar una excepción RLS indiscriminada que haga visibles todos los artefactos. Las publicaciones públicas contienen metadatos revisados; las recetas privadas no permiten consultas por hash a otros tenants.

Índices mínimos: jobs elegibles por estado/fecha/tenant; ejecuciones por tenant/actor/fecha; idempotencia única; instalaciones activas por tenant; hash y scope de artefactos; auditoría por tenant/fecha. Validar EXPLAIN en un dataset de carga. No indexar texto privado globalmente para simplificar búsqueda.

## 3. Transacciones y aislamiento

La identidad del request se valida antes de abrir transacción. Tomar un único client de `pg` y usar ese mismo client para `BEGIN`, `SET LOCAL`, todas las queries y `COMMIT`/`ROLLBACK`; `pool.query` no sirve para una transacción porque puede elegir conexiones distintas. Dentro de cada transacción privada se fija tenant con contexto transaccional. El rol runtime no es owner, superuser ni BYPASSRLS. El rol de migraciones se usa solo en bootstrap/migración y nunca en API/worker. `FORCE ROW LEVEL SECURITY` complementa, no reemplaza, esa separación. [node-postgres: transactions](https://node-postgres.com/features/transactions).

Una conexión del pool no mantiene tenant de un request anterior: el contexto es local a la transacción y los tests prueban reutilización de la misma conexión entre Atlas y Boreal. Evitar `SET` de sesión y consultas fuera del wrapper. Los errores de autorización no revelan si existe un ID ajeno.

El scheduler necesita elegir jobs entre tenants. No darle acceso general a planes/secretos. Puede usar un rol limitado a metadatos de scheduling o una función SECURITY DEFINER mínima, con search_path fijo, parámetros validados y grants explícitos. Un worker obtiene un claim opaco, abre un ámbito tenant concreto y carga solo sus datos. Documentar que una credencial runtime comprometida con capacidad de fijar contexto sigue siendo parte de la base de confianza.

Las transacciones locales no abarcan llamadas HTTP a Medusa. No mantener locks de DB abiertos durante el tiempo de red. Persistir intención antes de enviar, resultado tras recibir y utilizar reconciliación para el hueco entre ambos commits.

## 4. Estados y transiciones

Los nombres exactos del enum se sincronizan con contratos. Esta tabla fija la semántica y las transiciones que deben probarse:

| Agregado | Estados / reglas |
|---|---|
| Solicitud | recibida → buscando → candidato ofrecido / generando → necesita configuración / plan listo / rechazada / error. Un candidato no se instala por similitud automáticamente. |
| Plan | `draft` → `validating` → `ready` o `rejected`; también `expired` y `superseded`. La aprobación es un registro separado, no otro estado del plan. Cualquier cambio de cuerpo, receta, selección relevante o política invalida la aprobación y produce un nuevo plan/hash. |
| Ejecución | `queued` → `running` → `waiting_reconciliation` / `succeeded` / `partial` / `failed` / `cancelled`. Cancelación impide nuevos pasos y conserva efectos ya producidos. La necesidad de revisión se expresa mediante motivo y acción permitida, no inventando otro enum de ejecución. |
| Fila | pending → running → succeeded / skipped / failed / unknown / needs_review. `skipped` indica una regla de exclusión documentada, no un error oculto. |
| Paso | `pending` → `running` → `succeeded` / `skipped` / `unknown` / `failed`. Solo un resultado exitoso o un no-op satisfecho explícito habilitan dependientes según contrato. Los intentos guardan fases internas `intent_recorded`/`sent`/`confirmed`/`no_effect`/`rejected` separadas del estado público del paso. |
| Publicación | private → submitted → approved/published → withdrawn o security_revoked. Retirar distribución y revocar por seguridad tienen distinta política. |

Un job de generación fallido no se convierte en ejecución. Un plan denegado no se regenera repetidamente intentando eludir política. La corrección por el modelo conserva el mismo techo de permisos y consume el mismo presupuesto.

Un terminal `succeeded` requiere observación independiente de todos los efectos solicitados y de los invariantes comprobables. Si el modelo contestó “hecho” pero no hay efectos observados, sigue pendiente/fallido. La evidencia puede señalar condiciones no verificables; no convertir ausencia de lectura en éxito.

## 5. Construcción y aprobación del plan

1. Resolver tenant y actor del token validado. Resolver la instalación autorizada y versión fijada.
2. Validar parámetros y selección acotada. Recuperar productos y relaciones desde el backend correcto; materializar IDs y exclusiones, sin dejar una consulta abierta que pueda incluir productos nuevos tras aprobar.
3. Aplicar política actual y precondiciones. Para la demo: producto publicado, categoría/canal existentes y permitidos, máximo de registros, operaciones exclusivamente aditivas.
4. Calcular efectos previstos por fila y campos preservados. Si categoría o canal ya incluye el producto, ese paso es no-op explícito.
5. Construir `plan_hash` mediante serialización canónica de versión de esquema, digest de receta, tenant, actor, parámetros, selección, efectos, precondiciones, fingerprint de capacidades, policy_version, límites y expiración. No incluir timestamps volátiles de presentación.
6. Mostrar el plan y recibir aprobación mediante endpoint autenticado con protección CSRF cuando use cookies. El servidor no acepta `approved: true` en JSON del modelo.
7. Crear request/ejecución, idempotency record y fila `jobs` en una única transacción. No hace falta outbox para esta cola interna ni LISTEN/NOTIFY: el worker hace polling con jitter. Las restricciones únicas de aprobación `(tenant_id, plan_id, plan_version, actor_id)` y ejecución `(tenant_id, plan_id, plan_version)` son independientes de `idempotencyKey`: dos pestañas con claves distintas convergen en la misma ejecución. Repetición de la misma petición devuelve esa ejecución; distinto cuerpo con la misma clave devuelve conflicto. Un uso legítimo posterior crea otro plan y versión, nunca otra ejecución del mismo plan.

La aprobación autoriza solamente el alcance indicado y no revoca derechos de otros usuarios. Una aprobación expirará según la configuración fijada en los contratos; no inventar un plazo en cada paquete. Una selección modificada, una receta actualizada o una política más permisiva requieren nuevo plan y consentimiento. Una política más restrictiva puede bloquear inmediatamente el plan existente.

Los planes son privados y actor-bound. Un requester puede obtener preview pero un operator no puede aprobar ese plan, leer su chat privado ni depender de conocer su hash. El traspaso permitido es: admin instala el artefacto genérico ya validado; luego el operator inicia una petición nueva y el servidor crea un plan `NEW` bajo su identidad, con lecturas, política, preview y aprobación frescos.

## 6. Claim de jobs y control de capacidad

El scheduler asigna turno por tenant; seleccionar primero al tenant elegible y después su siguiente job evita que un cliente con muchos jobs monopolice la cola. `FOR UPDATE SKIP LOCKED` reduce contención entre consumidores, pero no implementa por sí mismo fairness.

Claim transaccional propuesto:

1. Verificar cuota global del despliegue, de backend y de tenant en registros de capacidad bloqueados en orden fijo.
2. Elegir tenant con turno vencido y job disponible; bloquear fila del job.
3. Cambiar estado a leased, incrementar fencing token y reservar slots con el mismo owner/lease.
4. Commit; ejecutar fuera de transacción. Actualizar heartbeat según intervalos configurados.
5. Persistir progreso solo con `WHERE lease_owner = ... AND fence = ...`; liberar slots al terminar o recuperar lease expirado mediante proceso controlado.

Un fencing token de nuestra DB evita que un worker antiguo sobrescriba progreso, pero no impide por sí solo que envíe un efecto remoto. El bridge host debe rechazar duplicados o claims obsoletos según recibo de operación/delegación y debe autorizar otra vez antes de cada efecto. Perder el lease cancela futuras solicitudes del worker; abortar HTTP no demuestra que el backend no haya aplicado el cambio.

No cargar todos los jobs en memoria. Limitar batch, filas activas, conexiones y payload. Los límites globales están en DB si hay varias réplicas; un contador JavaScript por proceso solo sirve de defensa adicional.

## 7. Idempotencia, reintentos y resultados desconocidos

La unidad idempotente de escritura es `(tenant, execution, row, step, semantic_input_hash)`, estable entre intentos del mismo efecto. Una nueva ejecución aprobada tiene otra identidad. El bridge mantiene un recibo durable que enlaza actor, alcance, idempotency key, request hash y resultado/estado. No asumir que Medusa soporta una cabecera de idempotencia universal.

Clasificar cada fallo:

| Situación | Acción |
|---|---|
| Validación local falló antes de enviar | Rechazar; sin reintento automático |
| Permiso, política, tenant o aprobación inválidos | Bloquear nuevos efectos; registrar motivo seguro |
| Lectura transitoria falló | Reintentos acotados con jitter, deadline y presupuesto |
| Escritura rechazada de forma inequívoca sin efecto | Reintentar solo si el manifiesto permite y no cambió la aprobación |
| Timeout/desconexión tras enviar | `unknown`; consultar recibo y estado antes de cualquier repetición |
| Estado esperado ya observado | Confirmar como satisfecho, pero no atribuir autoría sin recibo |
| Estado incompatible o no verificable | `needs_review`; no inferir ausencia de efecto |
| Lease expirado tras envío | Recuperador reconcilia; nunca salta directamente a pending |

Las operaciones aditivas reducen riesgo de duplicación, pero no reemplazan la validación. Para categoría/canal, el oráculo comprueba pertenencia sin eliminar relaciones existentes. Si otro proceso retira una relación tras nuestra escritura, no hay una garantía permanente: registrar observación y versiones/tiempos. El estado de negocio sigue siendo autoritativo.

Reanudar el mismo ledger solo está permitido mientras la aprobación siga vigente y plan, política, actor y precondiciones sean los mismos. Si aprobación, política o plan expiraron/cambiaron, la ejecución vieja no inicia más efectos: primero reconcilia intentos `sent`/`unknown` y termina `partial` si existe algún efecto confirmado o `failed` si no existe ninguno, conservando el diagnóstico. Para continuar se crea un plan nuevo que enumera únicamente los efectos todavía ausentes, enlaza `prior_execution_id`, pasa por preview y aprobación nuevos y da lugar a otra ejecución. Los efectos confirmados no se repiten y el plan/ledger histórico no se reescribe.

## 8. Concurrencia con cambios externos y límites TOCTOU

La demo usa operaciones nativas aditivas de categoría/canal para evitar read-merge-write destructivo sobre arrays. Para una futura capacidad de reemplazo se exige actualización condicional soportada por el backend o un mecanismo host que cubra todos los caminos de escritura relevantes. Un mutex del runner o un advisory lock que otras rutas ignoran no ofrece esa garantía.

La condición “solo published” necesita verificación lo más cerca posible del efecto. Si Medusa no ofrece una condición atómica que abarque estado y relación, el conector debe exponer el límite y elegir una política conservadora: host guard verificado que intercepte las escrituras conflictivas, o pausa/revisión al detectar conflicto y alcance de concurrencia documentado. No afirmar serializabilidad global porque una prueba sin concurrencia pasó.

Durante bootstrap se debe decidir y documentar exactamente qué operaciones del host comparten el guard. La prueba de aceptación debe competir con una escritura desde la UI/API nativa, no solo con otro worker de Change Desk. Si no se puede sostener el invariante frente a esa vía, el gate de concurrencia permanece bloqueado o se reduce explícitamente la capacidad ofrecida. No se oculta el problema con un retry infinito.

En la demo, comparar antes/después los campos protegidos precios/inventario/estado/tags y relaciones preexistentes. Una diferencia ajena concurrente se identifica como conflicto observado; no se revierte automáticamente. El SDK no debe sobrescribir cambios humanos para conseguir que su test final coincida.

## 9. Cancelación, revocación y actualización

Cancelar marca una intención durable. El worker verifica antes de cada nuevo paso y detiene nuevos efectos; los requests ya enviados pueden terminar. Su estado se reconcilia y se presenta por fila. No prometer rollback de una ejecución cancelada.

Revocar permiso del actor o marcar un artefacto `security_revoked` bloquea pasos futuros, aun cuando la UI siga abierta o el job tenga lease. Una publicación `withdrawn` deja de ofrecer nuevas instalaciones y sigue la política de licencia existente para las ya instaladas; no confundir con compromiso de seguridad.

Actualizar una receta crea otro digest. Cada instalación permanece fijada hasta aceptar la migración; nunca se cambia silenciosamente el código de una función aprobada. Las evidencias se invalidan según cambios de DSL, capacidades, adaptador, política, runtime o leyes. La comparación dirigida reduce trabajo de test, no demuestra cobertura total de todas las interacciones.

## 10. Observabilidad y datos sensibles

Correlación mínima: requestId → recipeDigest → installationId → planHash → approvalId → executionId → rowId/stepId → hostReceiptId → observation. A cada evento añadir versión de conector y suite de validación. No registrar tokens, cookies, cabeceras Authorization, secretos ni prompts completos por defecto.

Separar ledger estructurado y logs diagnósticos. El ledger conserva hechos necesarios para auditoría; los payloads grandes tienen retención acotada y referencias. Los valores de retención, cuotas y presupuesto se centralizan en configuración y se documentan con los objetivos de `05-REUSE-COST-AND-SCALE.md`.

Bend guarda toolchain digest, entrada formalizada, propiedades, resultado y alcance. `unavailable`, timeout, error de traducción o propiedad no modelada nunca producen una insignia de verificado. Las pruebas de adaptador y los ataques tienen estados propios. La evidencia privada de Atlas no se adjunta a una plantilla pública ni se muestra en Boreal.

## 11. Migraciones, recuperación y pruebas imprescindibles

- Migraciones SQL pequeñas y numeradas, checksums, advisory lock de aplicación, revisión y prueba sobre DB vacía y versión anterior soportada. No añadir framework de migraciones. Backups/restauración dentro del directorio de laboratorio, sin borrar datos ajenos.
- Al iniciar, recuperar leases expirados y slots huérfanos. Reconciliar sent/unknown antes de reanudar. Un restart no recrea efectos ya confirmados.
- Probar muerte de worker antes del envío, después del envío, después del efecto y antes del commit de resultado. Los cuatro puntos son distintos.
- Probar claves de idempotencia repetidas con cuerpo igual/distinto, aprobación repetida, doble clic y dos pestañas con claves distintas; todas las carreras del mismo plan producen una sola aprobación/ejecución.
- Probar resume antes y después de expirar aprobación/política/plan: vigente continúa el mismo ledger; expirado reconcilia unknown, detiene efectos nuevos y crea, tras nuevo consentimiento, un plan ligado por `priorExecutionId` solo para lo pendiente.
- Probar conexión pool reutilizada entre tenants, FK cruzada rechazada, actor revocado, plan stale, publicación revocada, reconexión del navegador y presión de cola.
- Probar independencia: detener Change Desk no debe detener navegación ni operaciones nativas de Medusa. El launcher muestra indisponibilidad sin error global ni bloqueo del host.
- Probar realmente qué relación agregan los endpoints y preservar relaciones previas. No sustituir este test por mocks del wrapper que ya asumen el resultado.

## Fuentes oficiales

- [PostgreSQL SELECT](https://www.postgresql.org/docs/current/sql-select.html): semántica de locking y `SKIP LOCKED`.
- [PostgreSQL bloqueo explícito](https://www.postgresql.org/docs/current/explicit-locking.html): locks de filas y advisory locks; la coordinación debe abarcar a los participantes relevantes.
- [PostgreSQL seguridad por fila](https://www.postgresql.org/docs/current/ddl-rowsecurity.html): contexto de políticas y roles que las evaden.
- [node-postgres transactions](https://node-postgres.com/features/transactions): todas las sentencias de una transacción deben usar el mismo client; no usar `pool.query`.
- [Medusa autenticación](https://docs.medusajs.com/api/admin/authentication) y [rutas protegidas](https://docs.medusajs.com/learn/fundamentals/api-routes/protected-routes): base del bridge; los permisos y recibos descritos aquí son controles que deberá añadir nuestra integración.

Toda estrategia de recepción, fencing, hashing, estado, cuotas y schema de este documento es una decisión de diseño pendiente de implementación y validación, no una garantía ofrecida por esas bibliotecas.
