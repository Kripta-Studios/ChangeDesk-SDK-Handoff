# TDD, CI y aceptación del SDK

Estado: especificación para implementar; no es evidencia de pruebas ejecutadas. Fecha de consulta de fuentes: 2026-10-24. El objetivo es entregar un SDK integrado en dos Medusa locales con usuarios distintos, chat, funciones persistentes, reutilización autorizada y resultados comprobados. Una página que simula la operación no satisface este objetivo. Las decisiones canónicas de `00-DECISIONS.md` prevalecen sobre los ejemplos de este documento.

## 1. Qué significa terminar

Hay tres estados separados de entrega:

| Estado | Evidencia necesaria | Afirmación permitida |
|---|---|---|
| `SPEC_READY` | Contratos y documentos coherentes | Existe un plan implementable. |
| `LOCAL_VERIFIED` | Suites deterministas y Medusa real local, dos tenants, escenarios y recuperación | El sistema funciona en el entorno y versión registrados, con proveedor simulado donde se indique. |
| `LIVE_VERIFIED` | Todo lo anterior + proveedor LLM real, configuración y coste registrados, evaluación adversarial, revisión independiente | La ruta natural-language real está comprobada dentro del alcance ensayado. |

La ausencia de credenciales o presupuesto de proveedor marca `ACC-016 = BLOCKED`, no `PASS` ni `SKIPPED` equivalente a éxito. Se puede entregar avance `LOCAL_VERIFIED` con la limitación, pero el objetivo completo pedido no está terminado. No pedir credenciales en logs ni documentos: usar el mecanismo de secretos de la sesión/entorno. Si Docker no está operativo, resolverlo dentro del mandato de la sesión o registrar el bloqueo; continuar trabajo independiente sin convertir pruebas no ejecutadas en éxito.

No son evidencias suficientes: HTTP 200, un screenshot de la UI, un informe del propio agente generador, código de prueba que reproduce la misma función, un test marcado todo, una llamada LLM grabada reproducida como si fuera real, o un porcentaje de cobertura sin invariantes.

## 2. Orden de TDD y cortes verticales

Cada agente implementador toma un criterio observable y una frontera de contratos. Antes de añadir comportamiento sensible, escribe una prueba que falle por la razón esperada; guarda el nombre y fallo reducido. Implementa el mínimo, ejecuta la prueba y las suites impactadas, y refactoriza manteniendo el resultado. No introducir tests para cada ajuste visual menor ni duplicar todos los detalles internos.

1. **Contratos y política:** parser estricto de receta, roles y claims; rechazo de capacidades desconocidas, parámetros fuera de esquema y campos extra. El primer test demuestra que una receta propuesta no obtiene autoridad por existir.
2. **Lectura real:** adaptador Medusa lee un objeto de Atlas y no puede leer el de Boreal usando la identidad Atlas. Aquí ya se prueba el bridge y el backend real.
3. **Plan sin efectos:** solicitud produce candidato/plan; ninguna escritura en Medusa hasta aprobación válida. Oráculo independiente cuenta llamadas mutadoras y estado.
4. **Primera escritura acotada:** aprobación de plan exacto, ejecución, lectura posterior y recibo. La prueba incluye estado previo distinto al aprobado y permiso revocado.
5. **Durabilidad:** caída del worker antes/durante/después del efecto, leases, fencing, reconciliación y estado `unknown` visible. Probar esto antes de aumentar concurrencia.
6. **Interfaz:** widget y chat integrados, preview, aprobación, progreso, errores por registro y nueva acción reutilizable. Un navegador recargado debe recuperar la ejecución.
7. **Reutilización:** publicación explícita de plantilla genérica, búsqueda autorizada, oferta al usuario, instalación privada en Boreal, ejecución sin generar de nuevo. Similitud incompatible obliga a adaptación o rechazo.
8. **Adversarial y rendimiento:** parejas benignas/atacadas, entradas desconocidas, estado final, latencias y costes. Ejecutar contra los mismos contratos ya verificados.
9. **Proveedor real:** el mismo recorrido con un proveedor LLM real y límites de gasto, sin sustituir autorizaciones ni oráculos por juicio del LLM.

El registro de trabajo por criterio contiene `testId`, requisito, commit del test, motivo RED, commit GREEN, comandos, resultados y archivos de evidencia. No exigir un commit por línea; sí conservar una explicación verificable del fallo previo.

## 3. Capas de prueba

### Unitarias: dominio puro

Usar Vitest con una configuración y suites lógicas para unit, property, PostgreSQL, contratos, seguridad, recuperación y performance; Playwright solo para navegador, y el runner oficial de Medusa bajo esas suites. No añadir otro framework. Reloj, generador de IDs, límites y proveedor se inyectan. No usar fechas reales para expiración o una red real para parser/política.

- Parser de DSL: tipos, tamaño total, profundidad, cantidad de pasos, referencias a parámetros, ciclos/prohibiciones del contrato y capacidades permitidas.
- Política: actor, tenant, instalación, acción, colección de objetos y permiso vigente; matriz deny-by-default.
- Identidad de artefacto: canonicalización estable, digest distinto ante modificación de comportamiento o dependencias, exclusión de secretos de la publicación.
- Aprobación: el cambio de plan, parámetros, destinatarios, versión, actor, tenant o expiración invalida la aprobación. Comparar hashes mediante codificación canónica estable.
- Máquina de estados: transiciones admitidas, terminales no reabiertos por mensaje tardío, cancelación sólo de trabajo aún no aplicado.
- Matching: coincidencia exacta no basta sin permisos y compatibilidad; alta similitud no salta validación; un catálogo privado ajeno es indistinguible de uno inexistente.
- Redacción: valores secretos y datos privados nunca aparecen en resúmenes públicos; el test usa canarios rastreables en memoria, registros y errores.

### Propiedades y secuencias

Usar generadores deterministas pequeños dentro de Vitest y persistir seed y contraejemplo reducido; no añadir otra dependencia inicialmente. Si el generador propio deja una carencia observada de shrinking/cobertura, registrar alternativas y ADR antes de incorporar una librería.

- Cambiar un tenant no convierte un rechazo en acceso a datos ajenos.
- Para toda receta aceptada, cada paso ejecutable pertenece al conjunto de capacidades del manifiesto y al permiso efectivo del actor.
- Reordenar claves JSON no cambia el digest; cambiar un valor semántico sí.
- Repetir una orden con la misma clave de idempotencia y mismo cuerpo devuelve la misma identidad de ejecución; cuerpo diferente con la misma clave produce conflicto.
- Dos aprobaciones o inicios concurrentes del mismo `(tenantId, planId, planVersion, actorId)`, incluso con claves de idempotencia distintas desde dos pestañas, convergen en una aprobación y una ejecución. Otro uso legítimo crea un plan nuevo.
- Reordenar mensajes, duplicarlos o intercalar caída/reanudación no produce un estado final declarado `succeeded` sin evidencia de las postcondiciones.
- La publicación de una receta no modifica su instalación original ni las instalaciones fijadas a una versión previa.
- Un fallo de prueba/ley/evidencia invalida la promoción que requiere esa evidencia; `unavailable` no se serializa como `proved`.

Generar secuencias acotadas de órdenes y eventos con un modelo de referencia pequeño, independiente del código productivo. No usar el mismo reducer productivo como oráculo.

### Integración con PostgreSQL real

Levantar la versión fijada en el lock de entorno. Ejecutar migraciones desde cero y actualización de la versión anterior soportada. La cuenta de aplicación y worker no puede ser superuser, table owner con bypass, ni tener `BYPASSRLS`. El owner/migrator es distinto. PostgreSQL documenta estas excepciones a RLS; un test con la cuenta de migración no valida el aislamiento de la aplicación. [RLS de PostgreSQL](https://www.postgresql.org/docs/current/ddl-rowsecurity.html).

- Consultas con tenant ausente fallan cerradas; `SET LOCAL` se usa en transacción y no persiste en una conexión devuelta al pool.
- Leer/escribir con otro tenant falla; insertar filas con claves ajenas falla; jobs, approvals, installations, traces y caches reciben la misma comprobación.
- Un worker del pool recibe un job de Atlas seguido de Boreal: no arrastra el contexto anterior.
- Contención con dos workers: una orden sólo obtiene un propietario de lease válido; token de fencing viejo no actualiza ledger ni despacha otra escritura.
- Request/ejecución y fila `jobs` se insertan atómicamente en la misma transacción; un fault hook demuestra que una caída no pierde trabajo. No se requiere outbox, LISTEN/NOTIFY ni proxy de fallos.
- Revocación, retención y borrado por tenant no afectan datos de otro tenant ni artefactos compartidos aún referenciados. Las reglas de retención son las de `05-REUSE-COST-AND-SCALE.md`.
- Límite global y por tenant funciona bajo competencia; ninguna llamada se despacha después de exceder presupuesto admitido.

Las transacciones del ledger no cubren automáticamente el backend Medusa. Probar explícitamente la ventana entre una escritura externa y su recibo local.

### Contrato del adaptador y Medusa real

Usar las capacidades, usuarios y fixtures de `03-MEDUSA-INTEGRATION.md` y `../fixtures/medusa-scenarios.json`, nunca inventar endpoints sólo para hacer pasar tests. Dos instancias Medusa y dos bases separadas representan Atlas y Boreal; dos sales channels no equivalen a dos tenants.

Para cada capacidad hay pruebas de entrada válida, inexistencia, permiso insuficiente, conflicto, respuesta malformada, timeout antes del efecto, timeout después del efecto y lectura de reconciliación. Probar el contrato contra un fake controlable y contra Medusa real. El fake permite fallos reproducibles, pero no acredita compatibilidad con Medusa.

El oráculo de aceptación lee Medusa con una identidad verificadora independiente y sólo de test; compara el conjunto exacto de IDs afectados y campos permitidos. Compara también los registros excluidos y los campos que no debían cambiar. Esa identidad no está disponible para el SDK, planner o runner. No exportar su token.

Caso canónico: `catalog.campaign.prepare.v1` añade productos publicados seleccionados a una categoría de campaña y a un canal de venta ya existentes; `categoryId` y `channelId` son parámetros locales de la instalación. Se conservan todas las asociaciones previas, etiquetas, estado, precios y stock. No implementar este caso reemplazando arrays completos de etiquetas/categorías. La semilla definitiva está en `medusa-scenarios.json`: ocho productos por tienda, cinco elegibles, tres excluidos, tres asociaciones nuevas de categoría y tres de canal, y un producto ya completamente preparado. El mapa de IDs reales se genera por tenant, sin asumir IDs Medusa iguales entre tiendas.

Además del happy path, detener el adaptador después de confirmar la asociación de categoría y antes de registrar el resultado del canal; simular que el canal sí se aplicó pero su respuesta se perdió. La reconciliación debe leer ambas asociaciones y completar el ledger sin una escritura duplicada innecesaria. Si no se puede determinar el efecto, conservar incertidumbre y detener nuevos efectos dependientes. Una prueba distinta revoca permisos antes del segundo paso y verifica el resultado parcial explícito.

La matriz usa `admin`, `requester`, `operator`, `viewer` por tienda: requester puede solicitar y previsualizar pero no aprobar/ejecutar; operator puede ejecutar el ámbito concedido; admin gestiona instalación/publicación; viewer no obtiene permisos de escritura. Son roles de la política host de Change Desk, no una afirmación de que Medusa suministra de serie esta matriz. Probar el bypass directo de la ruta protegida y la coherencia del guard de integración.

### E2E navegador real

Playwright sobre widget integrado en Medusa, con backends reales y datos ficticios. Elegir elementos por rol/nombre accesible. Contextos de navegador separados por actor. Esperar estados observables y readiness, no pausas arbitrarias. Playwright recomienda probar comportamiento visible y aislar el estado de los tests. [Buenas prácticas de Playwright](https://playwright.dev/docs/best-practices).

Recorridos mínimos:

1. Admin Atlas habilita integración y catálogo permitido. Operator Atlas abre chat, pide la función definida en los fixtures, ve propuesta y preview; la acción sólo aparece tras el flujo de instalación/promoción definido.
2. Requester puede pedir y previsualizar pero no aprobar ni ejecutar, y su plan privado no se transfiere al operator. Para usar una propuesta nueva, admin instala el artefacto genérico validado; después operator formula su propia petición, crea un plan `NEW` bajo su identidad, recibe un preview fresco y lo aprueba. Operator no accede al chat privado ni al hash del plan del requester. Viewer no obtiene botones ejecutables ni puede saltarse la UI llamando a REST.
3. Cerrar/recargar navegador durante ejecución: se recuperan job, progreso y resultado; no se crea duplicado.
4. Publicación explícita de una plantilla genérica. Usuario Boreal formula petición similar: aparece oferta con fuente, versión y diferencias; no aparece ninguna referencia privada de Atlas.
5. Elegir «Usar esta función» siendo requester solo solicita la instalación. Admin Boreal instala y configura el artefacto genérico; después un operator autorizado crea bajo su identidad una petición y un plan nuevos, revisa el preview y aprueba/ejecuta sobre datos Boreal. Cancelar la oferta no instala ni ejecuta nada y un usuario no-admin jamás instala mediante esa acción.
6. Petición parecida pero semánticamente distinta: aparece adaptación/rechazo, no falso «ya disponible». Una nueva versión no actualiza instalaciones previas automáticamente.
7. Repetir mediante botón persistente no llama al LLM. Repetir por chat se mide separadamente porque el entendimiento lingüístico puede tener coste.
8. Nombre/descripción/model output con HTML, Markdown activo, enlaces maliciosos o texto de instrucciones se muestra como dato. No scripts, navegación privilegiada ni cambios de política.
9. Falla Change Desk: Medusa sigue navegable y sus operaciones habituales funcionan. Widget desmontado libera timers, listeners y conexiones.

Capturas sirven para revisar UI; los asserts sobre backend son obligatorios. No interceptar con mocks las llamadas Medusa de estos E2E. Se permiten mocks explícitos de servicios externos excluidos del piloto y el planner determinista en CI.

## 4. Matriz de aceptación

Los identificadores son estables. El nombre de un test debe comenzar con su `ACC-xxx`; un criterio puede tener varios tests. Los documentos de seguridad y Medusa aportan más casos, sin reducir esta matriz.

| ID | Requisito y verificación | Evidencia exigida |
|---|---|---|
| ACC-001 | Instalar desde checkout limpio y lock reproducible; readiness de API, worker y ambos Medusa | manifiesto de versiones, salida bootstrap, health checks |
| ACC-002 | SDK integrado con chat y acción persistente usando extensión oficial; sin alterar core de Medusa | E2E + diff de integración + captura |
| ACC-003 | Sesión falsificada, tenant cambiado, token expirado/audience errónea y rol viewer no obtienen autoridad | tests API negativos y cero cambios backend |
| ACC-004 | DSL inválida, capability/URL/código arbitrario, exceso de límites o referencia desconocida no llega al runner | corpus parser y spy de despacho |
| ACC-005 | Petición válida produce preview exacto; antes de aprobación hay cero efectos | estado previo + contador llamadas + E2E |
| ACC-006 | Aprobación vinculada a plan/actor/tenant/versión; cambio de estado o permiso exige nueva validación | pruebas de replay, stale y revocación |
| ACC-007 | Ejecución principal modifica exactamente los objetos/campos autorizados | snapshots redacted de antes/después + oracle |
| ACC-008 | Dos workers, mensajes duplicados y pérdida de respuesta no duplican efectos ni ocultan incertidumbre | timeline de fallos y reconciliación |
| ACC-009 | Caída y reinicio real de worker recupera o detiene de forma explícita; cierre del navegador no cancela implícitamente | pruebas fault-injection + E2E |
| ACC-010 | No hay cruce Atlas/Boreal en APIs, SQL, logs, caches, catálogo o instalaciones | matriz cross-tenant y canarios |
| ACC-011 | Publicación opt-in, oferta explícita y reutilización compatible en Boreal sin datos Atlas | dos contextos E2E + digest compartido + configs separadas |
| ACC-012 | Similitud incompatible no reutiliza; revocación/versionado afecta según política sin mutación silenciosa | pruebas matcher/política/versionado |
| ACC-013 | Corpus adversarial determinista no logra efectos no autorizados; resultado benigno sigue correcto | report paired + oracle + severidades |
| ACC-014 | Renderer resiste XSS, bridge impone CORS/CSRF, egress bloquea SSRF y destinos desconocidos | browser/API/network tests |
| ACC-015 | Umbrales de coste, bundle, latencia, fairness y memoria del documento 05 medidos | benchmark raw + máquina + comparación baseline |
| ACC-016 | Proveedor LLM real procesa peticiones y ataques del alcance, dentro de presupuesto | manifest modelo/proveedor + métricas + casos + coste |
| ACC-017 | Trazabilidad de petición a efectos, evidencia Bend declarada honestamente, retención y redacción | trace graph + law statuses + test de borrado/canarios |
| ACC-018 | Reinstalar/revertir integración no rompe app; documentación y replay del piloto funcionan para agente limpio | runbook reproducido + revisión independiente |
| ACC-019 | Un requester no transfiere plan/chat/hash privado: admin instala el artefacto validado y operator crea y revisa plan nuevo bajo su identidad | E2E con ACL y auditoría de ambos actores |
| ACC-020 | Expiración durante resume reconcilia unknown, detiene el ledger antiguo y exige plan nuevo solo para efectos ausentes | fault-injection con reloj, priorExecutionId y oracle sin duplicados |

Resultado por criterio: `PASS`, `FAIL`, `BLOCKED` o `NOT_RUN`, con causa. `BLOCKED` y `NOT_RUN` impiden afirmar cumplimiento completo. Un revisor no puede convertir un fallo funcional en éxito sólo cambiando el umbral o el fixture.

## 5. Pruebas de seguridad y ataques dirigidos por cambios

El documento `04-SECURITY-AND-LAWS.md` y `../fixtures/attack-cases.json` son el inventario normativo de amenazas. La CI implementa todos los casos deterministas aplicables y añade los contraejemplos encontrados. El conjunto live nunca se ejecuta en producción.

Cambiar schema/renderer/prompt/adapter/política/ley/modelo selecciona suites afectadas mediante un mapa de dependencias explícito. La selección incremental acelera PRs; una suite completa corre antes de release. Un cambio sin clasificación de impacto ejecuta todo el conjunto pertinente, no cero tests. Las pruebas nuevas se guardan aparte del holdout para evitar adaptar el prompt hasta memorizar la evaluación.

Medir por separado: ASR únicamente sobre intentos pareados live, válidos y realmente expuestos al modelo; utilidad limpia solo sobre tareas benignas autorizadas; `expected-deny` para peticiones no autorizadas; y tasas deterministas pass/fail para CSRF, RLS, schemas, autorización, egress e idempotencia. Una corrida de controles deterministas y otra live generan dos resultados, no una métrica combinada. El éxito del ataque lo determina el estado y observaciones de red/autorización, no que el modelo diga «hecho». Publicar denominadores, seeds, familias, severidad, incertidumbre y versión. Cero ataques observados no significa riesgo cero.

El proveedor fake devuelve también salidas maliciosas deliberadas. Esto prueba que las barreras resisten a un planner comprometido; no mide la resistencia de un modelo real al prompt injection. Una capa de filtros de lenguaje no sustituye a los controles del ejecutor.

## 6. Rendimiento y costes

Los umbrales y límites numéricos se mantienen exclusivamente en `05-REUSE-COST-AND-SCALE.md` y en su configuración versionada al implementarla. Son objetivos, no resultados conocidos. Registrar hardware, RAM asignada a Docker, sistema, versiones, procesos, tamaño de datos, concurrencia, calentamiento, duración y commit.

Comparaciones obligatorias:

- Medusa sin SDK; SDK instalado pero cerrado; SDK abierto sin trabajo; ejecución activa. Medir navegación/tiempo de respuesta, errores y CPU/memoria de ambos servicios.
- Primera generación, coincidencia exacta autorizada, adaptación, ejecución por botón instalada. Contadores LLM, tokens, llamadas Medusa, bytes y tiempo por etapa. Cero llamadas LLM es obligatorio en ejecución determinista de receta instalada; no afirmar lo mismo de una frase nueva arbitraria.
- A y B simultáneos: A satura su cola y B conserva servicio dentro del objetivo; backlog acotado produce backpressure visible. No medir throughput ignorando errores o rechazados.
- Caída de backend: no hay tormenta de reintentos; presupuesto y circuit breaker acotan carga. Volver a arrancar no duplica efectos.
- Sesión repetida: abrir/cerrar widget y ejecutar lotes no deja listeners, conexiones o memoria creciendo sin límite.

Umbral incumplido implica optimizar o reducir alcance explícitamente; no esconderlo en promedio. Separar latencia de control, proveedor y backend. El benchmark puede usar un adaptador de latencia constante para aislar overhead, pero la aceptación incluye medición contra Medusa real.

## 7. Contrato de comandos a implementar

Estos nombres son interfaces de desarrollo propuestas; todavía no existen ejecutables en este handoff. El equipo de bootstrap debe crearlos y documentar sus parámetros; no implementar comandos vacíos que salen 0.

| Comando | Obligación |
|---|---|
| `pnpm verify:locks` | rechaza versiones flotantes, acciones sin SHA, imágenes sin digest, archivos lock inconsistentes y placeholders pendientes en workflow activo |
| `pnpm lint` / `pnpm typecheck` | todo código del workspace, contratos, ejemplos y tests |
| `pnpm test:unit` | dominio, política, parser, canonicalización y renderer puro |
| `pnpm test:property` | propiedades con seeds y contraejemplos reproducibles |
| `pnpm test:integration` | Postgres real, RLS, ledger y concurrencia |
| `pnpm test:contract` | capacidades y adapter Medusa real, matriz de respuestas y permisos |
| `pnpm test:e2e` | Playwright en dos Medusa reales con chat fake; atributos visibles + oracle backend |
| `pnpm test:security` | corpus determinista, auth, tenant, XSS, CSRF, SSRF y aprobación |
| `pnpm test:recovery` | procesos worker detenidos en fault hooks y reiniciados |
| `pnpm test:perf` | benchmark y comparación con umbrales versionados |
| `pnpm test:llm:live` | proveedor real opt-in; sin credenciales retorna estado BLOCKED y código distinto de éxito |
| `pnpm test:laws` | integración de leyes y sus estados; si no hay checker no produce evidencia proved |
| `pnpm lab:up` / `pnpm lab:ready` | Compose del laboratorio local; readiness acotado e independiente por servicio |
| `pnpm lab:seed` | seed idempotente del laboratorio con tenant explícito y guard contra destinos no locales |
| `pnpm lab:down` | detener sólo recursos etiquetados de este laboratorio; sin borrar volúmenes por defecto |
| `pnpm evidence:collect` / `pnpm evidence:verify` | recoger manifiesto y resultados, comprobar sanitización, completitud y criterios obligatorios |

Los comandos destructivos de reset, si existen, requieren identificador explícito de laboratorio, validación del destino y una opción separada de confirmación. No utilizar glob global ni `docker system prune`.

## 8. CI por niveles

La plantilla `../templates/ci.yml.example` no se instala automáticamente en `.github/workflows`. Debe convertirse en workflow activo tras fijar dependencias y probar todos sus scripts. No contiene credenciales funcionales ni hashes inventados.

**PR sin secretos:** lint, tipos, build, unit, property, Postgres, Medusa real con planner fake, seguridad determinista, recuperación y smoke de tamaño/performance. Usa runners efímeros, `contents: read`, checkout del código PR sin secretos y sin `pull_request_target`. Sólo datos ficticios y credenciales locales efímeras. No publicar paquetes ni hacer deploy.

**Rama protegida:** mismos gates completos, matrices adicionales de navegadores/OS soportados, benchmark completo y migración. El soporte Windows se verifica mediante bootstrap en PowerShell y documentación; Linux CI no acredita Windows.

**Nightly/manual confiable:** proveedor real, corpus adversarial extendido, holdout, presupuestos de tokens/dinero, timeouts y egress restringido. Las credenciales viven en un entorno protegido y no se entregan a forks. Trigger programado corre únicamente en rama confiable; un título/body de PR no se interpola en shell. Agotamiento de presupuesto produce `BLOCKED_BUDGET`, nunca éxito silencioso.

**Release:** exige todos los criterios `ACC-*` definidos y aplicables en PASS con versiones finales, incluida cualquier incorporación posterior a la matriz; revisión humana o agente independiente de evidencia, inventario de dependencias/licencias, SBOM y paquete consumido por un ejemplo limpio. La publicación externa requiere el mandato específico de la sesión; este handoff no autoriza subir a un registry.

Las acciones de terceros se fijan a SHA completo verificado, con procedencia documentada. GitHub advierte sobre ejecutar PRs no confiables con privilegios y sobre filtraciones que la redacción automática no detecta. [Seguridad de GitHub Actions](https://docs.github.com/en/actions/reference/security/secure-use).

## 9. Evidencia y flakiness

Cada ejecución de aceptación genera un directorio `evidence/<run-id>/` con:

- `manifest.json`: commit, dirty flag, lock digests, versiones de runtime/Medusa/proveedor, fixture seed, reloj, hardware, configuración de límites, comandos y códigos de salida. No tokens ni prompts con datos privados.
- `acceptance.json`: ACC → tests → resultado → ruta de evidencia → motivo/limitación.
- `results/`: JUnit/JSON, propiedades reproducibles y resumen de seguridad.
- `state/`: before/after mínimo redacted y diferencias; IDs ficticios del laboratorio.
- `metrics/`: datos crudos, unidades, percentiles, errores, costes y baseline.
- `ui/`: capturas y, si se autoriza tras sanitización, trazas. Una traza de Playwright puede contener solicitudes y credenciales: no subirla sin inspección y eliminación de campos sensibles.
- `review.md`: revisión independiente y correcciones pendientes, separada del informe del implementador.

La observabilidad mínima son logs JSON con trace IDs y contadores probados. No se instala collector OpenTelemetry. Los fault hooks in-process cubren fallos deterministas; el gate real de respuesta perdida después de commit sigue ejecutándose contra Medusa, sin hacer obligatorio un proxy de red.

No subir `.env`, storageState con sesiones, dumps completos, HAR crudo, tokens o secretos aunque sean «de prueba» reutilizables. El colector aplica allowlist de archivos, scanner de canarios y límites de tamaño; un fallo de sanitización impide publicar artefactos. `evidence:verify --profile=ci-local` verifica estructura, sanitización y fidelidad de estados, y permite informes completos que contengan `FAIL` para conservar diagnóstico; no cambia el código de salida fallido de las suites anteriores ni concede aceptación. El perfil de release exige además todos los criterios requeridos en PASS. Retención CI propuesta de 7 días para detalles y 30 días para resumen sin datos, ajustada a la política final del documento 05.

Un test que falla y pasa en retry se marca flaky y el resultado original se conserva. No usar retries para convertir seguridad o negocio fallidos en PASS. Reintentos automáticos como máximo diagnósticos en UI y sin ocultar el fallo; la aceptación requiere una corrida limpia del caso corregido. Tests se aíslan por run namespace y tenant fixture; paralelismo no comparte objetos mutables accidentalmente.

## 10. Revisión independiente antes de cierre

El revisor recibe commit, diff, contratos, matriz ACC y evidencia; no participa en la implementación que revisa. Comprueba al menos un recorrido UI completo y un caso negativo desde una configuración limpia; compara la narrativa con comandos y estado. Busca especialmente acceso con rol viewer, contaminación de caché entre tenants, aprobación de otra versión, efecto aplicado antes de timeout, y conversión de texto del modelo en autoridad.

Veredictos: `ship-local`, `ship-live`, `fix-first`, `blocked-environment`. Cada uno incluye límites exactos. El coordinador incorpora las correcciones y vuelve a ejecutar los gates afectados; una corrección de seguridad invalida la revisión anterior de ese comportamiento. No emitir «seguro», «sin prompt injection» o «soporta miles de usuarios» como conclusión universal de una suite finita.
