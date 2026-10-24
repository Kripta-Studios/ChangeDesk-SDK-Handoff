# Laboratorio local

Estado: componentes instalados y arrancados en Windows; el recorrido funcional completo sigue pendiente. Los comandos siguientes reflejan los scripts disponibles; no se afirma un replay limpio completo de toda la secuencia.

## Instalación nueva

Requisitos: Windows PowerShell, Docker operativo y OpenSSL en PATH. El bootstrap instala Node22.23.4 y pnpm11.22.0 dentro del proyecto. Codex0.164.0 debe estar instalado y autenticado externamente; el wrapper verifica el digest revisado. No copiar auth.json ni claves al repositorio.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/bootstrap.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/initialize-lab-secrets.ps1
$node = (Resolve-Path .tools/node-v22.23.4-win-x64/node.exe).Path
$env:VITE_CHANGEDESK_ENDPOINT = 'http://127.0.0.1:4100'
& $node scripts/verify-ci.mjs --lane build
```

Cargar variables del archivo local generado sin imprimir valores y aplicar las migraciones del servicio:

```powershell
foreach ($line in Get-Content -LiteralPath .env) {
  if ($line -match '^([A-Z0-9_]+)=(.*)$') {
    [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process')
  }
}
Push-Location apps/service
try {
  & $node --input-type=module -e 'import {Pool} from "pg"; import {runMigrations} from "./dist/storage/index.js"; const pool=new Pool({connectionString:process.env.CHANGEDESK_MIGRATOR_DATABASE_URL}); try { await runMigrations(pool,"./migrations"); } finally { await pool.end(); }'
} finally { Pop-Location }
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/medusa-host.ps1 -Tenant atlas -Command build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/medusa-host.ps1 -Tenant atlas -Command migrate
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/medusa-host.ps1 -Tenant boreal -Command migrate
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/medusa-host.ps1 -Tenant atlas -Command seed
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/medusa-host.ps1 -Tenant boreal -Command seed
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev.ps1
```

El seed rechaza sobrescribir un namespace existente. En un laboratorio ya preparado, usar `dev.ps1` directamente; este aprovisiona las identidades confiables y arranca API, worker y dos hosts. `stop.ps1` detiene solo procesos registrados del proyecto y conserva PostgreSQL. No ejecutar reset del volumen compartido: otra sesión puede tener bases de prueba propias en ese servidor.

## Uso

- Atlas: http://127.0.0.1:9001/app/changedesk
- Boreal: http://127.0.0.1:9002/app/changedesk
- Storefront comprador: http://127.0.0.1:8001/ (selector Atlas/Boreal y sesión customer independiente).
- API: http://127.0.0.1:4100/healthz y `/readyz` (disponibilidad, no prueba de funcionalidades).
- Credenciales locales generadas: `examples/medusa/.local/credentials.atlas.json` y `credentials.boreal.json`. Son privadas e ignoradas por Git.
- Mapas del seed: `evidence/local/seed-map.atlas.json` y `seed-map.boreal.json`.
- Compradores: `examples/medusa/.local/buyer-credentials.atlas.json` y `buyer-credentials.boreal.json`; mapas `evidence/local/buyer-map.<tenant>.json`. No publicar estos archivos.
- Logs/PIDs: `.local/run/`. No publicar tokens, contraseñas o contenido de configuración privada.

Seleccionar productos, abrir el panel, solicitar una función, escoger candidato y parámetros locales, preparar preview y aprobar con actor autorizado. La biblioteca permite instalar y volver a planificar funciones. Un admin publica una plantilla explícitamente; otro tenant configura sus propios recursos. Estos recorridos están implementados; consultar FINAL-REPORT antes de asumir que todos han pasado E2E.

La sesión de demostración actual usa el checkout `.worktrees/environment`; sus mapas, credenciales y logs están bajo ese directorio. No reseedear el mismo PostgreSQL desde root mientras esa sesión esté activa.

Para añadir compradores a un laboratorio existente, ejecutar desde su checkout, después de incorporar y construir el código actualizado:

```powershell
$env:CHANGEDESK_SEED_BUYERS_ONLY = '1'
try {
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/medusa-host.ps1 -Tenant atlas -Command seed
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/medusa-host.ps1 -Tenant boreal -Command seed
} finally { Remove-Item Env:CHANGEDESK_SEED_BUYERS_ONLY }
```

Este modo añade dos customers por tienda y su clave pública de storefront sin recrear productos ni usuarios staff. Si falta el archivo de credenciales de un comprador existente, se detiene sin sobrescribir su cuenta. `dev.ps1` arranca también el storefront; `stop.ps1` incluye su proceso registrado. El puerto 8001 evita una reserva HTTP.sys ajena encontrada en 8000.

## Proveedores

Codex es el predeterminado y su autenticación permanece fuera de Git. `CHANGEDESK_PLANNER_PROVIDER` admite `codex-cli`, `openai`, `deepseek`, `opencode` y `fake-test` explícito. Las APIs usan respectivamente `OPENAI_API_KEY`, `DEEPSEEK_API_KEY` y `OPENCODE_API_KEY`; requieren valores positivos para `CHANGEDESK_PLANNER_AUTHORIZED_BUDGET_USD` y `CHANGEDESK_PLANNER_MAX_PRICE_PER_CALL_USD`. No se han realizado llamadas pagadas de verificación.

Los perfiles revisados están en `apps/service/src/config.ts`: OpenAI gpt-6-luna, DeepSeek deepseek-flash y OpenCode deepseek-v4.1-flash. El wrapper exige Codex únicamente para `codex-cli`; los perfiles API conservan sus requisitos de claves externas y presupuesto. El modo fake requiere además `CHANGEDESK_ALLOW_TEST_FAKE=true` y nunca se presenta como proveedor real.

La política `CHANGEDESK_PROOF_REQUIRED=true` exige `CHANGEDESK_WORKSPACE_ROOT`, `CHANGEDESK_BEND_BINARY_WINDOWS`, `CHANGEDESK_BEND_BINARY_LINUX` y `CHANGEDESK_BENDTT_LINUX`. El servidor fija los hashes revisados y limita tiempo/salida. Un resultado válido queda ligado al hash final del plan, artefacto, política y entorno; ver ADR-015. Si falta el verificador, falla cerrado. Esta evidencia solo cubre el modelo puro de asociaciones, no los efectos de Medusa.

## Pruebas

```powershell
& $node scripts/verify-ci.mjs --lane unit
& $node scripts/verify-ci.mjs --lane functional
& $node node_modules/typescript/bin/tsc -p apps/service --noEmit
```

La lane PostgreSQL exige una base aislada `changedesk_test_<run>` con tres URLs y `CHANGEDESK_INTEGRATION_DATABASE_SCOPE`; no ejecutar el scheduler de tests sobre la demo activa. Las suites Medusa, navegador, Bend y proveedor real son lanes separadas. `CHANGEDESK_EXPECTED_PROVIDER=live|fake` distingue el gate browser. La evaluación adversarial bloqueada no debe reintentarse ni rerutearse.
