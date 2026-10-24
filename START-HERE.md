# Instrucciones de arranque

El entregable de esta sesión fue una especificación. La sesión siguiente implementará el SDK. No hace falta que el usuario vuelva a explicar la conversación.

## Resultado esperado visible

1. Medusa Atlas y Boreal en localhost, con bases y sesiones separadas.
2. Usuarios con roles `admin`, `operator`, `viewer` y permisos de integración realmente aplicados en servidor.
3. Panel Chat/Personalizar dentro del Admin mediante una extensión soportada.
4. Petición natural → candidato o receta → validación → preview de efectos y exclusiones → aprobación → ejecución → readback → botón reutilizable.
5. Atlas publica una plantilla genérica; Boreal recibe una oferta compatible y la instala con sus propios recursos.
6. Ataques en entradas y datos, fallos parciales, timeouts y denegaciones dejan evidencia reproducible sin efectos prohibidos.

## Primeros pasos del coordinador

- Seleccionar **GPT-6 Astra, razonamiento High**, para la sesión coordinadora. Un agente no puede cambiar su propio modelo de sesión: usar la configuración de lanzamiento disponible. Asignar implementadores y testing a **GPT-6.1 Sol High**, y las ideas/revisiones finales a **GPT-6 Astra High**, según `contracts/agent-policy.json`; verificar la selección al crear cada agente.

- Leer decisiones y contratos. Convocar agentes con el protocolo indicado.
- Inspeccionar herramientas y puertos, Docker/WSL, Node, pnpm, Git, disco y memoria disponibles. No asumir que Docker esté arrancado.
- Implementar exactamente los cuatro workspaces de `contracts/technology-profile.json`; no convertir módulos internos en paquetes ni añadir Redis, Temporal, ORM, cola, SSE/WebSocket u otra infraestructura no prevista.
- Registrar `evidence/environment.json` y un ledger de tareas. Validar las fuentes Medusa y fijar una versión exacta compatible en todos los paquetes. No actualizarla a mitad de la demo.
- Completar una prueba técnica mínima de autenticación, extensiones y asociaciones categoría/canal antes de construir el producto alrededor de supuestos.
- Resolver mediante ADR cualquier discrepancia entre documentación y backend observado. Si una operación no existe, marcar capability gap; no sustituirla por escritura directa a tablas.
- Ejecutar el plan por fases. La primera vertical debe funcionar con proveedor determinista y Medusa real. Añadir después el proveedor live y ejecutar ambos gates por separado.

## Entorno local

Ruta original: `C:\Users\Álvaro Schwiedop\Desktop\KriptaStudios\ChangeDesk-SDK-Handoff`.

La ruta contiene espacios y caracteres no ASCII: usar argumentos estructurados o rutas literales y UTF-8. Preferir Docker Compose para bases/Medusa con volúmenes de desarrollo documentados; no copiar comandos Linux de producción directamente en PowerShell. Vincular servicios a `127.0.0.1` y elegir puertos libres de forma explícita. Mantener una tabla de puertos, URLs y health checks.

La UI del SDK comparte la sesión de la app a través del bridge de autenticación; no se entrega una admin API key al navegador. Datos ficticios, pagos deshabilitados y email externo bloqueado.

## Informe que debe quedar al terminar

`evidence/FINAL-REPORT.md`: commits/versiones, instrucciones de arranque/parada, URLs locales, cómo obtener credenciales de prueba generadas, pruebas realizadas y omitidas, métricas reales, límites, capturas y trazas redactadas. Adjuntar demo de varios usuarios en ambas tiendas y oferta de reutilización. Separar `implemented`, `verified`, `blocked`, `deferred`.
