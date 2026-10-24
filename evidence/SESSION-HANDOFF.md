# Estado de implementación

Fecha: 2026-10-24. Objetivo completo EN CURSO, todavía no verificado.

- Baseline documental preservada en Git local: 8cfc8c0. Sin remoto ni publicaciones.
- Rama coordinadora master; worktrees dentro de .worktrees/: environment, core, medusa, storage, frontend, runtime y planner. Cada uno tiene rama impl/<rol> y ownership exclusivo.
- Overrides solicitados: implementación/testing gpt-6.1-sol/high; asesoría de arquitectura gpt-6-astra/high. Ver ADR-003 para límites de metadatos observables.
- Entorno: Windows; Node del sistema 25.8.1 no se usará como pin. Environment verifica Node22.23.4 LTS local; Docker Engine29.4.2 responde tras arranque. PostgreSQL pendiente. Ningún gate real aceptado aún.
- Puertos disponibles previstos: API4100, Atlas9001, Boreal9002, PostgreSQL5432. Readiness pendiente; no PIDs de proyecto confirmados aún.
- Propietarios: environment (tooling raíz/lockfile/infra y validator documental); core (packages/contracts, service core/policy); medusa (plugin backend, host compartido, seed); storage (SQL/migraciones/storage); frontend (SDK y plugin src/admin); runtime (API/adapter/runner/worker); planner (providers/catalog y binding SQL mediante storage).
- Coordinador conserva docs/contratos raíz, TASKBOARD y handoff. docs/14-IMPLEMENTATION-DECISIONS.md fija vocabulario, igualdad de schemas y claves de idempotencia; autoriza JCS contrastado con canonicalize5.1.0 verificado por environment.
- Los agentes deben conservar RED por comportamiento y GREEN. No existen todavía resultados de producto aceptados por root.
- Próximo trabajo: incorporar checkpoints tooling/types, probar P0 real, integrar persistencia y contratos bridge/runtime; continuar P2-P8 sin saltar gates.
- Proveedor real: usuario solicita Codex local autenticado por defecto y configuración posterior DeepSeek/OpenCode/OpenAI. No leer/copiar auth.json. ADR005 exige validar aislamiento de herramientas; primer probe CLI todavía expone herramientas, investigación en curso. No hay gasto API autorizado ni prueba live aceptada.
- Bend, browser E2E, seguridad real, recovery, benchmark, tarball y council final pendientes. No convertir pendientes en PASS.

Leer TASKBOARD y este archivo antes de reanudar. No repetir instalaciones/seed ni tocar servicios ajenos. Conservar especificación original como baseline.

Checkpoints incorporados: contratos e2503b0 + 10c49e3; tooling b5c8b6e + 0c7dc89; manifest servicio9454202. Comandos de test deben anteponer al PATH `.worktrees/environment/.tools/node-v22.23.4-win-x64` hasta instalar runtime local en root. Environment realiza instalación central de node_modules. No usar Node25 del sistema para evidencias finales.

P0 detectó montaje incorrecto del init de PostgreSQL por `--project-directory`; container sano no equivale a bases/roles preparados. Environment corrige/reset solo recursos del run identificado antes de validar readiness. El validator documental original recorre dependencias/worktrees sin límite; se canceló su ejecución y se restauró exclusivamente su salida generada propia. Environment debe acotar su inventario sin alterar gates.

Aplicar patches con rutas ABSOLUTAS del worktree: el cwd por defecto de apply_patch es root. Frontend y runtime corrigieron archivos propios creados inicialmente en root. No cherry-pick repetidamente commits ya integrados; preferir merges de checkpoints y comprobar diff.
