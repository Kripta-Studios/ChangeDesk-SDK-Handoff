# Reutilización, coste y capacidad de Change Desk

Estado: especificación propuesta para implementar y medir. Fecha de contraste documental: 2026-10-24. Este documento no acredita que el SDK esté construido, que los límites resistan una carga real o que se haya alcanzado ahorro económico. Los nombres de entidades son conceptuales; `00-DECISIONS.md` y los contratos versionados en `contracts/` prevalecen para decisiones e identificadores ejecutables.

## 1. Resultado que debe ver el usuario

Una persona de `atlas` pide una función desde el panel integrado en Medusa. El sistema busca primero en las funciones que esa persona tiene permiso para descubrir. Si no existe una compatible, prepara una receta nueva y su interfaz declarativa. El usuario revisa los efectos; quien tenga permiso aprueba e instala la función. Reutilizarla posteriormente ejecuta la receta fijada, sin regenerarla ni llamar al modelo en el camino de ejecución.

Una persona de `boreal` pide después algo parecido. Solo podrá recibir una oferta basada en la receta de Atlas si su propietario autorizó publicar una versión genérica y el consumidor está autorizado a descubrirla. No se buscan contenedores de clientes, no se inspeccionan sus instalaciones ni se copian datos de Atlas. El sistema ofrece una función disponible en el catálogo, no revela qué cliente privado hizo una petición parecida.

La interfaz de oferta tiene cuatro resultados explícitos:

| Resultado | Qué se muestra | Acción permitida |
| --- | --- | --- |
| Coincidencia compatible | Nombre, objetivo, operaciones, efectos, procedencia pública y versión | Usar la instalación existente o solicitar instalar/configurar |
| Compatible con parámetros | Campos requeridos y límites del destino | Configurar con datos propios y preparar un plan |
| Parecida pero incompatible | Diferencias concretas; por ejemplo, falta una capacidad o cambió el contrato | Adaptar como versión privada y repetir validación |
| Sin coincidencia autorizada | Mensaje neutro de ausencia de resultados | Crear un borrador dentro de las capacidades disponibles |

No se instala ni ejecuta automáticamente por haber una coincidencia. Una persona sin permiso de instalación puede proponerla a un administrador, pero no elevar sus propios privilegios. El hecho de aprobar una receta para instalarla no autoriza todos sus futuros parámetros: cada ejecución prepara su plan y aplica la política vigente.

El caso canónico del piloto es `catalog.campaign.prepare.v1`: añadir productos seleccionados a una categoría y a un canal de venta existentes, con parámetros `categoryId` y `channelId`. Se añaden asociaciones sin sustituir las anteriores. La receta contiene referencias tipadas a parámetros; los IDs concretos pertenecen a cada instalación o ejecución privada. «Prepara estos productos para la campaña» en Atlas y «añade esta selección a nuestra categoría y canal de campaña» en Boreal pueden ofrecer el mismo artefacto cuando la compatibilidad lo confirma; sus selecciones, categorías, canales, permisos y aprobaciones no se comparten. Si alguien pide además cambiar precios o retirar asociaciones, ya no es esa misma función y debe mostrarse la diferencia.

## 2. Unidad de reutilización y clases de datos

Una receta es un programa declarativo finito, construido con operaciones permitidas y tipos conocidos. No contiene JavaScript, SQL, shell, plantillas ejecutables, endpoints arbitrarios ni reglas de permisos inventadas por un LLM. Su interfaz usa componentes incluidos en el SDK. El host decide los espacios de extensión que expone.

| Entidad | Contenido | Ámbito y persistencia |
| --- | --- | --- |
| `RecipeArtifact` | DSL, esquema UI, tipos de parámetros, requisitos de capacidades, efectos esperados, versiones de contratos y referencias a obligaciones | Inmutable. Privado por defecto; una versión genérica puede publicarse |
| `CatalogEntry` | Título revisado, descripción genérica, vocabulario controlado, propietario, licencia interna de reutilización, estado y ACL de descubrimiento | Entrada por ámbito autorizado; no contiene peticiones ni ejemplos de datos de clientes |
| `EvidenceManifest` | Digests de artefacto, intérprete, adaptador, leyes, políticas y pruebas; resultados genéricos y estado de verificación | Evidencia pública solo si se generó con datos sintéticos aprobados. Evidencia privada separada |
| `Installation` | Tenant, artefacto fijado, configuración, bindings permitidos, permisos de uso y branding | Privada. Referencias a secretos; nunca secretos en la receta |
| `Execution` | Actor, instalación, parámetros, selección, aprobación, pasos, intentos y resultados | Privada. Aislamiento por tenant y permisos por recurso |
| `GenerationJob` | Petición, borrador, iteraciones, consumo y errores | Privado. Nunca entra en un índice global |
| `OfferDecision` | Candidatos autorizados ofrecidos, compatibilidad, elección y versión de políticas | Privada y auditable; permite comprobar por qué se reutilizó o se adaptó |

Atlas y Boreal son dos instancias Medusa y bases de datos separadas. Dos canales de venta de una única tienda no acreditan aislamiento entre clientes. El servicio Change Desk puede compartir su propia infraestructura, pero `tenant_id` se obtiene del contexto autenticado en servidor, nunca de una afirmación del cliente o del modelo.

## 3. Identidad, versionado y compatibilidad

Se calcula `artifactDigest` a partir del JSON canónico validado de la receta. El objeto firmado incluye una etiqueta de dominio y versión de formato, para evitar reutilizar firmas entre tipos de objeto. El digest de contenido no incluye firma, fecha de publicación ni estadísticas; esos campos pertenecen al sobre firmado y al catálogo. La canonicalización debe usar una implementación contrastada de JCS y vectores de prueba, no una ordenación recursiva casera. JCS especifica una representación estable para hashing y firma; no prueba equivalencia semántica. [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785).

Reglas obligatorias:

- Una versión publicada nunca cambia de contenido. Una corrección produce otro digest.
- Dos textos de petición parecidos no tienen por qué producir la misma función.
- Dos planes cuyo orden de pasos cambia pueden tener efectos diferentes; no ordenar pasos para deduplicarlos.
- Se preservan los valores de cadenas tal como los define el contrato. No normalizar secretos, nombres o datos de negocio para forzar coincidencias.
- Una instalación apunta a un digest exacto, no a `latest` ni a un rango mutable.
- Las versiones del adaptador y las capacidades se negocian en servidor; una versión compatible por semver no sustituye las pruebas del contrato.
- El registro conserva `schemaVersion`, contrato de capacidades, política de efectos e identidad del intérprete en la evidencia; cambiar cualquiera puede exigir nuevas comprobaciones.

El validador calcula un resultado estructurado con `compatible`, lista de incompatibilidades, parámetros que faltan, operaciones requeridas, permisos necesarios y alcance de evidencia reutilizable. El motor no usa la puntuación semántica como autorización. La compatibilidad de receta no significa que el conjunto actual de registros sea válido: el plan de cada ejecución comprueba precondiciones y estado real de destino.

## 4. Búsqueda y decisión sin un servicio vectorial obligatorio

Orden del pipeline inicial:

1. Resolver actor, tenant, política y capacidades desde el bridge autenticado.
2. Si se pulsa una función ya instalada, resolver la instalación autorizada directamente: no hay búsqueda ni LLM.
3. Para una petición nueva, resolver primero coincidencia exacta estructurada y después comprobar una clave normalizada de intención dentro del ámbito autorizado. La normalización incluye operación de negocio, tipos, restricciones y versión del normalizador. Solo se admite atajo determinista para expresiones reconocidas; la ambigüedad vuelve a aclaración o planificación. No usar embeddings antes de demostrar con medición una carencia del matching estructurado/textual.
4. Buscar en instalaciones privadas autorizadas, catálogo del proveedor habilitado y catálogo compartido permitido. Filtrar ACL antes de construir candidatos, conteos, snippets o rankings.
5. Encontrar candidatos mediante campos estructurados y búsqueda textual de PostgreSQL. Limitar a un conjunto pequeño, inicialmente veinte. Se pueden usar sinónimos revisados y vocabulario bilingüe; no se requieren embeddings para el primer piloto.
6. Validar compatibilidad de los candidatos y ofrecer como máximo tres opciones comprensibles.
7. Solo si no hay solución compatible o el usuario solicita adaptación, abrir un trabajo de generación privado con presupuesto.
8. Antes de instalar, volver a comprobar disponibilidad, firma, permisos y compatibilidad. No confiar en la oferta anterior como token de autoridad.

Si posteriormente se añaden embeddings, se calculan únicamente para metadatos publicables y autorizados, con eliminación y revocación propagadas. Nunca se mantiene un índice global de resúmenes de conversaciones privadas. Las consultas de Atlas no se usan como ejemplos para contestar a Boreal. La adopción de embeddings necesita una comparación de calidad y coste frente al pipeline anterior, no solo que una librería esté disponible.

La clave de caché privada incluye tenant, actor o conjunto de permisos efectivo, versión de política, alcance de catálogo y huella de capacidades. No cachear resultados de una búsqueda amplia y filtrarlos después para otro usuario. El catálogo público autorizado puede cachear artefactos genéricos, pero cada petición vuelve a autorizar la referencia antes de devolver su contenido.

## 5. Publicación explícita y revisión del paquete

La publicación es una operación diferente de guardar una función privada. El flujo es:

`private_draft → private_validated → publication_review → published`

La revisión de publicación debe comprobar de forma determinista una lista positiva de campos permitidos. El paquete reutilizable debe parametrizar identificadores de productos, canales, etiquetas y conexiones; no debe contener IDs de Atlas, correos, URLs privadas, snapshots, prompts originales ni ejemplos extraídos de producción. Un escáner de secretos es defensa adicional; pasar ese escáner no basta para considerar genérico un paquete. Un resumen escrito por un modelo también puede filtrar datos y requiere la misma revisión.

El propietario con permiso de publicación ve exactamente el título, descripción, DSL, parámetros, UI, atribución y evidencia genérica que se compartirán. Se registra su autorización ligada al digest. En el piloto, solo un administrador puede publicar en el catálogo compartido y una segunda revisión técnica se exige para incorporar nuevas capacidades; adaptar parámetros de una receta aprobada no añade capacidades.

La firma autentica publicador e integridad; no demuestra corrección ni sustituye las pruebas. El consumidor valida firma, estado de la clave, digest, política y evidencia aplicable. Una firma desconocida, revocada o inválida impide nuevas instalaciones y pasos de escritura según el protocolo de revocación. No permitir que el campo `publisher` dentro del artefacto elija su propia clave de confianza.

Rotación: claves con identificador estable y periodo de validez; mantener las claves antiguas de verificación mientras haya versiones válidas instaladas; firmar versiones nuevas con la clave activa. Compromiso de clave requiere lista de revocación y evaluación de las versiones afectadas. La firma puede añadirse como sobre a un digest ya existente sin cambiar sus bytes ejecutables, pero no puede reescribir la historia de aprobación.

## 6. Revocación, actualización y concurrencia

Separar dos situaciones:

| Estado | Instalaciones nuevas | Instalaciones existentes | Ejecuciones activas |
| --- | --- | --- | --- |
| `withdrawn` por retirada del catálogo | No permitidas | Pueden seguir usando su versión si la licencia y política conservadas lo permiten | Continúan con sus límites y permisos |
| `security_revoked` | No permitidas | Se suspende iniciar trabajo nuevo | No iniciar otro paso; reconciliar el efecto del paso ya emitido y detenerse de forma explícita |

No prometer revocación instantánea de una llamada externa ya enviada. El ledger conserva qué se emitió y qué resultado se pudo observar. El protocolo debe consultar el estado de revocación antes de cada paso mutante; una caché de revocaciones positiva no debe alargar la ventana aceptada. En el piloto se consulta la base de datos, sin caché entre pasos. Si el control plane está inaccesible, no iniciar nuevos pasos mutantes.

Las actualizaciones se ofrecen como migraciones explícitas. Nunca cambiar silenciosamente una instalación A porque B publicó una variante. El plan de migración informa diferencias, permisos y pruebas nuevas; requiere nueva aceptación. Las ejecuciones ya aprobadas mantienen su versión fijada salvo una revocación de seguridad.

Para evitar generación duplicada, adquirir una reserva corta con clave privada de tenant, intención normalizada, contrato y restricciones. Un trabajo concurrente compatible puede esperar al mismo borrador; no compartir los parámetros privados entre usuarios que no tengan acceso. La reserva tiene caducidad y propietario, y no mantiene una transacción abierta durante la llamada al modelo. Que dos tenants pidan lo mismo no permite revelar una generación privada del otro. La deduplicación global se realiza solo sobre artefactos que ya son publicables y accesibles.

Insertar artefactos y asociaciones de catálogo con restricciones únicas apropiadas; un conflicto de inserción devuelve la versión existente solo después de comprobar autorización. No usar mensajes de conflicto o diferencias claras de respuesta para confirmar que existe un hash privado de otro tenant. Los IDs públicos de artefactos privados son opacos; el digest interno no es una URL pública. Se aceptan copias privadas entre tenants para evitar ese canal de información.

## 7. Ejecución compartida sin contenedores por usuario

Arquitectura mínima: un único artefacto/imagen TypeScript `apps/service`, ejecutado con entrypoint API o worker, y PostgreSQL. Cada función es una receta pequeña y configuración; no un despliegue, repositorio, servidor ni contenedor. Los componentes UI se distribuyen una vez con el SDK y los esquemas se cargan cuando se necesitan.

Las tablas de cola y ledger almacenan estados e identificadores. El worker reclama trabajos con transacciones breves, lease y heartbeat, y libera la conexión antes de llamar al backend. `SKIP LOCKED` permite evitar filas reclamadas por otros consumidores, pero no implementa por sí mismo reparto justo ni una visión consistente para consultas de negocio. La selección de tenant y el control de cuotas deben implementarse aparte. [PostgreSQL: SELECT y bloqueos](https://www.postgresql.org/docs/current/sql-select.html).

Algoritmo de reparto requerido: elegir de forma round-robin tenants con trabajo elegible y cuota disponible; reclamar hasta el cupo del tenant; registrar el lease; ejecutar un número limitado de pasos; devolver a cola cuando termina el tramo. Separar trabajos cortos de planificación y trabajos de ejecución para que la generación lenta no bloquee acciones ya aprobadas. En el piloto, un scheduler y un worker son suficientes; un segundo worker se usa en el test de reclamación concurrente, sin dar por probado escalado horizontal ilimitado.

Un lease vencido indica pérdida del ejecutor, no que el efecto externo no ocurrió. Otro worker debe reconciliar un paso incierto antes de cualquier repetición. La exclusión de escritura se apoya en claves de idempotencia o control de versión efectivo en el destino cuando estén disponibles. Si el destino no puede cercar a un worker antiguo y no permite reconocer el efecto, marcar intervención requerida; no prometer exactamente una vez. Nunca mantener un lock global durante una llamada de red para ocultar este problema.

La autorización SQL se prueba con el rol de ejecución real. Los roles de runtime no serán propietarios, superusuarios ni tendrán `BYPASSRLS`; usar políticas y contexto transaccional explícito, y limpiar ese contexto al devolver conexiones al pool. PostgreSQL documenta que propietarios y roles privilegiados pueden omitir RLS. [PostgreSQL: Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html). La cola administrativa puede tener acceso mínimo a IDs de trabajos para repartirlos; no debe convertir ese acceso en permisos generales sobre sus payloads.

## 8. Presupuestos iniciales medibles

Son objetivos del piloto, no cifras de capacidad verificadas ni SLA. La implementación debe registrar el hardware, versiones, semilla, carga y percentiles. Si otro documento establece un presupuesto central distinto, reconciliarlo antes de implementar y mantener una única fuente ejecutable de configuración.

| Concepto | Presupuesto inicial propuesto | Medición o reacción |
| --- | --- | --- |
| Launcher integrado | Objetivo duro ≤15 KiB gzip de JS propio, aún no medido; carga diferida | Medir build y waterfall; declarar peers y total all-in |
| Panel y renderer lazy | Objetivo duro ≤150 KiB gzip incremental, aún no medido; stretch opcional ≤60 KiB, no gate | Publicar medida sin peers y total all-in; sin ocultar React duplicado |
| Receta validada | ≤64 KiB de JSON canónico, ≤12 pasos declarativos | Rechazar tamaño o complejidad excesivos antes del modelo/runner |
| Instalación privada | ≤16 KiB de configuración; grandes selecciones por referencia | No guardar snapshots en configuración |
| Selección por ejecución piloto | ≤100 registros | Particionar en trabajos explícitos mayores en una fase posterior |
| Repetición desde función instalada | 0 llamadas LLM y 0 embeddings | Aserción con contadores instrumentados, no estimación de factura |
| Generación por petición nueva | Máximo 3 intentos del modelo y presupuesto configurable de tokens/coste | Al agotarse, conservar diagnóstico y requerir reformulación; no bucle ilimitado |
| Cola | ≤100 trabajos pendientes por tenant y ≤1.000 globales | Rechazar admisión con error tipado y `Retry-After`, no aceptar trabajo que no se guardará |
| Ejecución | 2 trabajos activos por tenant, 4 globales en el proceso inicial | Semáforos respaldados por estado compartido, sin multiplicar límites al añadir workers |
| Backend Medusa | Como inicio 2 llamadas concurrentes por instancia | Ajustar tras medir; sumar todas las recetas, no solo un endpoint |
| Generación | 1 trabajo activo por tenant, 2 globales | Cola separada y límites de proveedor; no bloquear API |
| Búsqueda caliente | Objetivo p95 ≤250 ms con 1.000 entradas autorizadas | Excluir y reportar aparte red externa y LLM; medir en entorno declarado |
| Admisión de ejecución | Objetivo p95 ≤300 ms, respuesta con ID durable | No incluir tiempo de completar llamadas Medusa |
| Lecturas de progreso | Polling HTTP 2 s activo, 10 s en segundo plano, detener al finalizar | Backoff y jitter; SSE/WebSocket fuera del MVP |

El objetivo de integración se mide con el ejemplo Medusa: un módulo/bridge backend y una extensión UI, sin modificar el core upstream. El número de líneas o minutos de integración se registra a partir del ejercicio real; no se prometerán «dos líneas» cuando hacen falta mapear permisos y capacidades.

Un piloto con dos tenants, cuatro usuarios por tenant y cientos de registros no demuestra capacidad para miles de usuarios activos. La suite de carga distinguirá usuarios registrados, sesiones conectadas, peticiones por segundo, trabajos activos y llamadas al backend. Añadir usuarios inactivos debería añadir principalmente configuración, no procesos. Aumentar workers puede saturar Medusa; el límite por backend tiene prioridad sobre capacidad de CPU disponible.

## 9. Almacenamiento, retención y costes

En el piloto, PostgreSQL guarda pequeños artefactos JSON, evidencias y metadatos. No se añade S3, CDN, Redis ni pgvector. Una futura salida a almacenamiento de objetos requiere necesidad medida y ADR, conservando digests y ACL.

Estimación ilustrativa, no benchmark: 1.000 recetas de 20 KiB son aproximadamente 20 MiB de payload antes de índices, WAL, versiones y backups. En cambio, un millón de ejecuciones con 10 KiB de evidencia son aproximadamente 10 GiB antes de esos costes. Por tanto, retención y tamaño de trazas pueden importar más que deduplicar recetas pequeñas. No se deben esconder esos costes afirmando que cada función «no ocupa casi nada».

Retención inicial configurable para datos sintéticos del piloto:

- Conversaciones y respuestas crudas del modelo: deshabilitadas por defecto en logs; conservar contenido necesario en almacenamiento privado hasta 7 días para depuración explícita.
- Payloads detallados y snapshots acotados de ejecución: 14 días, con eliminación programada verificable.
- Eventos de auditoría minimizados, aprobaciones y digests: 90 días. Evitar incluir datos de negocio en nombres y mensajes del evento.
- Artefactos instalados y evidencia necesaria para interpretar su versión: mientras estén referenciados; marcar versiones sin referencias para garbage collection con periodo de gracia de 7 días.
- Contadores de coste agregados por tenant y día: 90 días en piloto, sin prompts ni IDs de productos.
- Backups: documentar periodo de expiración y restauración; borrar en tablas activas no implica borrado inmediato del backup. Una restauración debe reaplicar tombstones de borrado antes de reabrir acceso.

La política de un cliente real se define explícitamente; estos plazos no son una afirmación de cumplimiento normativo. No borrar evidencia aún necesaria para resolver un paso incierto. Minimizarla y marcar el motivo de retención hasta cerrar la reconciliación.

Métricas obligatorias por petición: búsqueda, candidatos, decisión reuse/configure/adapt/generate, llamadas y tokens del modelo, tiempo de generación, coste estimado con tabla de precios versionada, coste facturado cuando exista, consultas DB, llamadas backend, tiempo en cola, reintentos y bytes persistidos. Tokens y euros se reportan por separado: un caché puede reducir coste pero no ser reutilización de una función.

Definiciones para comparar:

- `reuse_rate = peticiones resueltas con artefacto compatible ya existente / peticiones elegibles completadas`.
- `generation_avoidance = peticiones completadas sin llamar al modelo generador / peticiones elegibles completadas`.
- `backend_amplification = llamadas backend de Change Desk / llamadas de una implementación manual equivalente` con la misma tarea y reconciliación documentada.
- `successful_task_cost = coste total medido / tareas cuyo estado final coincide con el oráculo`.

Publicar también fallos, tareas no elegibles y abandonos. No mejorar artificialmente el ahorro excluyendo peticiones difíciles sin explicar el denominador.

## 10. Criterios TDD y aceptación

| ID | Preparación y acción | Oráculo independiente requerido |
| --- | --- | --- |
| REUSE-01 | A instala una receta compatible; otro usuario A autorizado pide la intención normalizada reconocida | Mismo digest; nueva selección privada; cero llamadas al generador; ejecución solo tras aprobación |
| REUSE-02 | A publica paquete genérico; B pide una función compatible | Oferta visible sin nombres, IDs ni datos privados de A; B elige instalar; config y ledger separados |
| REUSE-03 | A no publica; B pide exactamente el mismo texto | Ningún candidato, conteo, error o enlace revela la receta A; B puede generar su propio borrador |
| REUSE-04 | Usuario A sin permiso pide o adivina una receta restringida | No la descubre ni descarga por ID/hash; no aprovecha caché de un administrador |
| REUSE-05 | Parecido semántico pero falta una capacidad o cambia tipo/efecto | No se ofrece «usar»; explica incompatibilidad autorizada; adaptación genera versión y evidencia nuevas |
| REUSE-06 | Nueva versión publicada tras instalar v1 en A y B | Ambas instalaciones siguen fijadas a v1; migración explícita separada |
| REUSE-07 | Dos peticiones equivalentes simultáneas en el mismo ámbito | Un trabajo de generación activo para el mismo ámbito autorizado; estados durables tras reinicio |
| REUSE-08 | Dos tenants generan recetas privadas idénticas | No hay mensaje de deduplicación cruzada ni acceso compartido; estadísticas no revelan al otro |
| REUSE-09 | Receta retirada del catálogo sin incidente | No se instala de nuevo; instalaciones existentes siguen política de licencia fijada |
| REUSE-10 | Revocación de seguridad durante lote | No empieza otro paso mutante; efecto ya emitido se reconcilia; resultado parcial visible |
| REUSE-11 | Clave firmante inválida o digest alterado | Instalación y ejecución bloqueadas; no se confía en autoatribución del publicador |
| SCALE-01 | A llena su cola; B añade trabajo pequeño | B progresa según reparto; A recibe backpressure; no se exceden cupos agregados |
| SCALE-02 | Dos workers reclaman el mismo trabajo y uno pierde lease tras escritura | No se reejecuta ciegamente; el oráculo backend y ledger justifican reconciliación o intervención |
| SCALE-03 | Miles de instalaciones inactivas y cero ejecuciones | No se crean procesos/contenedores por instalación; memoria y consultas se miden y paginan |
| COST-01 | Ejecutar 20 veces la misma función instalada con parámetros válidos | Contador LLM y embeddings del runner igual a cero; coste backend y DB visible |
| COST-02 | El usuario nunca abre el panel | No se descarga bundle pesado ni se consulta el catálogo; solo launcher necesario |
| DATA-01 | Expira retención y se ejecuta limpieza | Payloads eliminados; auditoría minimizada preservada; no quedan búsquedas o cachés recuperables |
| DATA-02 | Se restaura backup con tenant borrado | Tombstone aplicado antes de abrir acceso; tenant sigue inaccesible |

Los tests de aislamiento consultarán el estado de ambas instancias Medusa y la base de Change Desk con un lector de pruebas independiente del agente. Los tests de coste instrumentarán llamadas reales del proveedor simulado. Los ensayos con LLM real se etiquetarán aparte: una simulación determinista no demuestra tasa de acierto del modelo.

## 11. Orden de implementación y decisiones aplazadas

1. Contratos de receta, instalación y contexto autenticado; fixtures de tenants y validación determinista.
2. Registro privado, versión fijada y ejecución repetida sin modelo.
3. Catálogo compartido opt-in, revisión genérica, ofertas y compatibilidad.
4. Concurrencia de generación, cuotas, backpressure y ledger de costes.
5. Revocación, retención, restauración y carga reproducible.
6. Solo con necesidad medida y ADR: embeddings, almacenamiento externo, más workers, transporte push o un orquestador dedicado.

No introducir marketplace público, código arbitrario generado, aislamiento por contenedor para cada usuario, descubrimiento global de datos privados, migraciones automáticas de instalaciones ni modelos entrenados sobre peticiones de otros clientes en el alcance inicial. El ahorro y la simplicidad provienen primero de no generar ni desplegar lo que ya puede representarse como una receta compatible.
