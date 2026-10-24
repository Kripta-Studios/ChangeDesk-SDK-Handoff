$ErrorActionPreference = "Stop"
$env:MEDUSA_DISABLE_TELEMETRY = "true"
$env:MEDUSA_FF_ANALYTICS = "false"
& medusa @args
if ($LASTEXITCODE -ne 0) { throw "Medusa CLI failed with exit code $LASTEXITCODE" }
