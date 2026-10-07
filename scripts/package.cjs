'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function files(base = root) {
  const result = ['package.json', 'index.js', 'README.md', 'docs/project-guide.md', 'docs/deployment-recovery.md'];
  for (const optional of ['CHANGELOG.md', 'docs/release-trial.md', 'docs/user-guide.md']) if (fs.existsSync(path.join(base, optional))) result.push(optional);
  function walk(dir) {
    for (const entry of fs.readdirSync(path.join(base, dir), { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const name = dir + '/' + entry.name;
      if (entry.isDirectory()) walk(name);
      else if (entry.isFile() && (/\.(js|cjs|html|yaml|ps1|md)$/.test(entry.name) || entry.name === 'recovery-contract.json')) result.push(name);
    }
  }
  for (const dir of ['lib', 'templates', 'locales', 'scripts', 'test']) walk(dir);
  return result.sort();
}
function inventory(base = root) {
  return files(base).map(file => ({ file, bytes: fs.statSync(path.join(base, file)).size, sha256: hash(fs.readFileSync(path.join(base, file))) }));
}
function pack(destination) {
  fs.mkdirSync(destination, { recursive: true });
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version;
  const archive = path.join(destination, `hydro-cf-training-${version}.tar`);
  if (fs.existsSync(archive)) throw new Error('Refusing to overwrite existing candidate: ' + archive);
  const entries = inventory();
  execFileSync(process.platform === 'win32' ? 'tar.exe' : 'tar', ['-cf', archive, '-C', root, ...entries.map(e => e.file)]);
  const manifest = { version, source: 'release source; per-file hashes are authoritative',
    archive: path.basename(archive), sha256: hash(fs.readFileSync(archive)), files: entries };
  fs.writeFileSync(archive + '.manifest.json', JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(archive + '.sha256', manifest.sha256 + '  ' + path.basename(archive) + '\n');
  return manifest;
}
if (require.main === module) {
  if (process.argv[2] === '--list') console.log(files(process.argv[3] || root).join('\n'));
  else console.log(JSON.stringify(pack(path.resolve(process.argv[2] || 'dist')), null, 2));
}
module.exports = { files, inventory, pack };
