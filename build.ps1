# Packages the extension into dist/ghost-job-detector-<version>.zip for Firefox / AMO.
# Uses forward-slash entry names (Compress-Archive on Windows PowerShell 5.1 writes
# backslashes, which AMO rejects).
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = $PSScriptRoot
$manifest = Get-Content (Join-Path $root "manifest.json") -Raw | ConvertFrom-Json
$dist = Join-Path $root "dist"
New-Item -ItemType Directory -Force -Path $dist | Out-Null
$out = Join-Path $dist ("ghost-job-detector-{0}.zip" -f $manifest.version)
if (Test-Path $out) { Remove-Item $out }

$include = @("manifest.json", "icons", "src", "popup", "options")
$zip = [System.IO.Compression.ZipFile]::Open($out, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($item in $include) {
    $path = Join-Path $root $item
    $files = if (Test-Path $path -PathType Container) { Get-ChildItem $path -Recurse -File } else { Get-Item $path }
    foreach ($f in $files) {
      $rel = $f.FullName.Substring($root.Length + 1) -replace "\\", "/"
      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $f.FullName, $rel, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
  }
} finally {
  $zip.Dispose()
}
Write-Host "Built $out"
