# Revisión de integración en curso

2026-10-24. No es el council final ni una aprobación de entrega. Hallazgos del coordinador sobre código integrado y pruebas independientes.

| Hallazgo | Evidencia / estado | Propietario |
|---|---|---|
| Checksum SQL distinto entre worktree y root | Confirmado CRLF/LF; reparado checkout, sin tocar DB/checksum. 73 pruebas integradas PASS. | root/storage |
| Seleccionar candidato desconocido alteraba request; instalación aceptaba artefacto inválido | Security reprodujo ambos sobre Fastify + PostgreSQL. Runtime0b410bb cierra provisionalmente con503; falta ruta funcional validada. | runtime/planner/security |
| Excepción admin en owner() de planes privados | RLS real ya denegaba con404, no exploit demostrado. Eliminada excepción inconsistente. | runtime/security |
| Plan exigía request e instalación a la vez; DTOs crudos; hash manifiesto cero | Revisado código, incompatible con creación inicial y botón instalado sin LLM. En corrección; no aceptado por tests de puertos simulados. | runtime |
| Intent de worker ocultaba estado durable; claves de reconcile inconsistentes | Storage4213aea preserva estado y vincula sesión aprobación. Adapter y worker requieren pruebas reales completas tras integración. | storage/runtime |
| Heartbeat/recovery solo nominales; callback host de autoridad ausente | Runtime implementa heartbeat/concurrencia, endpoint JIT pendiente de verificación real. | runtime |
| Issuer host bootstrap confundido con issuer delegación de servicio | Se pidió separación explícita y configuración coordinada. | runtime/environment |
| Fingerprint preview no comprobado contra producto actual | Estado/lock se comprueban, fingerprint y campos protegidos requieren verificación coordinada, sin invalidar relaciones añadidas por paso propio. | medusa/runtime |
| Codex probe basado solo en versión declarada | Corregido vínculo SHA256 del ejecutable medido; revisar flags/cwd y manifest exacto antes de aceptación live. | planner |
| Respuesta real Codex no satisface DSL | Ensayo semántico rechazado,11747input/294output/64reasoning; schema en corrección. No prueba live de producto. | planner |
| API budget local y estimación optimista | Sustituido por port de reserva durable y cota conservadora; cableado SQL y configuración real pendientes. | planner/storage/runtime |
| Bend podía contar unavailable como test de kernel verde; binaryPath distinto a executablePath | Solicitada separación lanes, binding binario/fuentes/toolchain y temp dentro workspace. Kernel aún pendiente. | core/environment |
| SDK build emitía JS en src | Root build cancelado;20 archivos generados propios eliminados. Frontend añade emitDeclarationOnly y smoke tarball. | frontend |
| Acciones instaladas/UI/recarga/import failure | Frontend15 pruebas PASS; falta comprobar Medusa real y waterfall lazy. | frontend |

Además siguen pendientes los gates completos de dos tiendas, pérdida de respuesta post-commit, revocación/stale, recuperación real de proceso/navegador, reuse firmado con mismos hashes y bindings privados, retención/restore,30parejas live/holdout, rendimiento, instalación limpia y CI ejecutable. No se cierran por la mera existencia de módulos.
