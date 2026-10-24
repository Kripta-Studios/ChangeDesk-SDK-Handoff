# Encargo listo para pegar en Codex

Trabaja en esta carpeta: `C:\Users\Álvaro Schwiedop\Desktop\KriptaStudios\ChangeDesk-SDK-Handoff`.

Implementa de principio a fin el SDK Change Desk definido aquí y pruébalo integrado dentro de dos Medusa locales con mock data. Usa un swarm de agentes y un council de revisión independiente. Lee primero AGENTS.md, START-HERE.md, docs/00-DECISIONS.md, contratos y docs/08-IMPLEMENTATION-PLAN.md; después asigna los documentos relevantes a cada agente. No vuelvas a proponer ideas de producto: convierte esta especificación en código, pruebas y demo real.

Configura los agentes de implementación y tests con `gpt-6.1-sol`/`high`, y los de ideas, coordinación/orquestación y revisión final con `gpt-6-astra`/`high`. Al lanzar agentes nativos usa `fork_turns="none"`, override explícito y un encargo autocontenido; no uses un `agent_type` que imponga otro modelo. Verifica primero que el runtime ofrece esos IDs y no inventes el modelo activo. La sesión principal conserva el modelo elegido al lanzarla. Si falta un modelo requerido, no hagas fallback silencioso: registra el routing `BLOCKED` y solicita una alternativa específica solo si bloquea esa tarea; continúa mientras tanto la documentación o trabajo independiente.

Quiero pedir funciones en lenguaje natural desde el chat integrado, revisar cambios, aprobarlos, ejecutarlos y conservar botones/formularios reutilizables. Debe funcionar con diferentes usuarios/roles y con dos clientes distintos. Si existe una función compatible compartida expresamente, ofrécela antes de generar otra y reutilízala con configuración privada. Implementa las tres peticiones acotadas de categoría/canal/campaña. No simules la generación live mediante un switch de prompts.

Prioriza bajo overhead, costes medidos, integración sencilla, permisos server-side y preservación del backend. No ejecutes código arbitrario del modelo ni confíes en texto recuperado como autoridad. Incluye trazabilidad, ataques dirigidos por cambios, benchmark paired clean/attack y adapter experimental de leyes Bend con evidencia honesta.

La arquitectura mínima de `contracts/technology-profile.json` es vinculante: exactamente cuatro workspaces, un solo artefacto de servicio con entrypoints API/worker, PostgreSQL como única infraestructura propia y polling HTTP. No añadas paquetes, servicios o dependencias por conveniencia; documenta primero una carencia observada, alternativas y decisión.

Puedes crear código, dependencias, Git local, worktrees, tests y servicios locales de este proyecto. No publiques, compres, uses cuentas productivas, envíes mensajes externos ni modifiques archivos/proyectos vecinos. Comprueba herramientas y Docker antes de arrancar; usa documentación oficial de la versión fijada. No leas secretos de otras carpetas. No crear una falsa seguridad con APIs admin en el navegador o roles solo visuales.

Sigue TDD en comportamientos relevantes y registra red/green. Prueba con Medusa real y Playwright, no solo mocks. Separa fake provider de live. Si falta una credencial, completa todo lo independiente, deja ese gate BLOCKED y especifica exactamente qué falta; no presentes fake como live. No debilites tests ni gates para concluir.

Mantén TASKBOARD.json y evidence/SESSION-HANDOFF.md. Coordina ownership de archivos y contratos para que los agentes no se pisen. Revisa los diffs y evidencia de los agentes. Persiste hasta completar los gates; el agotamiento de contexto no equivale a terminar.

Al acabar, abre ambas apps y muestra la demo: varias solicitudes/usuarios, publicación Atlas y oferta/reutilización Boreal, plan antes/después, ejecución por registro, fallo/rechazo de una petición no autorizada, trazabilidad y resultados de pruebas/coste. Deja instrucciones reproducibles, capturas y evidence/FINAL-REPORT.md con estados y limitaciones reales.
