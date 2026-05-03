#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Lists Prisma query_engine DLLs under services/ and reports whether each file is locked.

.DESCRIPTION
  On Windows, EPERM during prisma generate usually means another Node process still has
  query_engine-windows.dll.node loaded. Stop dev servers, Jest watchers, and IDE-run
  scripts that import @prisma/client, then re-run generate or pnpm prod:preflight.

.EXAMPLE
  pwsh scripts/diagnose-prisma-engines.ps1
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
if (-not (Test-Path (Join-Path $root 'services'))) {
  Write-Error "Run from repo root (services/ not found under $root)"
}

$files = @(
  Get-ChildItem -Path (Join-Path $root 'services') -Recurse -Filter 'query_engine-windows.dll.node' -ErrorAction SilentlyContinue
)

if ($files.Count -eq 0) {
  Write-Host 'No query_engine-windows.dll.node files found (run prisma generate in a service first).'
  exit 0
}

function Test-EngineLocked([string] $Path) {
  try {
    $fs = [System.IO.File]::Open(
      $Path,
      [System.IO.FileMode]::Open,
      [System.IO.FileAccess]::ReadWrite,
      [System.IO.FileShare]::None
    )
    $fs.Dispose()
    return $false
  }
  catch {
    return $true
  }
}

foreach ($f in $files | Sort-Object FullName) {
  $locked = Test-EngineLocked $f.FullName
  $rel = $f.FullName.Substring($root.Length + 1)
  if ($locked) {
    Write-Host "[LOCKED] $rel" -ForegroundColor Red
  }
  else {
    Write-Host "[ok]     $rel" -ForegroundColor Green
  }
}

Write-Host ''
Write-Host 'If any path is LOCKED: stop Node processes using that service (dev servers, tests),'
Write-Host 'or close processes holding the DLL, then retry prisma generate / pnpm prod:preflight.'
Write-Host 'To list Node processes: Get-Process node | Select-Object Id, Path'
