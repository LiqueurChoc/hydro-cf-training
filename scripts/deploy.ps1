param(
    [string]$Distribution = 'Ubuntu',
    [Parameter(Mandatory = $true)][string]$Container,
    [string]$HealthUrl = 'http://127.0.0.1:8888',
    [ValidateRange(1, 300)][int]$TimeoutSeconds = 60,
    [string]$SourceDirectory,
    [string]$Restore,
    [switch]$LegacyMaintenance
)
$ErrorActionPreference = 'Stop'
if ($Container -notmatch '^[a-zA-Z0-9][a-zA-Z0-9_.-]*$') { throw 'Invalid Docker container name' }
if ($Restore -and $Restore -notmatch '^[a-zA-Z0-9-]+$') { throw 'Invalid backup ID' }
$pluginRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if ($SourceDirectory) { $pluginRoot = (Resolve-Path -LiteralPath $SourceDirectory).Path }
$id = [guid]::NewGuid().ToString('N')
$archivePath = Join-Path ([IO.Path]::GetTempPath()) "cf-training-$id.tar"
$remote = "/tmp/cf-training-deploy-$id"
function Invoke-Docker {
    param([string[]]$DockerArguments)
    $output = & wsl.exe -d $Distribution -u root -e docker @DockerArguments
    if ($LASTEXITCODE -ne 0) { throw "Docker command failed: $($DockerArguments[0]) (exit $LASTEXITCODE)" }
    return $output
}
Write-Host "Target: WSL=$Distribution container=$Container addon=/root/.hydro/addons/cf-training health=$HealthUrl"
$remoteCreated = $false
try {
    $running = Invoke-Docker @('inspect', '--format', '{{.State.Running}}', $Container)
    if ($running.Trim() -ne 'true') { throw 'Target container is not running' }
    # Explicit allowlist excludes local credentials, hidden tool state and generated artifacts.
    $packageFiles = @(& node (Join-Path $PSScriptRoot 'package.cjs') --list $pluginRoot)
    if ($LASTEXITCODE -ne 0) { throw 'Package inventory failed' }
    & tar.exe -cf $archivePath -C $pluginRoot @packageFiles
    if ($LASTEXITCODE -ne 0) { throw 'Packaging failed' }
    $resolved = (Resolve-Path -LiteralPath $archivePath).Path
    if ($resolved -notmatch '^([A-Za-z]):\\') { throw 'Archive must be on a Windows drive mounted in WSL' }
    $wslArchive = '/mnt/' + $resolved.Substring(0, 1).ToLowerInvariant() + $resolved.Substring(2).Replace('\', '/')
    Invoke-Docker @('exec', $Container, 'mkdir', $remote)
    $remoteCreated = $true
    Invoke-Docker @('cp', $wslArchive, "${Container}:$remote/package.tar")
    Invoke-Docker @('exec', $Container, 'mkdir', "$remote/candidate")
    Invoke-Docker @('exec', $Container, 'tar', '-xf', "$remote/package.tar", '-C', "$remote/candidate")
    $restoreId = if ($Restore) { $Restore } else { '-' }
    $mode = if ($LegacyMaintenance) { 'maintenance' } else { '-' }
    Invoke-Docker @('exec', '-e', 'NODE_PATH=/usr/local/share/.config/yarn/global/node_modules', $Container,
        'node', "$remote/candidate/scripts/deployment.cjs", '/root/.hydro', "$remote/candidate", $restoreId,
        $HealthUrl, [string]($TimeoutSeconds * 1000), $mode)
} finally {
    if ($remoteCreated) {
        # Only the literal per-run UUID directory is removed; recovery backups remain persistent.
        & wsl.exe -d $Distribution -u root -e docker exec $Container rm -rf -- $remote
        if ($LASTEXITCODE -ne 0) { Write-Warning "Temporary package cleanup failed: $remote" }
    }
    if (Test-Path -LiteralPath $archivePath) { Remove-Item -LiteralPath $archivePath }
}
