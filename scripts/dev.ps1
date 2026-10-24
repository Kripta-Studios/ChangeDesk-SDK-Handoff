$ErrorActionPreference = "Stop"
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$envPath = Join-Path $root ".env"
$runRoot = Join-Path $root ".local/run"
$pidPath = Join-Path $runRoot "processes.json"
if (-not (Test-Path -LiteralPath $envPath)) { throw "Run bootstrap.ps1 and initialize-lab-secrets.ps1 first." }
foreach ($tenant in @("atlas", "boreal")) {
  if (-not (Test-Path -LiteralPath (Join-Path $root "evidence/local/seed-map.$tenant.json"))) { throw "Seed $tenant before starting the lab." }
  if (-not (Test-Path -LiteralPath (Join-Path $root "evidence/local/buyer-map.$tenant.json"))) { throw "Run the buyer-only seed for $tenant before starting the lab." }
}
if (Test-Path -LiteralPath $pidPath) {
  $alive = @(Get-Content -Raw -LiteralPath $pidPath -Encoding utf8 | ConvertFrom-Json | Where-Object { Get-Process -Id $_.pid -ErrorAction SilentlyContinue })
  if ($alive.Count -gt 0) { throw "Tracked lab processes are already running; use scripts/stop.ps1 first." }
}
docker compose --env-file $envPath -f (Join-Path $root "infra/compose.yaml") up -d --wait postgres
if ($LASTEXITCODE -ne 0) { throw "Docker Compose startup failed with exit code $LASTEXITCODE." }
& (Join-Path $PSScriptRoot "provision-lab.ps1")
if ($LASTEXITCODE -ne 0) { throw "Lab provisioning failed with exit code $LASTEXITCODE." }
New-Item -ItemType Directory -Force -Path $runRoot | Out-Null
$specifications = @(
  @{ name = "api"; script = "service-process.ps1"; arguments = @("-Mode", "api") },
  @{ name = "worker"; script = "service-process.ps1"; arguments = @("-Mode", "worker") },
  @{ name = "atlas"; script = "medusa-host.ps1"; arguments = @("-Tenant", "atlas", "-Command", "start") },
  @{ name = "boreal"; script = "medusa-host.ps1"; arguments = @("-Tenant", "boreal", "-Command", "start") },
  @{ name = "storefront"; script = "storefront-process.ps1"; arguments = @() }
)
$started = @()
foreach ($specification in $specifications) {
  $script = Join-Path $PSScriptRoot $specification.script
  $arguments = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ('"' + $script + '"')) + $specification.arguments
  $process = Start-Process -FilePath "powershell.exe" -ArgumentList $arguments -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runRoot "$($specification.name).out.log") -RedirectStandardError (Join-Path $runRoot "$($specification.name).err.log") -PassThru
  $started += [ordered]@{ name = $specification.name; pid = $process.Id; root = $root; startedAt = [DateTimeOffset]::Now.ToString("o") }
}
$started | ConvertTo-Json | Set-Content -LiteralPath $pidPath -Encoding utf8
$checks = @(
  @{ name = "api health"; url = "http://127.0.0.1:4100/healthz" },
  @{ name = "api readiness"; url = "http://127.0.0.1:4100/readyz" },
  @{ name = "Atlas"; url = "http://127.0.0.1:9001/health" },
  @{ name = "Boreal"; url = "http://127.0.0.1:9002/health" },
  @{ name = "buyer storefront"; url = "http://127.0.0.1:8001/" }
)
$deadline = (Get-Date).AddSeconds(60)
foreach ($check in $checks) {
  $ready = $false
  do {
    try { $ready = (Invoke-WebRequest -Uri $check.url -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 } catch { $ready = $false }
    if (-not $ready) { Start-Sleep -Milliseconds 500 }
  } while (-not $ready -and (Get-Date) -lt $deadline)
  if (-not $ready) { throw "$($check.name) did not become ready; inspect .local/run logs and run stop.ps1." }
}
foreach ($item in $started) {
  if (-not (Get-Process -Id $item.pid -ErrorAction SilentlyContinue)) { throw "$($item.name) exited during startup; inspect its .local/run log." }
}
Write-Output "Change Desk local lab is ready on API 4100, storefront 8001, Atlas 9001, and Boreal 9002."
