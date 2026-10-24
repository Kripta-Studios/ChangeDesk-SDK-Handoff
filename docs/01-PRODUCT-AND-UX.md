# Producto y experiencia de uso

Estado: especificación de implementación; ninguna funcionalidad descrita debe presentarse como ya implementada. Fecha: 2026-10-24. Este documento fija decisiones de producto para el primer SDK y su prueba local en Medusa. Los contratos de seguridad, ejecución y compatibilidad prevalecen sobre una conveniencia visual.

## 1. Qué se construye

Change Desk es un SDK y un servicio que permiten a una aplicación ofrecer funciones adicionales compuestas a partir de sus capacidades autorizadas. El usuario describe una necesidad; el sistema busca una función existente o prepara una receta nueva, presenta sus efectos, obtiene aprobación y ejecuta operaciones deterministas. El resultado puede guardarse como acción reutilizable dentro de la aplicación.

El usuario no tiene que conversar en cada ejecución. El chat es una entrada opcional. La función guardada aparece como botón o formulario en una ubicación habilitada por el desarrollador. Un resultado del modelo no puede insertar JavaScript, HTML arbitrario, CSS global, consultas SQL ni llamadas a URLs elegidas por el modelo.

La integración inicial consta de un adaptador de capacidades, un puente de identidad y permisos, y una extensión visual. «Integrar una vez» significa configurar estos elementos para una versión concreta de la aplicación; no significa descubrir cualquier backend sin colaboración del desarrollador.

### Valor como hipótesis comprobable

| Persona | Necesidad | Resultado esperado | Medida del piloto |
| --- | --- | --- | --- |
| Operador de catálogo | Preparar un grupo de productos con reglas y excepciones | Una operación revisable y un resultado por producto | Tiempo hasta completar una tarea correcta; acciones manuales evitadas; errores detectados |
| Administrador del comercio | Controlar qué pueden instalar y ejecutar sus usuarios | Funciones con permisos, versiones y revocación | Tiempo para revisar una función; cambios no autorizados observados |
| Desarrollador de la aplicación | Atender variantes sin mantener un script por cliente | Un adaptador pequeño y recetas comunes | Tiempo de integración, código específico añadido, esfuerzo por segundo cliente |
| Proveedor del software | Reducir solicitudes repetidas de personalización | Catálogo de funciones instalables con configuración privada | Reutilización útil aceptada; coste por petición nueva y por ejecución repetida |

No se afirma ahorro real hasta comparar una tarea manual o una extensión escrita de forma convencional con Change Desk. Un chat atractivo, una receta generada o una prueba con proveedor simulado no demuestran por sí solos ese valor.

## 2. Alcance obligatorio del primer producto

El primer flujo se llama `catalog.campaign.prepare.v1`: asociar una categoría de campaña existente y asociar un canal de ventas existente a un conjunto explícito de productos que ya están publicados. Excluye borradores y productos fuera del ámbito del usuario. Conserva precios, inventario, estado de publicación, etiquetas existentes y asociaciones previas. No crea campañas comerciales completas, descuentos, pagos ni mensajes.

Capacidades candidatas del adaptador, que deberán coincidir con el manifiesto aprobado en la integración Medusa:

- `medusa.products.list`: búsqueda acotada para preparar una selección.
- `medusa.products.retrieve`: obtener el estado necesario para previsualización, validación y reconciliación.
- `medusa.product_categories.products.add`: añadir una asociación a una categoría sin sustituir las existentes.
- `medusa.sales_channels.products.add`: añadir la asociación al canal sin eliminar las existentes.

Los dos últimos nombres describen wrappers estrechos del adaptador. No autorizan al agente a inventar un endpoint de Medusa ni a escribir directamente en su base de datos. La implementación y sus límites se definen en [integración Medusa](03-MEDUSA-INTEGRATION.md).

El MVP completo incluye:

1. Dos instancias Medusa independientes, `atlas` y `boreal`, con datos sintéticos, identidades y bases separadas.
2. Un punto de entrada visual integrado en el administrador y una acción contextual sobre productos seleccionados.
3. Un chat acotado a las capacidades del piloto y un formulario alternativo para usar funciones instaladas.
4. Búsqueda de recetas accesibles, oferta de reutilización y comprobación de compatibilidad.
5. Generación estructurada de una receta cuando no existe una solución compatible; validación antes de cualquier escritura.
6. Previsualización por producto, aprobación de un plan concreto, ejecución y comprobación del estado final.
7. Guardar una función, usarla de nuevo sin regeneración y cambiar sus parámetros mediante formulario.
8. Publicación explícita de una plantilla genérica, instalación en el otro cliente y datos privados independientes.
9. Historial, permisos, costes medidos, versiones y evidencia de pruebas visibles según rol.
10. Casos de permiso insuficiente, estado cambiado, ejecución parcial, efecto desconocido, proveedor no disponible y revocación.

Fuera del MVP: modificar libremente cualquier pantalla; generar o ejecutar plugins arbitrarios; añadir operaciones inexistentes al backend automáticamente; publicar en un marketplace público; cobros, reembolsos o envíos reales; soporte universal de aplicaciones; garantizar ausencia de prompt injection. Una operación ausente se convierte en una solicitud de capacidad revisable por un desarrollador, fuera de la ejecución normal de la receta.

## 3. Identidad, roles y alcance visual

El tenant activo procede del puente de autenticación de la aplicación. No se acepta un tenant enviado por el chat, un parámetro editable, una cabecera manipulable o una selección de interfaz como autoridad. La cabecera del panel muestra el nombre del comercio y el usuario para reducir errores, pero los controles se aplican en servidor.

| Acción | `viewer` | `requester` | `operator` | `admin` |
| --- | --- | --- | --- | --- |
| Ver acciones instaladas accesibles | Sí | Sí | Sí | Sí |
| Consultar catálogo autorizado y detalle no sensible | Sí | Sí | Sí | Sí |
| Preparar un borrador y su previsualización | No | Sí, sin escrituras de negocio | Sí | Sí |
| Ver datos en una previsualización compartida autorizada | Solo lectura autorizada | Solo su ámbito | Solo su ámbito | Solo su ámbito |
| Aprobar y ejecutar una función | No | No | Si la política autoriza esas capacidades y recursos | Si la política autoriza esas capacidades y recursos |
| Guardar un borrador personal privado | No | Sí | Sí | Sí |
| Activar una función para el tenant | No | Puede solicitarla | Puede solicitarla | Sí |
| Publicar una plantilla fuera del tenant | No | No | No | Sí, con autorización de publicación |
| Revocar una instalación o publicación propia | No | No | No | Sí |
| Ver historial | Solo lectura autorizada | Propio y autorizado | Propio y autorizado | Ámbito administrativo autorizado |

Son roles de política del piloto, no una afirmación de que Medusa aporte de forma nativa este mismo modelo. El puente y el middleware de la integración deben imponerlos y comprobarlos en cada operación. Admin no implica acceso a otros tenants. Dos usuarios del mismo tenant tampoco comparten automáticamente conversaciones o solicitudes privadas.

Si un operador solicita una receta aún no instalada, puede preparar el borrador; el administrador activa esa versión para el tenant. Después el operador ejecuta únicamente acciones que su política ya permite. La activación no concede nuevas capacidades al usuario.

## 4. Superficies del SDK

### 4.1 Lanzador y punto contextual

Botón discreto «Personalizar acciones» en la ubicación configurada por la app. El panel se carga al abrirlo. No modifica navegación global, listeners globales de la aplicación ni componentes fuera de su raíz. Al seleccionar productos aparece «Crear acción con esta selección» si el usuario puede leerlos. La selección conserva IDs internos, no texto de instrucciones ejecutable.

No hay un chat flotante obligatorio ni un servicio de IA cargado al visitar cualquier pantalla. La instalación se puede ocultar por feature flag sin alterar las funciones existentes de Medusa.

### 4.2 Panel de solicitud

Un panel lateral contiene el comercio activo, la selección actual, el historial de esta solicitud y un campo para describir el objetivo. Ejemplos iniciales son objetivos acotados; nunca sugerir «haz cualquier cambio».

El envío crea una solicitud con identificador propio. Durante la preparación se muestran fases factuales: «Buscando funciones», «Comprobando compatibilidad» o «Preparando un plan». No se inventan porcentajes ni se muestra razonamiento interno del modelo. El usuario puede cerrar el panel; al volver recupera el estado autorizado desde el servicio.

Antes de enviar información a un proveedor externo, la integración aplica su política de datos y comunica de forma accesible qué tipo de información puede salir. Por defecto se usan IDs lógicos, tipos y valores estrictamente necesarios; no se envía todo el catálogo.

### 4.3 Oferta de reutilización

Cada candidato muestra nombre genérico, operaciones requeridas, versión, editor autorizado, compatibilidad, parámetros por completar y estado de verificación. Nunca muestra prompts originales, nombres de comercios privados, datos de productos del autor ni señales sobre la existencia de una función inaccesible.

Acciones posibles:

- **Usar esta función:** candidato compatible; abre configuración local. No ejecuta ni instala silenciosamente.
- **Solicitar instalación:** compatible, pero falta aprobación administrativa para activarlo.
- **Adaptar:** el cambio altera comportamiento o condiciones; crea una nueva versión y nueva validación.
- **Crear una nueva:** no hay un candidato suficiente; se registra el motivo y el coste de generación.

«Compatible» y «parecida» son estados distintos. Una coincidencia semántica nunca se etiqueta como lista para ejecutar sin validación. La interfaz explica una incompatibilidad concreta y no ofrece un botón de aprobación que la salte.

### 4.4 Configuración y selección

Formulario generado mediante componentes registrados: selector de productos, selector de categoría, selector de canal, resumen de exclusiones y límites. Los selectores obtienen opciones autorizadas del tenant actual. Los valores no se copian desde otro cliente aunque coincidan nombres.

Al cambiar una selección o parámetro se invalida la previsualización anterior. El modelo puede sugerir el significado de una petición ambigua; la selección final queda explícita. Si «los productos de verano» puede significar varias cosas, se muestran alternativas y se solicita aclaración antes de preparar escrituras.

### 4.5 Previsualización y aprobación

Tabla por producto: identificador visible, nombre tratado como texto, estado observado, categorías/canales antes, adiciones propuestas, resultado previsto o motivo de exclusión. Resumen separado: elegibles, sin cambios necesarios, excluidos y bloqueados. No sumar registros invisibles al usuario.

La pantalla muestra versión de la receta, instante del snapshot, alcance de la aprobación y límites. Botón «Aprobar y ejecutar» solo cuando el servidor declara el plan ejecutable y el usuario tiene permiso. El botón aprueba un plan inmutable con parámetros y selección concretos. Un cambio posterior requiere un plan y una aprobación nuevos.

No se usa un mensaje libre «sí» en un documento o respuesta del modelo como aprobación. Una confirmación desde el chat, si se ofrece, debe ser un control UI conectado al mismo endpoint autenticado de aprobación. El doble clic o el refresco no crea dos ejecuciones.

### 4.6 Progreso y resultado

El usuario ve el progreso por registro y por paso. Estados de registro: pendiente, ejecutando, sin cambios, completado, excluido, fallido, requiere revisión y efecto desconocido. El resumen del trabajo distingue completado, parcial, cancelado y bloqueado. Los nombres técnicos definitivos deberán mapearse a los estados canónicos del contrato; la etiqueta visual no cambia su semántica.

«Completado» exige comprobación de estado, no solo respuesta HTTP correcta. «Efecto desconocido» detiene reintentos inseguros hasta reconciliar. La acción de reanudar referencia el mismo trabajo y solo continúa los pasos cuya seguridad está comprobada. No hay botón genérico «Deshacer todo».

Cancelar solicita detener pasos futuros; no promete revertir efectos ya realizados. Si el usuario cierra el navegador, el trabajo sigue según su estado durable. Tras desconexión de eventos, la UI reconecta o consulta el estado, sin lanzar una ejecución nueva.

### 4.7 Funciones instaladas

Listado de acciones disponibles con versión, última validación y estado de instalación. La función guardada usa una configuración privada y una referencia a una receta inmutable. Su formulario reaparece en usos posteriores; no requiere una conversación ni una llamada al modelo para ejecutar parámetros válidos.

Una nueva versión no sustituye silenciosamente la instalada. Se muestra «Actualización disponible» con cambios, compatibilidad y evidencia; el administrador decide activarla. Una instalación revocada desaparece de las acciones ejecutables y sigue siendo visible en el historial autorizado.

### 4.8 Publicación y administración

El autor solicita compartir una función. El administrador recibe una previsualización del paquete genérico: propósito, contrato, capacidades, componentes UI y evidencia reutilizable. El sistema bloquea publicación si contiene IDs de instancia, datos del cliente, credenciales o contexto privado. Una revisión administrativa no sustituye esos controles.

La visibilidad por defecto es privada. Las opciones son privado, catálogo autorizado del proveedor o compartido de forma explícita con el público permitido por la política del piloto. No existe opción pública global en el MVP. La publicación no migra una instalación ni copia ejecuciones.

La revocación explica el alcance: impedir nuevas instalaciones/ejecuciones según política, conservar el historial permitido y aplicar el comportamiento de trabajos activos definido por el servicio. Nunca sugiere borrar o revertir efectos del backend ya ejecutados.

### 4.9 Historial y evidencia

Vista cronológica: solicitud → candidato elegido → receta/versión → validaciones → plan → aprobación → pasos → lecturas de reconciliación. Incluye actor, fechas, hashes de artefactos y estado; las cargas sensibles se ocultan y se autorizan aparte.

Panel de costes: llamadas al proveedor, tokens reportados, coste estimado con fecha y tarifa usada, duración y llamadas al backend. Si un dato no se conoce se muestra «No disponible», nunca cero. Distingue claramente proveedor simulado y proveedor real.

Panel de seguridad: controles deterministas, pruebas ejecutadas y cobertura del cambio. Bend tiene estados «No ejecutado», «No disponible», «Verificado para estas leyes», «Falló» y «No aplicable». Una marca de verificación debe identificar modelo formal, leyes, versión del verificador y artefacto. No equivale a certificar la API externa ni a afirmar «sin prompt injection».

## 5. Estados y comportamiento ante errores

| Situación | Lo que ve el usuario | Comportamiento requerido |
| --- | --- | --- |
| Sin selección | Ejemplo y selector vacío | No inferir un lote global |
| Solicitud vacía | Error junto al campo | No llamar al proveedor |
| Permiso insuficiente | Explicación sin datos ajenos | No ofrecer un bypass ni solicitar secretos al usuario |
| No hay candidato | «Preparar una nueva función» y alcance admitido | Generar solo con presupuesto disponible |
| Candidato similar incompatible | Motivo y opción de adaptación cuando sea posible | No activar el artefacto anterior |
| Capacidad inexistente | Describir la operación ausente y preparar solicitud técnica | No simular éxito ni usar scraping como sustituto oculto |
| Proveedor no configurado | Funciones instaladas siguen disponibles; creación por IA no disponible | Distinguir demo determinista de generación real |
| Proveedor agotado o caído | Borrador conservado y reintento explícito | No cambiar a otro proveedor ni enviar datos sin política |
| Presupuesto agotado | Límite y trabajo consumido | No bucle de regeneración ilimitado |
| Backend desconectado | Preparación o ejecución suspendida con ID del trabajo | No inventar previsualización actual |
| Estado cambiado desde aprobación | Filas afectadas y necesidad de revisión | No ampliar ni alterar silenciosamente lo aprobado |
| Escritura con timeout | «Comprobando si se aplicó» y, si persiste, «Requiere revisión» | Reconciliar antes de reintento |
| Conflicto concurrente | Campos o asociaciones relevantes afectados | Preservar cambios ajenos; detener la fila si no puede garantizarse |
| Cola llena | Trabajo no aceptado y posibilidad de volver a intentar | No mostrar ejecución iniciada si no fue encolada |
| Sesión expirada | Volver a autenticarse | No conservar acceso a datos del siguiente usuario |
| Instalación revocada | Acción deshabilitada y explicación | Revalidar en servidor, incluso con una pestaña antigua |
| Contrato incompatible tras actualización | Función pendiente de revalidación | No mostrarla como operativa por conservar un caché local |
| Contenido malicioso en nombres/descripciones | Texto inerte o rechazo de validación según el caso | Nunca convertirlo en instrucción, código o aprobación |

## 6. Recorridos de demostración

### A. Primera función en Atlas

1. Admin Atlas activa la integración y habilita las capacidades del piloto.
2. Operator Atlas selecciona productos publicados y un borrador de la fixture.
3. Pide «Añade la categoría de campaña elegida y el canal seleccionado a estos productos. Conserva lo que ya tienen; excluye los borradores».
4. El sistema busca primero. Si no existe una función compatible, prepara una receta candidata.
5. Admin activa la versión validada si aún no está disponible. Operator configura IDs locales y revisa la tabla; el borrador aparece excluido.
6. Operator aprueba. El sistema ejecuta y comprueba la categoría y el canal añadidos; precios, stock y relaciones anteriores se conservan.
7. La acción instalada permite repetirlo con otro lote sin llamadas al modelo.

### B. Reutilización en Boreal

1. Admin Atlas publica explícitamente el paquete genérico aprobado.
2. Operator Boreal pide «Prepara estos productos para nuestro canal de campaña y asócialos a la categoría elegida».
3. Se ofrece la plantilla accesible y compatible, sin revelar datos de Atlas.
4. Admin Boreal instala esa versión. Operator elige la categoría y el canal de Boreal, revisa y aprueba su propio plan.
5. Los dos clientes referencian el mismo artefacto compartido, con instalaciones, selección, configuración y resultados independientes.

### C. Mismo cliente, otro usuario

Viewer Atlas puede consultar información accesible, pero no generar un plan ni ejecutar. Requester Atlas puede pedir y previsualizar; no aprobar. Cambiar el rol en la UI o enviar la petición al endpoint directamente no concede permisos. Operator Atlas no puede leer la conversación privada de otro operador por conocer su ID. Los cuatro roles se prueban con identidades independientes en cada tenant.

### D. Petición que excede el contrato

«Además, aplica un descuento, envía correos y borra los productos de la tienda anterior». El sistema explica que esas operaciones no están habilitadas, no modifica la receta aprobada ni hace escrituras parciales correspondientes a la solicitud no aprobada. Puede ofrecer el subconjunto admitido como una propuesta separada, que exige aceptación explícita del usuario.

### E. Variación legítima

«Quiero solo los productos publicados de esta selección y que los ya asociados no cambien». Si eso ya coincide con el contrato, se reutiliza con parámetros. «Incluye borradores y publícalos» exige una capacidad distinta y se rechaza en el MVP; no se disfraza de una mera configuración.

## 7. Reglas de interacción e integración

- La interfaz usa un conjunto cerrado de componentes registrados: botón de acción, formulario, selector, tabla de plan, estado de trabajo y panel de evidencia. Todos los textos generados se escapan.
- El host decide las ubicaciones y temas. No se modifica el DOM por búsqueda heurística ni se reconstruye toda la aplicación.
- La caída del servicio deshabilita las funciones Change Desk con un mensaje local; navegar, editar y operar Medusa mediante su UI original sigue funcionando.
- Un error boundary aísla el panel. Desmontar el SDK limpia listeners, conexiones y estado local asociado al actor.
- Cambio de usuario/tenant invalida selección, cachés de solicitudes, eventos, permisos y datos privados en memoria. No basta cambiar el título del panel.
- La UI nunca es el control de autorización. Botones ocultos/deshabilitados deben corresponder a rechazos comprobados en backend.
- El coste y los presupuestos siguen [reutilización y escala](05-REUSE-COST-AND-SCALE.md). Carga diferida y ejecución repetida sin LLM son criterios del piloto, no un ahorro ya medido.
- Formularios y chat comparten el mismo flujo de preparación, aprobación y ejecución; no hay una ruta privilegiada exclusiva del chat.

## 8. Accesibilidad y localización

Idioma inicial español con identificadores técnicos en inglés; todos los textos visibles deben pasar por un catálogo de mensajes. Fechas se muestran con zona horaria; importes o costes muestran moneda y no mezclan valores estimados con facturados.

Uso completo por teclado: abrir/cerrar panel, seleccionar candidatos, editar formulario, inspeccionar filas, aprobar y consultar estado. Al cerrar se devuelve el foco al control de origen. Los diálogos tienen nombre accesible y foco controlado; el panel no bloquea toda la app sin necesidad. Los cambios de estado se anuncian con moderación mediante regiones vivas, sin leer cada token de una respuesta.

La información no depende únicamente de colores. Los errores se vinculan al campo y permanecen hasta resolverse. Las tablas tienen encabezados y un resumen textual. La confirmación identifica explícitamente el alcance afectado. La preferencia de movimiento reducido se respeta. Las comprobaciones automáticas deben acompañarse de una revisión de teclado y lector de pantalla del flujo principal.

## 9. Criterios de aceptación de producto

Estos IDs deben vincularse a pruebas concretas y evidencia en [TDD, CI y aceptación](06-TDD-CI-AND-ACCEPTANCE.md). Una captura aislada no demuestra efectos del backend.

| ID | Comportamiento que debe demostrarse |
| --- | --- |
| UX-001 | La app original funciona con SDK deshabilitado, servicio caído y panel desmontado. |
| UX-002 | El chat se carga al abrir; una función instalada puede usarse mediante formulario sin chat. |
| UX-003 | No hay escrituras al enviar una petición, buscar candidatos o preparar un plan. |
| UX-004 | Una selección vacía no se transforma en todos los productos. |
| UX-005 | El primer flujo real añade categoría y canal y conserva precios, stock, estado y asociaciones anteriores. |
| UX-006 | Los borradores y recursos fuera de ámbito se excluyen sin filtrar datos no autorizados. |
| UX-007 | La oferta de reutilización requiere elección y resuelve parámetros en el tenant receptor. |
| UX-008 | Una instalación privada no aparece para otro tenant ni para un usuario sin autorización. |
| UX-009 | La publicación exige admin y bloquea datos privados dentro del artefacto compartido. |
| UX-010 | Atlas y Boreal pueden usar el mismo artefacto compartido manteniendo instalaciones y resultados distintos. |
| UX-011 | Un candidato similar pero incompatible no puede ejecutarse como si estuviera validado. |
| UX-012 | Viewer no puede generar ni ejecutar; Requester puede preparar pero no aprobar ni ejecutar, tanto en UI como por endpoint directo. |
| UX-013 | La aprobación se corresponde con versión, parámetros, selección y snapshot mostrados. |
| UX-014 | Cambiar parámetros o detectar estado relevante obsoleto invalida esa aprobación. |
| UX-015 | Doble clic y reconexión no duplican el trabajo. |
| UX-016 | La UI diferencia completado, parcial y efecto desconocido con detalle por registro. |
| UX-017 | Cerrar/reabrir el panel recupera el trabajo sin repetir escrituras. |
| UX-018 | Cancelar informa de efectos ya aplicados y solo detiene lo que aún puede detenerse. |
| UX-019 | Repetir una función válida usa la receta instalada sin una llamada al modelo. |
| UX-020 | Una actualización o revocación no se ignora mediante una pestaña antigua o caché local. |
| UX-021 | Capacidad ausente produce una explicación verificable, no ejecución improvisada. |
| UX-022 | Fallo o ausencia del proveedor deja operativas las recetas instaladas autorizadas. |
| UX-023 | El historial muestra coste desconocido como desconocido y distingue proveedor falso de real. |
| UX-024 | Evidencia Bend solo muestra verificación para las leyes y artefactos realmente comprobados. |
| UX-025 | Nombres, descripciones y salida del modelo se representan como datos inertes, sin XSS ni instrucciones ejecutadas. |
| UX-026 | Cambiar de sesión limpia todo estado privado y detiene suscripciones del actor anterior. |
| UX-027 | El flujo principal es usable por teclado y expone estados y errores accesibles. |
| UX-028 | La versión activada no cambia silenciosamente cuando se publica una nueva. |
| UX-029 | Peticiones que exceden el alcance no ejecutan un subconjunto sin nueva aceptación explícita. |
| UX-030 | El piloto registra tiempos, acciones manuales y costes reales para comparar con la alternativa. |

## 10. Decisiones y cuestiones a resolver durante implementación

Decisiones cerradas: chat opcional; UI por componentes registrados; catálogo privado por defecto; publicación opt-in; instalación administrativa; aprobación por plan; dos instancias Medusa como frontera de cliente; ejecutor determinista; no capacidades financieras ni comunicaciones externas en el piloto.

Decisiones que necesitan evidencia de la integración: dónde insertar la selección múltiple sin modificar de forma frágil el administrador; qué metadatos permiten detectar cambios relevantes; cómo imponer permisos finos si la versión de Medusa instalada no los ofrece; cómo implementar la operación de añadir categoría sin perder cambios concurrentes. Si no puede garantizarse una propiedad necesaria, se reduce la capacidad o se bloquea la fila; no se relaja el contrato visualmente.

Este documento define el producto propuesto, no asegura encaje comercial ni resultados de seguridad. La demostración debe incluir tareas exitosas y rechazos correctos, con datos y efectos verificables, antes de declarar completo el SDK.
