param(
    [ValidateSet('Setup', 'Cleanup')][string]$Mode = 'Setup',
    [string]$SourceDirectory
)
$ErrorActionPreference = 'Stop'
$container = 'cftrain-t10-hydro'
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
function Docker {
    param([string[]]$Arguments)
    $output = & wsl.exe -d Ubuntu -u root -e docker @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Docker $($Arguments[0]) failed" }
    return $output
}
if ($Mode -eq 'Cleanup') {
    $label = Docker @('inspect', '--format', '{{index .Config.Labels "cftrain.task"}}', $container)
    if ($label.Trim() -ne 't10') { throw 'Refusing cleanup: missing T10 ownership label' }
    Docker @('exec', $container, 'pm2', 'stop', 'hydrooj') | Out-Null
    $code = @'
(async()=>{
const fs=require('fs'), c=JSON.parse(fs.readFileSync('/root/.hydro/config.json'));
if(c.name!=='cftrain_test_t10_hydro_isolated'||c.url||c.uri)throw new Error('Not isolated');
const client=await require('mongodb').MongoClient.connect('mongodb://oj-mongo:27017');
await client.db(c.name).dropDatabase(); await client.close();
})().catch(e=>{console.error(e);process.exitCode=1});
'@
    Docker @('exec', '-e', 'NODE_PATH=/usr/local/share/.config/yarn/global/node_modules', $container, 'node', '-e', $code) | Out-Null
    Docker @('rm', '-f', '-v', $container) | Out-Null
    $credentials = Join-Path $root '.test-output/release-session.json'
    if (Test-Path -LiteralPath $credentials) { Remove-Item -LiteralPath $credentials }
    Write-Output 'Removed dedicated T10 container, database and local credentials.'
    return
}
# Docker refuses an existing name. Never reuse or modify the normal oj-backend container.
Docker @('run', '-d', '--name', $container, '--label', 'cftrain.task=t10', '--network', 'docker_default',
    '-p', '127.0.0.1:18888:8888', '--entrypoint', 'sleep', 'docker-oj-backend', 'infinity') | Out-Null
$config = @'
const fs=require('fs'); fs.mkdirSync('/root/.hydro',{recursive:true});
fs.writeFileSync('/root/.hydro/config.json',JSON.stringify({host:'oj-mongo',port:'27017',name:'cftrain_test_t10_hydro_isolated',username:'',password:''}));
fs.writeFileSync('/root/.hydro/addon.json',JSON.stringify(['@hydrooj/ui-default']));
fs.writeFileSync('/root/.hydro/first','T10 isolated fixture');
'@
Docker @('exec', $container, 'node', '-e', $config) | Out-Null
Docker @('exec', $container, 'hydrooj', 'cli', 'system', 'set', 'server.host', '0.0.0.0') | Out-Null
Docker @('exec', $container, 'pm2', 'start', 'hydrooj') | Out-Null
& (Join-Path $root 'scripts/deploy.ps1') -Container $container -SourceDirectory $SourceDirectory
$output = Docker @('exec', '-e', 'CFTRAIN_ISOLATED_RELEASE=1', $container, 'hydrooj', 'cli', 'execute',
    "await require('/root/.hydro/addons/cf-training/test/e2e/release-fixture.cjs').command('bootstrap'); return 'T10_FIXTURE_OK';")
if (($output -join "`n") -notmatch 'T10_FIXTURE_OK') { throw 'Fixture bootstrap failed' }
$fixture = @'
const fs=require('fs');fs.mkdirSync('/tmp/cftrain-t10-fixture',{recursive:true});
fs.writeFileSync('/tmp/cftrain-t10-fixture/package.json',JSON.stringify({name:'cftrain-release-fixture',version:'0.0.0',main:'index.js'}));
fs.writeFileSync('/tmp/cftrain-t10-fixture/index.js',"exports.apply=require('/root/.hydro/addons/cf-training/test/e2e/release-fixture.cjs').apply;");
const p='/root/.hydro/addon.json', a=JSON.parse(fs.readFileSync(p));a.push('/tmp/cftrain-t10-fixture');fs.writeFileSync(p,JSON.stringify(a));
'@
Docker @('exec', $container, 'node', '-e', $fixture) | Out-Null
Docker @('exec', '-e', 'CFTRAIN_ISOLATED_RELEASE=1', $container, 'pm2', 'restart', 'hydrooj', '--update-env') | Out-Null
$outputDir = Join-Path $root '.test-output'
New-Item -ItemType Directory -Force $outputDir | Out-Null
$windowsPath = Join-Path $outputDir 'release-session.json'
$wslPath = '/mnt/' + $windowsPath.Substring(0, 1).ToLowerInvariant() + $windowsPath.Substring(2).Replace('\', '/')
Docker @('cp', "${container}:/tmp/cf-training-release.json", $wslPath) | Out-Null
Write-Output 'Isolated candidate ready on http://127.0.0.1:18888; credentials saved without printing.'
