[CmdletBinding()]
param(
    [Parameter()]
    [ValidateSet('standard-user', 'dedicated-user')]
    [string]$Profile = 'standard-user',

    [Parameter()]
    [string]$ProjectPath = (Split-Path -Parent $PSScriptRoot),

    [Parameter()]
    [ValidateRange(1024, 65535)]
    [int]$Port = 3100,

    [Parameter()]
    [string]$ExpectedUser = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$resolvedProject = [System.IO.Path]::GetFullPath($ProjectPath)
$preflight = Join-Path $resolvedProject 'scripts\isolation-preflight.js'
$server = Join-Path $resolvedProject 'server.js'

if (-not (Test-Path -LiteralPath $preflight -PathType Leaf)) {
    throw "Isolation preflight was not found: $preflight"
}
if (-not (Test-Path -LiteralPath $server -PathType Leaf)) {
    throw "AI Council server was not found: $server"
}
if ($Profile -eq 'dedicated-user' -and [string]::IsNullOrWhiteSpace($ExpectedUser)) {
    throw 'The dedicated-user profile requires -ExpectedUser.'
}

# Do not inherit a Node preload/debug hook into the local web server.
Remove-Item Env:NODE_OPTIONS -ErrorAction SilentlyContinue
Remove-Item Env:NODE_INSPECT_RESUME_ON_START -ErrorAction SilentlyContinue
$env:AI_COUNCIL_HOST = '127.0.0.1'
$env:AI_COUNCIL_PORT = [string]$Port
$env:AI_COUNCIL_ACCESS_MODE = 'local'
Remove-Item Env:AI_COUNCIL_TAILNET_HOSTNAME -ErrorAction SilentlyContinue
Remove-Item Env:AI_COUNCIL_TAILNET_ALLOWED_USERS -ErrorAction SilentlyContinue
$env:AI_COUNCIL_ISOLATION_PROFILE = $Profile
$env:AI_COUNCIL_EXPECTED_USER = $ExpectedUser

$preflightArgs = @(
    $preflight,
    '--profile', $Profile,
    '--project', $resolvedProject,
    '--host', '127.0.0.1'
)
if ($ExpectedUser) {
    $preflightArgs += @('--expected-user', $ExpectedUser)
}

& node @preflightArgs
if ($LASTEXITCODE -ne 0) {
    throw "AI Council isolation preflight failed with exit code $LASTEXITCODE."
}

Set-Location -LiteralPath $resolvedProject
Write-Host "Starting AI Council at http://127.0.0.1:$Port with profile '$Profile'."
& node $server
exit $LASTEXITCODE
