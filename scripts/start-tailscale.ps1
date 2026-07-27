[CmdletBinding()]
param(
    [Parameter()]
    [ValidateSet('standard-user', 'dedicated-user')]
    [string]$Profile = 'standard-user',

    [Parameter()]
    [string]$ProjectPath = '',

    [Parameter()]
    [ValidateRange(1024, 65535)]
    [int]$Port = 3100,

    [Parameter()]
    [string]$ExpectedUser = '',

    [Parameter()]
    [string[]]$AllowedUser = @()
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# PowerShell can evaluate param-block defaults before $PSScriptRoot is
# populated. Resolve the script directory here so the default launcher path is
# reliable across Windows PowerShell and PowerShell 7.
$scriptPath = [string]$PSCommandPath
if ([string]::IsNullOrWhiteSpace($scriptPath)) {
    $scriptPath = [string]$MyInvocation.MyCommand.Path
}
if ([string]::IsNullOrWhiteSpace($scriptPath)) {
    throw 'Unable to determine the Tailscale launcher script path.'
}
if ([string]::IsNullOrWhiteSpace($ProjectPath)) {
    $ProjectPath = Split-Path -Parent (Split-Path -Parent $scriptPath)
}

function Get-JsonProperty {
    param([object]$Object, [string]$Name)
    if ($null -eq $Object) { return $null }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    return $property.Value
}

function Test-HasJsonEntries {
    param([object]$Value)
    if ($null -eq $Value) { return $false }
    return @($Value.PSObject.Properties).Count -gt 0
}

function Invoke-TailscaleJson {
    param([string[]]$Arguments)
    $output = & $script:TailscalePath @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "tailscale $($Arguments -join ' ') failed with exit code $LASTEXITCODE."
    }
    $text = ($output | ForEach-Object { [string]$_ }) -join [Environment]::NewLine
    if ([string]::IsNullOrWhiteSpace($text)) {
        throw "tailscale $($Arguments -join ' ') returned no JSON."
    }
    try { return $text | ConvertFrom-Json }
    catch { throw "tailscale $($Arguments -join ' ') returned invalid JSON." }
}

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

$tailscaleCommand = Get-Command tailscale.exe -ErrorAction SilentlyContinue
if ($null -eq $tailscaleCommand) {
    $tailscaleCommand = Get-Command tailscale -ErrorAction SilentlyContinue
}
$tailscalePath = if ($null -ne $tailscaleCommand) { $tailscaleCommand.Source } else { $null }
if ([string]::IsNullOrWhiteSpace($tailscalePath)) {
    $knownPaths = @(
        (Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe'),
        $(if (${env:ProgramFiles(x86)}) { Join-Path ${env:ProgramFiles(x86)} 'Tailscale\tailscale.exe' })
    ) | Where-Object { $_ }
    $tailscalePath = $knownPaths | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
}
if ([string]::IsNullOrWhiteSpace($tailscalePath)) {
    throw 'Tailscale CLI is not installed or is not on PATH. Nothing was exposed.'
}
$script:TailscalePath = $tailscalePath

$status = Invoke-TailscaleJson -Arguments @('status', '--json')
$backendState = [string](Get-JsonProperty $status 'BackendState')
if ($backendState -ne 'Running') {
    throw "Tailscale is not logged in and running (BackendState: $backendState). Nothing was exposed."
}
$self = Get-JsonProperty $status 'Self'
if ($null -eq $self) { throw 'Tailscale status does not contain Self. Nothing was exposed.' }
if ((Get-JsonProperty $self 'Online') -eq $false) {
    throw 'The local Tailscale node is offline. Nothing was exposed.'
}
$hostname = ([string](Get-JsonProperty $self 'DNSName')).Trim().TrimEnd('.').ToLowerInvariant()
if ($hostname -notmatch '^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.){2,}ts\.net$') {
    throw 'Self.DNSName is not a valid Tailnet *.ts.net hostname. Nothing was exposed.'
}
$userMap = Get-JsonProperty $status 'User'
if ($null -eq $userMap) { $userMap = Get-JsonProperty $status 'Users' }
$selfUserId = [string](Get-JsonProperty $self 'UserID')
$selfUserRecord = Get-JsonProperty $userMap $selfUserId
$selfLogin = ([string](Get-JsonProperty $selfUserRecord 'LoginName')).Trim().ToLowerInvariant()
if ([string]::IsNullOrWhiteSpace($selfLogin)) {
    throw 'Self.UserID did not resolve to User.LoginName. Nothing was exposed.'
}

$allowed = @()
if ($AllowedUser.Count -gt 0) {
    $allowed = @($AllowedUser | ForEach-Object { ([string]$_).Trim().ToLowerInvariant() } | Where-Object { $_ })
} else {
    $allowed = @($selfLogin)
}
$allowed = @($allowed | Select-Object -Unique)
foreach ($login in $allowed) {
    if ($login.Length -gt 254 -or $login -match '[\x00-\x20\x7f,]') {
        throw "Unsafe Tailscale allowed user login: $login"
    }
}
if ($allowed.Count -eq 0) { throw 'At least one allowed Tailscale user is required.' }

# Refuse to overwrite unrelated Serve/Funnel mappings. This launcher only owns
# the empty root HTTPS mapping that it creates during this process.
$existingServe = Invoke-TailscaleJson -Arguments @('serve', 'status', '--json')
$existingSections = @('TCP', 'Web', 'AllowFunnel', 'Foreground', 'Services')
foreach ($section in $existingSections) {
    if (Test-HasJsonEntries (Get-JsonProperty $existingServe $section)) {
        throw 'An existing Tailscale Serve/Funnel configuration is present. Disable it explicitly before using this launcher.'
    }
}

# Do not inherit Node preload/debug hooks into a server reachable from the tailnet.
Remove-Item Env:NODE_OPTIONS -ErrorAction SilentlyContinue
Remove-Item Env:NODE_INSPECT_RESUME_ON_START -ErrorAction SilentlyContinue
$env:AI_COUNCIL_HOST = '127.0.0.1'
$env:AI_COUNCIL_PORT = [string]$Port
$env:AI_COUNCIL_ISOLATION_PROFILE = $Profile
$env:AI_COUNCIL_EXPECTED_USER = $ExpectedUser
$env:AI_COUNCIL_ACCESS_MODE = 'tailscale'
$env:AI_COUNCIL_TAILNET_HOSTNAME = $hostname
$env:AI_COUNCIL_TAILNET_ALLOWED_USERS = $allowed -join ','

$preflightArgs = @(
    $preflight,
    '--profile', $Profile,
    '--project', $resolvedProject,
    '--host', '127.0.0.1'
)
if ($ExpectedUser) { $preflightArgs += @('--expected-user', $ExpectedUser) }
& node @preflightArgs
if ($LASTEXITCODE -ne 0) {
    throw "AI Council isolation preflight failed with exit code $LASTEXITCODE. Nothing was exposed."
}

$target = "http://127.0.0.1:$Port"
$serveConfigured = $false
$nodeExitCode = 1
try {
    & $script:TailscalePath serve --bg --yes $target
    if ($LASTEXITCODE -ne 0) {
        throw "tailscale serve failed with exit code $LASTEXITCODE."
    }
    $serveConfigured = $true

    $configured = Invoke-TailscaleJson -Arguments @('serve', 'status', '--json')
    $tcp = Get-JsonProperty $configured 'TCP'
    $https443 = Get-JsonProperty $tcp '443'
    $web = Get-JsonProperty $configured 'Web'
    $hostConfig = Get-JsonProperty $web "$hostname`:443"
    $handlers = Get-JsonProperty $hostConfig 'Handlers'
    $rootHandler = Get-JsonProperty $handlers '/'
    $proxyTarget = [string](Get-JsonProperty $rootHandler 'Proxy')
    if ((Get-JsonProperty $https443 'HTTPS') -ne $true -or $proxyTarget -ne $target) {
        throw 'Tailscale Serve status did not confirm the exact HTTPS root proxy mapping.'
    }

    Set-Location -LiteralPath $resolvedProject
    Write-Host "AI Council is private at https://$hostname for: $($allowed -join ', ')"
    Write-Host "The application itself remains bound to http://127.0.0.1:$Port"
    & node $server
    $nodeExitCode = $LASTEXITCODE
}
finally {
    if ($serveConfigured) {
        & $script:TailscalePath serve --https=443 off 2>$null
        if ($LASTEXITCODE -ne 0) {
            Write-Warning 'Failed to disable the temporary Tailscale Serve mapping; run: tailscale serve --https=443 off'
        }
    }
}
exit $nodeExitCode
