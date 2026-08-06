// Unit tests for the model-drift parser (migration-graph.js parseDrift).
const { test, eq, ok } = require('./lib');
const { parseDrift } = require('../migration-graph.js');

test('no drift: exit 0 with "No changes detected"', () => {
  const r = parseDrift({ stdout: 'No changes detected', stderr: '', code: 0 });
  eq(r.drift, false);
  eq(r.noChanges, true);
  eq(r.changes, []);
});

test('drift: exit 1 parses pending operations', () => {
  const out = [
    "Migrations for 'blog':",
    '  C:\\projects\\blog\\migrations\\0002_post_views_count.py',
    '    + Add field views_count to post',
    '',
  ].join('\n');
  const r = parseDrift({ stdout: out, stderr: '', code: 1 });
  eq(r.drift, true);
  eq(r.noChanges, false);
  eq(r.changes, ['Add field views_count to post']);
});

test('drift: multiple apps and operations', () => {
  const out = [
    "Migrations for 'blog':",
    '    + Add field title to post',
    '    + Add field views_count to post',
    "Migrations for 'shop':",
    '    - Remove field old_sku from product',
    '',
  ].join('\n');
  const r = parseDrift({ stdout: out, stderr: '', code: 1 });
  eq(r.changes.length, 3);
  ok(r.changes.includes('Add field views_count to post'), 'lists each operation');
  ok(r.changes.includes('Remove field old_sku from product'), 'strips +/- markers');
});

test('drift: CRLF and stderr-only output are handled', () => {
  const out = "Migrations for 'blog':\r\n    + Add field slug to post\r\n";
  const r = parseDrift({ stdout: '', stderr: out, code: 1 });
  eq(r.drift, true);
  eq(r.changes, ['Add field slug to post']);
});

test('raw parser flags unknown exit codes as drift (IPC guard blocks non-Django folders upstream)', () => {
  const r = parseDrift({ stdout: '', stderr: "can't open file 'manage.py'", code: 2 });
  eq(r.drift, true);
  eq(r.changes, []);
});
