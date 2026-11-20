param(
  [Parameter(Mandatory = $true)][string]$Archive,
  [Parameter(Mandatory = $true)][string]$Destination
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = [System.IO.Path]::GetFullPath($Destination).TrimEnd([char[]]'\/') + [System.IO.Path]::DirectorySeparatorChar
$temporary = Join-Path $root ('.core-' + [Guid]::NewGuid().ToString('N') + '.part')
$zip = [System.IO.Compression.ZipFile]::OpenRead($Archive)
$restored = 0
try {
  foreach ($entry in $zip.Entries) {
    if (!$entry.Name) { continue }
    $target = [System.IO.Path]::GetFullPath((Join-Path $root $entry.FullName))
    if (!$target.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
      throw 'Core archive entry escaped the install directory.'
    }
    if ([System.IO.File]::Exists($target)) { continue }

    [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($target)) | Out-Null
    try {
      [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $temporary, $false)
      try {
        [System.IO.File]::Move($temporary, $target)
        $restored++
      } catch [System.IO.IOException] {
        if (![System.IO.File]::Exists($target)) { throw }
      }
    } finally {
      [System.IO.File]::Delete($temporary)
    }
  }
} finally {
  $zip.Dispose()
}
if ($restored) { Write-Host "Restored $restored files from the pinned core archive." }
