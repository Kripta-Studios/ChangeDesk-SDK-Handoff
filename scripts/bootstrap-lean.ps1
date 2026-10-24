$ErrorActionPreference = "Stop"
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$version = "4.34.0"
$archiveName = "lean-$version-linux.tar.zst"
$archive = Join-Path $root ".tools/downloads/$archiveName"
$destination = Join-Path $root ".tools/lean-$version-linux"
$expectedSha256 = "caaa98356098c85dc0fcbbd28e1ec66f39eb6551829972b752ff20e1286b646b"
$source = "https://github.com/leanprover/lean4/releases/download/v$version/$archiveName"

New-Item -ItemType Directory -Force -Path (Split-Path $archive), $destination | Out-Null
if (-not (Test-Path -LiteralPath $archive)) {
  Invoke-WebRequest -Uri $source -OutFile $archive
}
$stream = [IO.File]::OpenRead($archive)
$sha256 = [Security.Cryptography.SHA256]::Create()
try { $actual = ([BitConverter]::ToString($sha256.ComputeHash($stream))).Replace("-", "").ToLowerInvariant() }
finally { $sha256.Dispose(); $stream.Dispose() }
if ($actual -ne $expectedSha256) { throw "Lean archive checksum mismatch: $actual" }

$leanExe = Join-Path $destination "lean-$version-linux/bin/lean"
if (-not (Test-Path -LiteralPath $leanExe)) {
  tar.exe -xf $archive -C $destination
  if ($LASTEXITCODE -ne 0) { throw "Lean extraction failed with exit code $LASTEXITCODE." }
}
if (-not (Test-Path -LiteralPath $leanExe)) { throw "Lean executable missing after verified extraction." }
Write-Output $leanExe
