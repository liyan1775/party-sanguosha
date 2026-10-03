param(
  [ValidateSet('Start', 'Stop')][string]$Action = 'Start',
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$taskRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskBundledNode = Join-Path $taskRoot '.local\runtime\node.exe'
$taskNodeCommand = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if (Test-Path -LiteralPath $taskBundledNode) {
  $taskNodeExecutable = $taskBundledNode
} elseif ($taskNodeCommand) {
  $taskNodeExecutable = $taskNodeCommand.Source
} else {
  Write-Host 'Node.js 24.x is required. See README.md. Download: https://nodejs.org/'
  exit 1
}

$taskLauncherArguments = @((Join-Path $taskRoot 'scripts\launcher.mjs'))
# Respect the Windows proxy for the first npm dependency preparation.
# Keep it process-local and do not print or persist proxy settings.
if (-not $env:HTTPS_PROXY) {
  $taskRegistryUri = [Uri]'https://registry.npmjs.org/'
  $taskProxyUri = [System.Net.WebRequest]::GetSystemWebProxy().GetProxy($taskRegistryUri)
  if ($taskProxyUri.Host -ne $taskRegistryUri.Host) {
    $env:HTTP_PROXY = $taskProxyUri.AbsoluteUri
    $env:HTTPS_PROXY = $taskProxyUri.AbsoluteUri
  }
}
if ($Action -eq 'Stop') { $taskLauncherArguments += '--stop' }
if ($NoBrowser) { $taskLauncherArguments += '--no-browser' }
& $taskNodeExecutable @taskLauncherArguments
exit $LASTEXITCODE
