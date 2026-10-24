# Change Desk — SDK implementation handoff

Especificación para construir y verificar un SDK de personalización agéntica integrado en Medusa. Fecha de preparación: 2026-10-24. **Este repositorio contiene diseño, contratos y fixtures; no contiene todavía un SDK operativo ni evidencia de seguridad o rendimiento del producto.**

## Empezar en otra sesión de Codex

1. Abrir esta carpeta como workspace, sin dar al proyecto acceso a carpetas hermanas.
2. Leer [START-HERE.md](START-HERE.md) y [AGENTS.md](AGENTS.md).
3. Pegar [el encargo de ejecución](prompts/START-NEXT-SESSION.md).
4. Seguir las fases y gates de [implementación](docs/08-IMPLEMENTATION-PLAN.md). No volver a idear el producto desde cero.

Modelos solicitados: **GPT-6.1 Sol / High** para código, implementación y testing; **GPT-6 Astra / High** para ideas, orquestación y revisiones finales. La asignación ejecutable está en [agent-policy.json](contracts/agent-policy.json). No cambiar modelos silenciosamente si el entorno no los ofrece.

## Qué se entregará

Un SDK React ligero, un único artefacto de servicio con entrypoints API/worker y PostgreSQL; un plugin Medusa y dos instancias locales con datos ficticios y usuarios distintos. El usuario pide una función por chat, recibe candidatos reutilizables o un plan nuevo, revisa y aprueba los efectos, ejecuta y conserva un botón parametrizable. Una plantilla compartida expresamente puede ofrecerse a otro cliente sin compartir sus datos.

La implementación tiene exactamente cuatro workspaces fuente: `apps/service`, `packages/contracts`, `packages/sdk-react` y `packages/medusa-plugin`. El perfil vinculante de tecnologías y dependencias está en [technology-profile.json](contracts/technology-profile.json). Atlas y Boreal son dos instancias de ejecución del mismo source/build Medusa, no dos workspaces adicionales. Las dependencias propias de Medusa pertenecen al host y se reportan aparte del overhead añadido por el SDK.

La demo principal prepara campañas: añadir productos publicados seleccionados a una **categoría existente** y un **canal de ventas existente**, preservando precios, stock, estado y relaciones previas. No incluye pagos, envíos de mensajes ni llamadas a servicios productivos.

## Mapa de lectura

| Documento | Contenido |
|---|---|
| [Decisiones vinculantes](docs/00-DECISIONS.md) | Alcance, prioridades y decisiones que resuelven discrepancias |
| [Producto y UX](docs/01-PRODUCT-AND-UX.md) | Usuarios, pantallas, chat, ofertas y acciones persistentes |
| [Arquitectura](docs/02-ARCHITECTURE.md) | Componentes, interfaces y despliegue |
| [Medusa](docs/03-MEDUSA-INTEGRATION.md) | Instalación, capacidades reales, identidad y mock data |
| [Seguridad y leyes](docs/04-SECURITY-AND-LAWS.md) | Modelo de amenazas, Bend y ataques dirigidos por cambios |
| [Reutilización y coste](docs/05-REUSE-COST-AND-SCALE.md) | Catálogo, publicaciones, aislamiento, límites y presupuestos |
| [TDD y CI](docs/06-TDD-CI-AND-ACCEPTANCE.md) | Pruebas, gates y evidencia necesaria |
| [Ejecución y datos](docs/07-EXECUTION-AND-DATA.md) | Persistencia, estados, recuperación y concurrencia |
| [Plan de implementación](docs/08-IMPLEMENTATION-PLAN.md) | Fases hasta la demo verificada |
| [Swarm](docs/09-SWARM-PROTOCOL.md) | Roles, ownership, council y handoff entre agentes |
| [Contratos públicos](docs/10-API-AND-SDK.md) | REST, esquema de recetas y contrato del SDK |
| [Integración y despliegue](docs/13-INTEGRATION-AND-DEPLOYMENT.md) | Cómo se montan frontend/backend, qué comunica el agente y qué exige redeploy |
| [Límites y riesgos](docs/11-RISKS-AND-RELEASE.md) | Qué puede afirmarse, gates bloqueados y límites del piloto |
| [Trazabilidad de requisitos](docs/12-REQUIREMENTS-TRACEABILITY.md) | Requisito del usuario → fases → criterio de aceptación |
| [Contratos de máquina](contracts/README.md) | JSON Schema y ejemplos normativos |

Los presupuestos de coste y rendimiento son **objetivos iniciales**, no mediciones. La seguridad se evalúa mediante invariantes y pruebas; no se promete ausencia universal de prompt injection. Bend es una integración experimental del núcleo puro, no una prueba del backend externo.

## Verificación del paquete

`python scripts/validate_handoff.py` comprueba integridad documental, JSON, schemas y coherencia básica de fixtures. Requiere Python y `jsonschema` (disponible en el entorno de preparación). No ejecuta el SDK ni sustituye las futuras pruebas de integración. El resultado se escribe en `evidence/handoff-validation.json`.

No se ha instalado Medusa ni iniciado servicios durante la preparación de este paquete. El equipo observado tiene Git, Node, el cliente Docker y aproximadamente 31 GiB de RAM; el motor Docker no respondió. La siguiente sesión debe volver a verificar el entorno.
