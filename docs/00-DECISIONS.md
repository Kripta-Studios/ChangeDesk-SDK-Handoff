# Decisiones vinculantes y alcance

Estado: especificación aprobada para implementación local; resultados aún no medidos. Estas decisiones sustituyen alternativas del diagrama previo si hay discrepancias.

| ID | Decisión | Motivo / consecuencia |
|---|---|---|
| D01 | SDK embebido + servicio modular TypeScript + worker separado + PostgreSQL | Baja complejidad inicial; evita microservicios prematuros |
| D02 | Cola durable en PostgreSQL, no Temporal/Redis obligatorios | Menos infraestructura. Exige implementar leases, recuperación, backpressure y pruebas de caída |
| D03 | Dos Medusa independientes: `atlas`, `boreal` | Los canales de venta no son fronteras de tenant |
| D04 | Demo `catalog.campaign.prepare.v1`: categoría existente + canal existente | Asociaciones aditivas verificables; no reemplazar arrays de etiquetas mediante read/merge/write |
| D05 | Solo productos seleccionados publicados; preview excluye el resto | Un recurso seleccionado que el actor no puede leer causa rechazo completo y no revela existencia; un recurso legible pero bloqueado/no elegible (como `p07`) se muestra como exclusión |
| D06 | Preservar precio, stock, status, tags y relaciones previas | Ninguna escritura de dinero, inventario, mensajería o checkout en esta demo |
| D07 | Recetas declarativas y finitas; componentes UI cerrados | No generación/ejecución arbitraria de código en runtime |
| D08 | Generación asíncrona fuera de Medusa; ejecución repetida sin LLM | El coste de crear una variante no se repite por clic |
| D09 | Host bridge autentica y autoriza usuario/tenant en servidor | Una política del SDK solo en frontend sería insuficiente |
| D10 | Restringir también rutas Medusa nativas que permitirían eludir la política | No atribuir RBAC inexistente a la edición/version instalada |
| D11 | Privado por defecto; publicación explícita y oferta de instalación explícita | Nunca buscar datos ni contenedores privados de otros clientes |
| D12 | Similaridad propone; compatibilidad y autorización deciden | No ejecutar una plantilla porque el embedding sea parecido |
| D13 | Instalaciones fijan versiones; no autoactualizar variantes | Cambio de comportamiento exige evidencia nueva y revisión |
| D14 | Hash canónico + firma/autorización de publicación + evidencia versionada | El hash no demuestra procedencia; la firma no demuestra corrección |
| D15 | No rollback universal ni exactly-once remoto | Efectos desconocidos se reconcilian; no se reintentan a ciegas |
| D16 | Bend en la capa experimental de evidencia | Nunca presentar una prueba del modelo puro como prueba de IO, traducción o ausencia de prompt injection |
| D17 | Fake LLM y live LLM son gates distintos | Una demo programada prueba el pipeline, no capacidad real de planificación |
| D18 | Presupuestos son objetivos, no cifras observadas | Medir carga, coste, integración y memoria en entorno registrado |
| D19 | Portabilidad por adapters, no integración universal automática | Escanear endpoints no revela reglas, permisos ni atomicidad |
| D20 | Perfil mínimo vinculante en `contracts/technology-profile.json`: exactamente cuatro workspaces fuente y PostgreSQL como única infraestructura propia | Un artefacto `apps/service` expone entrypoints API/worker; módulos internos no son paquetes/despliegues. Cada dependencia nueva exige carencia observada, alternativas y decisión |
| D21 | `proofRequired` es política confiable del servidor, no un campo de la IR/receta | Planner, navegador y artefacto publicado no pueden activarlo, desactivarlo ni rebajarlo; la decisión liga `policyVersion`, `planHash` y evidencia aplicable |
| D22 | Plan y aprobación están ligados al actor | Un operator no aprueba un plan privado de requester: admin instala el artefacto genérico validado y el operator crea y revisa un plan nuevo bajo su identidad |
| D23 | Unicidad de aprobación y ejecución independiente de idempotencia HTTP | Una aprobación por `(tenantId, planId, planVersion, actorId)` y una ejecución por esa versión de plan; dos pestañas con claves distintas no duplican efectos |
| D24 | Reanudar conserva ledger solo con autoridad aún vigente | Aprobación, plan, política y precondiciones válidos permiten continuar; si expiran/cambian, se reconcilia primero y se termina sin efectos nuevos. Lo pendiente exige plan y aprobación nuevos ligados a `priorExecutionId` |

## Perfil MVP obligatorio

Roles canónicos: `admin` administra, instala, publica y revoca; `requester` pide y previsualiza; `operator` pide, previsualiza, aprueba y ejecuta funciones habilitadas; `viewer` solo consulta información autorizada. Un admin no debe usar un token omnipotente en el navegador. Hay un usuario de cada rol por tienda (ocho en total).

Además de la receta principal se implementan dos variantes acotadas para demostrar peticiones distintas: `catalog.category.assign.v1` (solo categoría) y `catalog.channel.assign.v1` (solo canal). Usan subconjuntos del mismo catálogo y las mismas garantías. No se simulan diferencias cambiando solo el texto del chat. Las tres formas tienen ejemplos en `contracts/`.

Incluir: autenticación, permisos server-side, UI integrada y accesible, chat, recuperación autorizada, oferta de reuse, compilación de plan, pruebas/validación, aprobación, worker durable, resultados por registro, instalación de acción, catálogo privado/compartido, publicación/revocación, auditoría, métricas, tests negativos y pruebas en dos tiendas.

Capacidades iniciales: `medusa.products.list`, `medusa.products.retrieve`, `medusa.product_categories.retrieve`, `medusa.sales_channels.retrieve`, `medusa.product_categories.products.add`, `medusa.sales_channels.products.add`.

Readback de asociaciones debe utilizar las operaciones verificadas por el spike. `add` es idempotencia semántica por pertenencia, no una promesa de idempotency keys soportadas por Medusa. El host debe comprobar de nuevo actor, recursos, elegibilidad y límites en cada paso. Si no puede cerrar una carrera con cambios externos, bloquear el caso o documentar la garantía más débil y el gate afectado; nunca afirmar CAS sin soporte.

Máximo inicial: 100 registros, 12 pasos por receta, sin recursión ni loops generales. `forEach: selectedProducts` es una iteración acotada gestionada por el runner; `dependsOn` se refiere al mismo registro. Una operación de categoría exitosa y una de canal fallida deben verse como parcial, no como éxito ni rollback automático.

## Fuera de la primera release

Marketplaces públicos, facturación, despliegue productivo, aplicaciones móviles, generar PRs automáticamente contra backends ajenos, ejecutar JavaScript de terceros, contenedores por usuario, vector DB dedicada, suscripciones/pagos y cumplimiento regulatorio certificado. REST forma parte del MVP; una fachada MCP comparte ejecutor/políticas y puede añadirse tras completar los gates básicos, sin bloquear el primer piloto Medusa. No confundir esto con el interés por ataques de herramientas: esos casos sí forman parte del benchmark de seguridad.

## Estados que no deben confundirse

- Plan: `draft`, `validating`, `ready`, `rejected`, `expired`, `superseded`.
- Aprobación: registro inmutable ligado a planHash, actor, tenant, scopes, expiración y límites. La aprobación no amplía permisos.
- Ejecución: `queued`, `running`, `waiting_reconciliation`, `succeeded`, `partial`, `failed`, `cancelled`.
- Paso: `pending`, `running`, `succeeded`, `skipped`, `unknown`, `failed`.
- Evidence status: `passed`, `failed`, `blocked`, `not_run`, `not_applicable`. Un proof adapter puede reportar `verified` solo en su propio resultado y se mapea a `passed` con alcance explícito.

El resultado canónico de un efecto incierto es `unknown`; `unknown_effect` es solo el nombre descriptivo de la condición, no otro enum. Un resultado de evaluación `inconclusive` se mapea a evidence status `blocked`, nunca a verde.

Cancelar impide nuevos pasos; las llamadas ya enviadas se reconcilian. La reanudación del mismo ledger solo continúa mientras aprobación, plan, política y precondiciones sigan vigentes. Si aprobación/política/plan expiran o cambian, la ejecución antigua no inicia más efectos: reconcilia primero todo `unknown` y termina `partial` o `failed` según lo observado. Los efectos aún ausentes requieren un plan nuevo que cubra solo lo pendiente, con `priorExecutionId`, preview, aprobación y ejecución nuevos; no repite efectos confirmados ni modifica el plan histórico. Solo `succeeded` con readback de todos los efectos requeridos significa éxito total.

## Registro de cambios

2026-10-24: el council sustituyó tags.add por asociación aditiva de categoría; detectó necesidad de política en rutas nativas; simplificó Temporal del diagrama a PostgreSQL para este piloto. Cambios futuros: ADR con problema, opciones, decisión, impacto en contratos/tests y evidencias invalidadas.
