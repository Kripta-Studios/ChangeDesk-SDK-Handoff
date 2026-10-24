$ErrorActionPreference = "Stop"
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$envPath = Join-Path $root ".env"
foreach ($line in Get-Content -LiteralPath $envPath -Encoding utf8) {
  if ($line -match '^([A-Z0-9_]+)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1], $matches[2], "Process") }
}
function Required-Environment([string]$name) {
  $value = [Environment]::GetEnvironmentVariable($name, "Process")
  if (-not $value) { throw "$name is required." }
  return $value
}
$capabilities = @(
  "medusa.product_categories.products.add", "medusa.product_categories.retrieve",
  "medusa.products.list", "medusa.products.retrieve",
  "medusa.sales_channels.products.add", "medusa.sales_channels.retrieve"
)
$tenants = foreach ($tenant in @("atlas", "boreal")) {
  $mapPath = Join-Path $root "evidence/local/seed-map.$tenant.json"
  if (-not (Test-Path -LiteralPath $mapPath)) { throw "Missing private seed map for $tenant." }
  $map = Get-Content -Raw -LiteralPath $mapPath -Encoding utf8 | ConvertFrom-Json
  $actors = foreach ($role in @("viewer", "requester", "operator", "admin")) {
    $actorId = $map.users."$tenant.$role"
    if (-not $actorId) { throw "Missing $tenant $role actor in private seed map." }
    [ordered]@{ actorId = $actorId; role = $role }
  }
  [ordered]@{
    tenantId = $tenant
    backendKey = $tenant
    policyVersion = "1"
    actors = @($actors)
    capabilityManifest = [ordered]@{
      id = "$tenant-medusa-v2-v1"
      adapterVersion = "medusa-2.22.1/changedesk-1"
      body = [ordered]@{ adapter = "medusa-v2"; capabilities = $capabilities; capabilityContract = "1"; verifiedMedusaVersion = "2.22.1" }
    }
  }
}
$publicKeyPath = [IO.Path]::GetFullPath((Required-Environment "CHANGEDESK_PUBLICATION_PUBLIC_KEY_PATH"))
if (-not $publicKeyPath.StartsWith($root + [IO.Path]::DirectorySeparatorChar)) { throw "Publication public key must be workspace-local." }
$config = [ordered]@{
  tenants = @($tenants)
  publicationKey = [ordered]@{ id = "local-publication-v1"; ownerTenantId = "atlas"; publicKeyPem = [IO.File]::ReadAllText($publicKeyPath, [Text.Encoding]::UTF8) }
}
$localRoot = Join-Path $root ".local"
New-Item -ItemType Directory -Force -Path $localRoot | Out-Null
$provisionPath = Join-Path $localRoot "provision.json"
[IO.File]::WriteAllText($provisionPath, ($config | ConvertTo-Json -Depth 8 -Compress), [Text.UTF8Encoding]::new($false))
$env:CHANGEDESK_MIGRATOR_DATABASE_URL = Required-Environment "CHANGEDESK_MIGRATOR_DATABASE_URL"
$env:CHANGEDESK_PROVISION_FILE = $provisionPath
$node = Join-Path $root ".tools/node-v22.23.4-win-x64/node.exe"
$moduleUri = ([Uri](Join-Path $root "apps/service/dist/provision.js")).AbsoluteUri
& $node --input-type=module -e "const module = await import(process.argv[1]); await module.main();" $moduleUri
if ($LASTEXITCODE -ne 0) { throw "Service provisioning failed with exit code $LASTEXITCODE." }
$pgUri = ([Uri](Join-Path $root "node_modules/pg/lib/index.js")).AbsoluteUri
$readback = @'
const [{default:pg},fs] = await Promise.all([import(process.argv[1]),import('node:fs')]);
const root=process.argv[2],client=new pg.Client({connectionString:process.env.CHANGEDESK_MIGRATOR_DATABASE_URL});
await client.connect();
try {
  for (const tenant of ['atlas','boreal']) {
    const map=JSON.parse(fs.readFileSync(`${root}/evidence/local/seed-map.${tenant}.json`,'utf8'));
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.actor_id',$2,true)",[tenant,map.users[`${tenant}.admin`]]);
    const result=await client.query('SELECT count(*)::int AS count FROM storage.capability_manifests WHERE active');
    await client.query('ROLLBACK');
    if (result.rows[0]?.count !== 1) throw new Error(`Expected one active capability manifest for ${tenant}.`);
  }
} finally { await client.end(); }
'@
& $node --input-type=module -e $readback $pgUri ($root -replace '\\','/')
if ($LASTEXITCODE -ne 0) { throw "Service provisioning readback failed with exit code $LASTEXITCODE." }
Write-Output "Provisioned two tenants and their trusted identities without printing secret material."
