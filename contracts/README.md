# Contratos de máquina v1

Estos JSON son **contratos de diseño**, no respuestas obtenidas de una aplicación implementada. El dominio `.invalid` de los `$id` es intencional: identificadores locales, nunca destinos de red.

- `recipe.schema.json`: IR declarativo para el piloto. El parser de implementación debe rechazar claves desconocidas, valores no finitos, nesting excesivo, payloads grandes y referencias fuera de la lista permitida.
- `recipe.example.json`: categoría + canal.
- `category-recipe.example.json`: categoría solamente.
- `channel-recipe.example.json`: canal solamente.
- `request.schema.json`: cuerpo de petición no confiable. No acepta actorId, tenantId, URLs, permisos ni credenciales.
- `approval-request.schema.json`: envío de aprobación. El servidor deriva actor/tenant y conserva la aprobación inmutable.

## Validaciones semánticas obligatorias además de JSON Schema

1. IDs de pasos únicos; referencias solo a pasos anteriores; DAG acíclico. `dependsOn` se aplica al mismo registro. No interpretar expresiones como código ni interpolar cadenas.
2. En este perfil cada capacidad mutadora aparece como máximo una vez por receta. `campaign.prepare` exige ambas; `category.assign` y `channel.assign` exigen exactamente la correspondiente.
3. `productId` tiene exactamente `{$record: "id"}`. `categoryId`/`channelId` solo se refieren al parámetro correspondiente. Claves y tipos coinciden con la capacidad; no se puede pasar channelId a category.add.
4. Parámetros y UI fields son exactamente los consumidos por los pasos; nombres únicos, tipos coherentes. UI labels se renderizan como texto. El backend no ejecuta instrucciones presentes en description/displayName.
5. requiredCapabilities equivale al cierre de las lecturas y escrituras necesarias: products.list/retrieve y retrieve/add de cada familia usada. El manifiesto del adaptador firmado por el operador proporciona efectos; el modelo no puede redefinirlos.
6. Compatibilidad exacta con versión probada del adapter y Medusa. Una cadena de versión proporcionada por el LLM no acredita compatibilidad. El validador y la evidencia la establecen.
7. Límite efectivo = mínimo de límites del contrato, tenant, usuario, backend y plan aprobado. IDs de recursos se resuelven en el tenant, jamás por coincidencia de nombres globales.
8. Una receta compartible no puede contener productos reales, categoryId/channelId concretos, prompts originales, correos, tokens, URLs privadas, nombres privados de clientes ni resultados. Schema válido no basta: revisar publicación y examinar etiquetas/descripciones.
9. Canonicalizar JSON sin metadata volátil con RFC 8785 para obtener artifactHash. Hashes de plan/evidencia separados, con dominio/versiones para evitar confusiones de tipo.

El servidor usa Ajv 8 con compilador Draft 2020-12 explícito y tests negativos; verificar durante implementación que Fastify no sustituye otro dialecto por defecto. `packages/contracts` exporta tipos TypeScript públicos y schemas por rutas separadas: el SDK importa tipos de forma type-only y no arrastra Ajv ni el SDK de Medusa al bundle por defecto. Solo se compilan schemas developer-owned revisados. Recetas y UI generadas por el modelo son datos validados contra schemas conocidos; nunca se compila un schema aportado por modelo/usuario como validador ejecutable. Los ejemplos no son la lógica hardcodeada del planner live: son fixtures del provider fake y referencias de contrato.

`technology-profile.json` es el perfil vinculante de workspaces, runtime, infraestructura, build y presupuesto de dependencias. Una dependencia nueva requiere carencia observada, alternativas consideradas y decisión registrada.
