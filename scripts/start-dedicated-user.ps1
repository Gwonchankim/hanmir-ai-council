[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$User,

    [Parameter()]
    [string]$ProjectPath = (Split-Path -Parent $PSScriptRoot),

    [Parameter()]
    [ValidateRange(1024, 65535)]
    [int]$Port = 3100
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$resolvedProject = [System.IO.Path]::GetFullPath($ProjectPath)
$launcher = Join-Path $resolvedProject 'scripts\start-low-privilege.ps1'
if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) {
    throw "Low-privilege launcher was not found: $launcher"
}

$currentIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
if ($currentIdentity -ieq $User -or $currentIdentity.Split('\')[-1] -ieq $User) {
    throw 'Use start-low-privilege.ps1 directly when the requested identity is the current user.'
}

# This launcher deliberately does not create users, change group membership, or
# grant NTFS permissions. The named non-admin account and its private CLI auth
# profile must already exist. The credential remains a SecureString in memory.
$credential = Get-Credential -UserName $User -Message 'Enter the existing AI Council account password.'
if ($null -eq $credential) {
    throw 'Credential entry was cancelled.'
}

function ConvertTo-SingleQuotedPowerShellLiteral([string]$Value) {
    return "'" + $Value.Replace("'", "''") + "'"
}

$command = @(
    "& $(ConvertTo-SingleQuotedPowerShellLiteral $launcher)",
    '-Profile dedicated-user',
    "-ProjectPath $(ConvertTo-SingleQuotedPowerShellLiteral $resolvedProject)",
    "-Port $Port",
    "-ExpectedUser $(ConvertTo-SingleQuotedPowerShellLiteral $User)"
) -join ' '
$encodedCommand = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
$windowsPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

Start-Process `
    -FilePath $windowsPowerShell `
    -Credential $credential `
    -LoadUserProfile `
    -WindowStyle Hidden `
    -WorkingDirectory $resolvedProject `
    -ArgumentList @('-NoLogo', '-NoProfile', '-EncodedCommand', $encodedCommand)
