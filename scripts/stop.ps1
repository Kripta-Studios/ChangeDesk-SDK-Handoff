$ErrorActionPreference = "Stop"
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$pidPath = Join-Path $root ".local/run/processes.json"
if (Test-Path -LiteralPath $pidPath) {
  $tracked = @(Get-Content -Raw -LiteralPath $pidPath -Encoding utf8 | ConvertFrom-Json)
  foreach ($item in $tracked) {
    if ($item.root -ne $root) { throw "Tracked process root mismatch; refusing to stop PID $($item.pid)." }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($item.pid)" -ErrorAction SilentlyContinue
    if (-not $process -or $process.CommandLine -notlike "*$root*") { continue }
    $children = @(Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $item.pid -and $_.CommandLine -like "*$root*" })
    foreach ($child in $children) { Stop-Process -Id $child.ProcessId -ErrorAction SilentlyContinue }
    Stop-Process -Id $item.pid -ErrorAction SilentlyContinue
  }
}
Write-Output "Stopped only tracked Change Desk lab processes; PostgreSQL remains available."
