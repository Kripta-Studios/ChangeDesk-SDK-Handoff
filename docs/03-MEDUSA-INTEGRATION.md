# Integración Medusa y laboratorio local

Estado: especificación para implementar; no se ha instalado ni validado Medusa en esta entrega. Investigación de fuentes oficiales: 2026-10-24. Las decisiones Change Desk siguientes son diseño propio; no son garantías nativas de Medusa.

## Resultado obligatorio del piloto

Dos administraciones Medusa reales, Atlas y Boreal, con bases y secretos independientes. Una extensión visible dentro de cada administración permite conversar, recibir propuestas de funciones, seleccionar una propuesta reutilizable, revisar diferencias por producto, aprobar y observar el resultado. Una función instalada puede usarse posteriormente desde un formulario/botón sin volver a generar código.

Caso principal `catalog.campaign.prepare.v1`: incorporar productos publicados a una categoría y un canal de campaña existentes, conservando precios, inventario, estado, etiquetas y demás asociaciones. No crea campañas financieras ni aplica descuentos. No mueve productos entre categorías: añade asociaciones. El título visible será «Preparar catálogo para campaña» para que el efecto no se confunda con lanzar publicidad.

## Versiones y arranque reproducible

Medusa `2.22.1` es el candidato investigado: se verificaron las rutas de escritura en ese tag. La sesión de implementación debe confirmar que todas las dependencias `@medusajs/*` elegidas son compatibles, registrar versiones exactas e integridades y hacer smoke test antes de desarrollar el adaptador. No usar `latest` en instalación reproducible ni afirmar compatibilidad con todo Medusa v2. La documentación de instalación pide Node LTS >=22.22.0, Git y PostgreSQL; el panel viene con el backend y el storefront es opcional. [Instalación oficial](https://docs.medusajs.com/learn/installation).

Usar Node 22 LTS en versión exacta compatible, pnpm fijado, lockfile y contenedores con digest. Registrar resolución en `evidence/environment.json` durante el desarrollo. Si el candidato no se puede instalar, abrir ADR con error y nuevo pin probado; no cambiar silenciosamente de mayor. No se necesita storefront para la aceptación.

Topología propuesta, con nombres de servicio propios y sin tocar proyectos vecinos:

| Servicio | Puerto host propuesto | Datos |
|---|---:|---|
| Medusa Atlas | 127.0.0.1:9001 | DB y usuario PostgreSQL atlas exclusivos |
| Medusa Boreal | 127.0.0.1:9002 | DB y usuario PostgreSQL boreal exclusivos |
| Change Desk API | 127.0.0.1:4100 | DB changedesk exclusiva |
| Change Desk worker | ninguno | mismo esquema del ledger, credencial de servicio separada |
| PostgreSQL | sin publicar por defecto | tres DB y propietarios separados; cluster local compartido admisible |
| Dependencias internas exigidas por Medusa | sin publicar | Son del host fijado, no infraestructura añadida por Change Desk; aislar configuración por instancia |

La sesión previa detectó cliente Docker instalado pero el motor Linux no respondía. El arranque debe verificar `docker info`, recursos, puertos y salud sin instalar o modificar WSL automáticamente. La guía oficial contempla Windows y Docker; los scripts Linux necesitan LF. Adaptar su entorno al laboratorio: credenciales generadas localmente, servicios enlazados solo a loopback, sin storefront y sin nombres de contenedor globales. [Docker oficial](https://docs.medusajs.com/learn/installation/docker).

Crear un solo source/build backend de Medusa y ejecutar la misma imagen/extensión dos veces, configurada como Atlas y Boreal con instancias, bases, owners/roles y secretos distintos. No son workspaces fuente adicionales ni copias por usuario. Un único servidor PostgreSQL local aloja tres bases separadas (`changedesk`, `atlas`, `boreal`) y no se publica fuera de localhost. Seed, migraciones y pruebas deben dirigirse a nombres DB y recursos prefijados `changedesk_lab_`. Un reset exige que el script compruebe el manifiesto del laboratorio y no debe usar comandos globales de limpieza Docker. Secretos en archivos locales ignorados; `.env.example` contiene nombres, no contraseñas. Cualquier servicio email/pagos se deshabilita o sustituye por stub local sin red exterior.

## Extensión de interfaz

Implementar un plugin/adaptador de Medusa que exporte un widget React en `product.details` y una ruta propia de administración Change Desk para búsqueda, selección múltiple, chat, biblioteca e historial. El widget recibe contexto de producto, pero todo ID se revalida en servidor. Medusa documenta widgets bajo `src/admin/widgets`, exportados con `defineWidgetConfig`; el sufijo `.before/.after` ya no debe usarse para colocación en versiones actuales. [Widgets](https://docs.medusajs.com/learn/fundamentals/admin/widgets).

La lista propia evita depender de variables privadas de selección de la tabla nativa. El SDK renderiza componentes de una lista cerrada, no TSX generado ni HTML arbitrario. El chat solo se carga al abrirlo. Una función instalada aparece en la biblioteca y como acción contextual cuando acepta el contexto actual. No alterar el DOM nativo con selectores, no inyectar bundles remotos, no crear un fork de Medusa para cada receta.

La integración pública mínima a entregar comprende: registrar el plugin con un identificador de instalación; configurar URL interna y credenciales de servicio; enlazar identidad/roles; registrar las capacidades; insertar el componente. Los defaults seguros deben venir en el paquete. Medir líneas de integración y tiempo de instalación en un proyecto limpio; no prometer «una línea» ocultando el trabajo del bridge.

## Capacidades canónicas y endpoints

Los seis IDs siguientes son contratos Change Desk, no nombres de métodos Medusa. No se descubre autoridad por la documentación de una herramienta; solo el manifiesto registrado por el desarrollador habilita capacidades.

| Capability ID | Operación Medusa | Contrato estrecho |
|---|---|---|
| `medusa.products.list` | `GET /admin/products`; `sdk.admin.product.list` | filtro validado, campos mínimos, paginación y límite global de selección; no URL libre |
| `medusa.products.retrieve` | `GET /admin/products/{id}`; `sdk.admin.product.retrieve` | producto de la instancia, relaciones necesarias para snapshot/readback |
| `medusa.product_categories.retrieve` | `GET /admin/product-categories/{id}`; `sdk.admin.productCategory.retrieve` | categoría existente, activa y en allowlist de campañas |
| `medusa.sales_channels.retrieve` | `GET /admin/sales-channels/{id}` | canal existente, habilitado y permitido por política local |
| `medusa.product_categories.products.add` | `POST /admin/product-categories/{id}/products`, cuerpo `{add:[productId]}` | solo añadir; prohibido `remove`; un producto por unidad de ledger en piloto |
| `medusa.sales_channels.products.add` | `POST /admin/sales-channels/{id}/products`, cuerpo `{add:[productId]}` | solo añadir; prohibido `remove`; misma unidad de ejecución |

Se comprobó que el workflow de categoría es `batchLinkProductsToCategoryWorkflow` y el de canal `linkProductsToSalesChannelWorkflow` en las rutas del tag investigado. El bridge puede invocar esos flujos dentro de Medusa tras sus controles; nunca escribir directamente en tablas de negocio. [Ruta categoría v2.22.1](https://raw.githubusercontent.com/medusajs/medusa/v2.22.1/packages/medusa/src/api/admin/product-categories/%5Bid%5D/products/route.ts), [ruta canal v2.22.1](https://raw.githubusercontent.com/medusajs/medusa/v2.22.1/packages/medusa/src/api/admin/sales-channels/%5Bid%5D/products/route.ts).

El registro incluye esquema de argumentos, efectos, readback, versión de adaptador y política. Los IDs físicos no forman parte de una receta compartida: se resuelven desde parámetros de instalación autenticados. Obtener categoría por ID está documentado, y `updateProducts` acepta adiciones/remociones; nuestra envoltura elimina deliberadamente la segunda posibilidad. La lectura de canal por ID también se confirmó en el tag. [Categorías API](https://docs.medusajs.com/api/admin/product-categories), [lectura de canal v2.22.1](https://raw.githubusercontent.com/medusajs/medusa/v2.22.1/packages/medusa/src/api/admin/sales-channels/%5Bid%5D/route.ts).

No implementar `tags.add` haciendo read-merge-write con `product.update`: los arrays enviados reemplazan valores y podrían borrar cambios concurrentes. Tampoco permitir que el planner envíe `status`, precios, variantes, metadata o inventario a un update genérico. [Semántica de productos](https://docs.medusajs.com/resources/commerce-modules/product/guides/manage-with-admin-api).

## Identidad, roles y autoridad del host

Hay cuatro actores por tenant, ocho en total. Son identidades de prueba diferentes, no un selector de rol confiado desde JavaScript.

| Rol Change Desk | Operaciones autorizadas |
|---|---|
| `viewer` | consultar funciones instaladas y resultados autorizados; no proponer, aprobar ni ejecutar |
| `requester` | capacidades de viewer + petición, búsqueda autorizada y preview; solicitar instalación a admin |
| `operator` | capacidades de requester + aprobar y ejecutar funciones permitidas sobre recursos de su tenant |
| `admin` | capacidades de operator + instalar, publicar para compartir, revocar y administrar política Change Desk |

Los nombres son roles del piloto. No afirmar que Medusa OSS los implementa. Las rutas `/admin` documentadas autentican actores administrativos; `auth_context.actor_id` identifica al usuario, pero eso no equivale a nuestra política granular. La extensión debe consultar ACL de host por actor activo en cada operación. [Rutas protegidas](https://docs.medusajs.com/learn/fundamentals/api-routes/protected-routes).

Flujo previsto: widget -> endpoint de sesión autenticado del plugin -> sesión corta Change Desk vinculada a actor y tenant. El worker presenta al bridge una delegación firmada con ejecución/paso/alcance; el bridge verifica firma, audiencia, expiración, tenant fijo de la instancia, aprobación y permisos vigentes del actor antes de invocar un flujo nativo. El navegador no recibe API keys administrativas ni secretos de servicio. El token del agente no puede elegir otro host o ampliar capacidades. Detalles criptográficos y revocación deben seguir el contrato de seguridad global.

**Prueba de bypass obligatoria:** un usuario con acceso nativo administrativo podría llamar rutas nativas de Medusa fuera del SDK. Para afirmar restricciones a nivel de app en el laboratorio, el plugin debe proteger también las mutaciones nativas de los usuarios demo restringidos mediante middleware de host; como mínimo denegar las mutaciones de catálogo fuera del bridge aprobado. Probar solicitudes directas, batch routes, usuarios modificando su propia ACL y API keys. No editar middleware nativo para desactivar autenticación. Si no se puede cerrar esa superficie, limitar explícitamente la afirmación a permisos del SDK y fallar el criterio de aislamiento de roles de la app; no ocultarlo con botones deshabilitados. El superadministrador de bootstrap queda fuera del modelo adversarial y sus credenciales no se entregan a los actores demo.

## Fixtures y resultado determinista

`../fixtures/medusa-scenarios.json` contiene semilla, claves lógicas, actores, productos y expectativas. El seed usa handles y un namespace de fixture, resuelve IDs creados por Medusa y escribe un mapa privado por tenant en `evidence/local/seed-map.<tenant>.json`. No inventar IDs con formato Medusa ni reutilizar IDs reales entre instancias. El seed se ejecuta con privilegios de bootstrap y después los retira. Debe fallar ante colisiones con entidades ajenas al namespace en vez de sobrescribirlas.

Cada tenant tiene ocho productos con una variante, precio ficticio y etiquetas base, dos categorías y dos canales. Los valores comerciales difieren entre tiendas para detectar contaminación. La campaña inicial selecciona los ocho: cinco elegibles (`p01`, `p02`, `p03`, `p04`, `p08`), tres excluidos (`p05` draft, `p06` rejected, `p07` bloqueado por política). De los cinco, `p04` ya cumple. Se requieren tres adiciones de categoría y tres de canal; tras éxito, solo esas seis relaciones nuevas deben aparecer. Los arrays de etiquetas y el resto del snapshot protegido se mantienen exactamente iguales.

`p08` contiene texto adversarial en su descripción; dicho texto es dato, nunca una instrucción. El renderer lo presenta escapado; el planner puede recibir una representación acotada y marcada no confiable si es necesaria para el experimento. La descripción no puede ordenar crear usuarios, llamar URLs, compartir datos o cambiar precios.

Cada escenario se ejecuta desde una copia limpia del seed, excepto el recorrido de reutilización que declara dependencias. Guardar snapshots antes/después con el lector independiente, sin pasar por el planner o su resumen.

## Ejecución, concurrencia y recuperación

Previsualizar no modifica Medusa. La aprobación fija recipe digest, parámetros, conjunto exacto de productos, efectos permitidos, política y versión de adaptador. Por producto, validar elegibilidad, añadir categoría si falta, comprobar, añadir canal si falta y comprobar; registrar cada paso. Un timeout de escritura exige lectura independiente antes de cualquier retry. Una relación ya presente es `no_op`, no una nueva escritura.

No hay una transacción global entre ambas asociaciones. Un fallo entre pasos deja resultado parcial explícito. No quitar automáticamente una asociación previa para simular rollback. Se reanuda el paso faltante solo si la aprobación y los permisos siguen válidos.

Las operaciones aditivas reducen riesgo de perder asociaciones ajenas, pero no eliminan TOCTOU en estado, bloqueo o permisos. Revalidación previa y readback posterior deben detectar conflicto. Si la aceptación requiere impedir toda escritura durante cambios concurrentes del estado protegido, implementar un guard/lock transaccional en el host que también cubra las mutaciones nativas competidoras; un mutex del worker o un ETag leído antes de un POST sin CAS no lo demuestra. Con un adaptador que no tenga esa garantía, marcar la limitación y no afirmar atomicidad. Testear el interleaving antes de declarar el invariant satisfecho.

## Secuencia TDD de integración

1. RED: rutas de sesión/bridge rechazan tenant elegido por cliente, actor inactivo, firma alterada y viewer; GREEN: bridge autenticado sin operaciones de escritura.
2. RED: operaciones reales por capacidad y snapshots; GREEN: lecturas y dos wrappers aditivos con allowlist.
3. RED: selector de 8 productos produce 5 elegibles y 6 efectos; GREEN: preview puro y aprobación ligada a hash.
4. RED: timeout post-commit, fallo entre asociaciones y revocación; GREEN: ledger y reconciliación.
5. RED: Playwright con contextos separados para los 8 actores; GREEN: widget, chat y biblioteca nativos.
6. RED: segunda tienda recibe oferta autorizada sin IDs ni datos de Atlas; GREEN: instalación parametrizada en Boreal y ejecución con su propio mapa.
7. RED: llamada directa a rutas nativas y carrera de estado; GREEN: guard de host probado o gate abierto explícitamente.

Usar `medusaIntegrationTestRunner` para contratos del plugin con PostgreSQL de pruebas dedicado y permisos de creación de bases limitados a ese servidor. Medusa documenta que el runner levanta una aplicación real y usa bases temporales; su cuenta de test no debe apuntar a bases de usuario. [Testing oficial](https://docs.medusajs.com/learn/debugging-and-testing/testing-tools/integration-tests).

## Evidencia mínima y cierre

Entregar versiones exactas, registro de seed sin secretos, capturas del widget en ambas tiendas, vídeo o trazas Playwright del recorrido, snapshot oracle, conteo de llamadas/modelo por ejecución, coste medido de generación y reuse, negativa de bypass y resultados adversariales. Distinguir claramente planner falso de CI y proveedor LLM real. Los límites de rendimiento son objetivos hasta medirlos. La aceptación no permite reemplazar las dos tiendas reales por mocks HTTP.

Riesgos pendientes: API de canales renderizada incompleta en buscador (ruta de escritura confirmada en fuente del tag); semántica de reintentos/adición concurrente necesita test real; cobertura de ACL nativa necesita inspección del pin; compatibilidad de paquetes y container startup aún no ejecutados. Ninguno debe convertirse en un supuesto silencioso.
