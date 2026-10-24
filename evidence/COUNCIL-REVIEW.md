# Council de preparación del handoff

Fecha: 2026-10-24. Alcance: documentación y contratos del futuro SDK; no código de producto ni evaluación de seguridad ejecutada.

## Participantes y proceso

Seis agentes redactaron producto/UX, arquitectura/datos, Medusa, seguridad/Bend, reutilización/coste y TDD/CI. Dos revisores independientes inspeccionaron los archivos y devolvieron `fix-first`. Tras la instrucción de modelos del usuario, las correcciones se asignaron explícitamente a **gpt-6.1-sol / high** y el council de simplificación a **gpt-6-astra / high**. No se atribuye retroactivamente esa configuración a agentes creados antes de la instrucción.

## Hallazgos aceptados y resolución especificada

| Hallazgo | Resolución |
|---|---|
| tags.update podía sustituir relaciones existentes | Demo usa asociaciones aditivas de categoría y canal |
| Roles del SDK podían eludirse por API nativa | Guard host sobre rutas relevantes y pruebas directas |
| Requester y operador compartían implícitamente plan privado | Admin instala artefacto; operador crea y revisa nuevo plan propio |
| Dos claves HTTP podían duplicar aprobación | Unicidad de aprobación/ejecución por plan-versión, independiente de clave HTTP |
| Reanudar aprobación expirada era ambiguo | Reconciliar ejecución antigua; nuevo plan de efectos faltantes enlazado por priorExecutionId |
| proofRequired no tenía autoridad definida | Política confiable server-side, ligada a policyVersion/planHash/evidencia |
| ASR mezclaba API controls y exposición live | Métricas de inyección live y controles deterministas separadas |
| Presupuesto 20/12 pasos y cinco/cuatro usuarios incoherentes | 12 pasos, cuatro usuarios por tenant |
| Instalación de oferta permitía saltar admin | Selección → instalación admin → plan/aprobación operator |
| SSE y estructura de muchos paquetes añadían complejidad | Polling, cuatro workspaces, una imagen de servicio con API/worker |
| Outbox/cola/vector/telemetría podían duplicar infraestructura | Un PostgreSQL con jobs transaccionales; sin servicios extra obligatorios |

## Decisión de simplificación

El council Astra recomendó mantener seguridad, recuperación, RLS, autorización nativa, pruebas live y evidencia de leyes, reduciendo infraestructura y dependencias. Las fronteras lógicas siguen existiendo como módulos; no necesitan convertirse en paquetes o microservicios separados. Atlas y Boreal conservan instancias, bases, permisos y secretos separados aunque compartan servidor PostgreSQL local.

## Revisión final

Revisor fresco configurado explícitamente como `gpt-6-astra`, razonamiento `high`, sin permisos de edición solicitados. Su primera revisión detectó que el gate de release aún citaba ACC-001..018 pese a existir ACC-019/020. El agente `gpt-6.1-sol/high` corrigió release/trazabilidad, unificó el contrato público del SDK y actualizó fixtures de polling y política de pruebas. Añadió validación de inventario ACC para prevenir esa regresión.

Tras inspeccionar las correcciones, el council emitió **`ship` para `SPEC_READY`**. La validación observada en ese momento fue `PASS: 79 specification checks; 31 files. No SDK tests executed.` La validación más reciente y su manifiesto están en `handoff-validation.json`.

También revisó la frontera de comunicación entre navegador, bridge host, servicio y worker: hay registro de conexión confiable, sesión efímera, delegación por paso, reautorización en host y receipts. Payloads exactos, provisioning de claves y comportamiento de endpoints se concretan y prueban en P0; no se consideran una implementación existente.

Riesgos abiertos de implementación: Docker/Medusa y dependencias fijadas, cobertura del guard nativo, concurrencia/TOCTOU, proveedor live, verificador Bend y métricas reales. Un `ship` de este paquete solo significa que las instrucciones son suficientemente coherentes para implementar; no valida el SDK aún inexistente.

Revisión adicional del documento 13: `ship`. Se distingue autorización de lecturas/preview/readback de aprobación necesaria para efectos; se limita la personalización sin redeploy a capacidades/componentes ya instalados. Verificación final observada: **84 comprobaciones del paquete correctas, 32 archivos en el manifiesto de especificación; cero pruebas de SDK ejecutadas**.
