'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { files } = require('../scripts/package.cjs');
test('candidate includes runtime/recovery/tests and excludes credentials and generated artifacts', () => {
  const included = files();
  for (const file of ['lib/rating-worker.js', 'lib/exposure.js', 'lib/student-response.js', 'lib/groups.js',
    'scripts/recovery-contract.json', 'scripts/database-backup.cjs', 'test/e2e/release.cjs', 'test/draft-lifecycle.test.js']) assert.ok(included.includes(file), file);
  assert.equal(included.some(file => /(^|\/)(\.test-output|\.workbuddy|node_modules|dist[^\/]*|\.deployment.json)(\/|$)/.test(file)), false);
  assert.equal(included.some(file => /session.*\.json$/.test(file)), false);
  assert.equal(new Set(included).size, included.length);
});

