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
- API: http://127.0.0.1:4100/healthz y `/readyz` (disponibilidad, no prueba de funcionalidades).
- Credenciales locales generadas: `examples/medusa/.local/credentials.atlas.json` y `credentials.boreal.json`. Son privadas e ignoradas por Git.
- Mapas del seed: `evidence/local/seed-map.atlas.json` y `seed-map.boreal.json`.
- Logs/PIDs: `.local/run/`. No publicar tokens, contraseñas o contenido de configuración privada.

Seleccionar productos, abrir el panel, solicitar una función, escoger candidato y parámetros locales, preparar preview y aprobar con actor autorizado. La biblioteca permite instalar y volver a planificar funciones. Un admin publica una plantilla explícitamente; otro tenant configura sus propios recursos. Estos recorridos están implementados; consultar FINAL-REPORT antes de asumir que todos han pasado E2E.

La sesión de demostración actual usa el checkout `.worktrees/environment`; sus mapas, credenciales y logs están bajo ese directorio. No reseedear el mismo PostgreSQL desde root mientras esa sesión esté activa.

## Proveedores

Codex es el predeterminado y su autenticación permanece fuera de Git. `CHANGEDESK_PLANNER_PROVIDER` admite `codex-cli`, `openai`, `deepseek`, `opencode` y `fake-test` explícito. Las APIs usan respectivamente `OPENAI_API_KEY`, `DEEPSEEK_API_KEY` y `OPENCODE_API_KEY`; requieren valores positivos para `CHANGEDESK_PLANNER_AUTHORIZED_BUDGET_USD` y `CHANGEDESK_PLANNER_MAX_PRICE_PER_CALL_USD`. No se han realizado llamadas pagadas de verificación.

Los perfiles revisados están en `apps/service/src/config.ts`: OpenAI gpt-6-luna, DeepSeek deepseek-flash y OpenCode deepseek-v4.1-flash. El wrapper del laboratorio todavía provisiona Codex; para despliegues API sin Codex se debe completar ese ajuste del wrapper, no omitir los límites de presupuesto. El modo fake requiere además `CHANGEDESK_ALLOW_TEST_FAKE=true` y nunca se presenta como proveedor real.

## Pruebas

```powershell
& $node scripts/verify-ci.mjs --lane unit
& $node node_modules/typescript/bin/tsc -p apps/service --noEmit
```

La lane PostgreSQL exige una base aislada `changedesk_test_<run>` con tres URLs y `CHANGEDESK_INTEGRATION_DATABASE_SCOPE`; no ejecutar el scheduler de tests sobre la demo activa. Las suites Medusa, navegador, Bend y proveedor real son lanes separadas. `CHANGEDESK_EXPECTED_PROVIDER=live|fake` distingue el gate browser. La evaluación adversarial bloqueada no debe reintentarse ni rerutearse.
