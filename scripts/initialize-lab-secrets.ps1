$ErrorActionPreference = "Stop"
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$envPath = Join-Path $root ".env"
if (-not (Test-Path -LiteralPath $envPath)) { throw "Run scripts/bootstrap.ps1 first." }

function New-LocalSecret {
  $bytes = [byte[]]::new(32)
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
  return [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

$values = @{}
foreach ($line in Get-Content -LiteralPath $envPath -Encoding utf8) {
  if ($line -match '^([A-Z0-9_]+)=(.*)$') { $values[$matches[1]] = $matches[2] }
}
$secretNames = @(
  "ATLAS_JWT_SECRET", "ATLAS_COOKIE_SECRET", "ATLAS_AUTHORITY_CREDENTIAL",
  "BOREAL_JWT_SECRET", "BOREAL_COOKIE_SECRET", "BOREAL_AUTHORITY_CREDENTIAL"
)
foreach ($name in $secretNames) {
  if (-not $values.ContainsKey($name)) {
    $value = New-LocalSecret
    Add-Content -LiteralPath $envPath -Value "$name=$value" -Encoding utf8
    $values[$name] = $value
  }
}

$openssl = (Get-Command openssl -ErrorAction Stop).Source
$keyDir = Join-Path $root ".local/keys"
New-Item -ItemType Directory -Force -Path $keyDir | Out-Null
function Ensure-KeyPair([string]$name) {
  $private = Join-Path $keyDir "$name.private.pem"
  $public = Join-Path $keyDir "$name.public.pem"
  if (-not (Test-Path -LiteralPath $private)) {
    & $openssl genpkey -algorithm ED25519 -out $private
    if ($LASTEXITCODE -ne 0) { throw "OpenSSL private-key generation failed for $name." }
  }
  if (-not (Test-Path -LiteralPath $public)) {
    & $openssl pkey -in $private -pubout -out $public
    if ($LASTEXITCODE -ne 0) { throw "OpenSSL public-key derivation failed for $name." }
  }
  return @{ Private = $private; Public = $public }
}

$pairs = @{}
foreach ($name in @("atlas-bootstrap", "atlas-delegation", "boreal-bootstrap", "boreal-delegation", "publication")) {
  $pairs[$name] = Ensure-KeyPair $name
}
$pathValues = [ordered]@{
  ATLAS_BOOTSTRAP_PRIVATE_KEY_PATH = $pairs["atlas-bootstrap"].Private
  ATLAS_BOOTSTRAP_PUBLIC_KEY_PATH = $pairs["atlas-bootstrap"].Public
  ATLAS_DELEGATION_PRIVATE_KEY_PATH = $pairs["atlas-delegation"].Private
  ATLAS_DELEGATION_PUBLIC_KEY_PATH = $pairs["atlas-delegation"].Public
  BOREAL_BOOTSTRAP_PRIVATE_KEY_PATH = $pairs["boreal-bootstrap"].Private
  BOREAL_BOOTSTRAP_PUBLIC_KEY_PATH = $pairs["boreal-bootstrap"].Public
  BOREAL_DELEGATION_PRIVATE_KEY_PATH = $pairs["boreal-delegation"].Private
  BOREAL_DELEGATION_PUBLIC_KEY_PATH = $pairs["boreal-delegation"].Public
  CHANGEDESK_PUBLICATION_PRIVATE_KEY_PATH = $pairs["publication"].Private
  CHANGEDESK_PUBLICATION_PUBLIC_KEY_PATH = $pairs["publication"].Public
}
foreach ($entry in $pathValues.GetEnumerator()) {
  if (-not $values.ContainsKey($entry.Key)) { Add-Content -LiteralPath $envPath -Value "$($entry.Key)=$($entry.Value)" -Encoding utf8 }
}
Write-Output "Generated or reused isolated lab keys and secret references in ignored local files."
