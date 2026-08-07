// Unit tests for the N+1 query analyzer living inside renderer.js.
const path = require('path');
const { test, eq, ok, loadFunctions, repoRoot } = require('./lib');

const renderer = path.join(repoRoot(), 'renderer.js');
const { nautNormalizeSql: norm, nautReqAnalyze: an, nautN1Relation: rel } = loadFunctions(renderer, ['nautNormalizeSql', 'nautReqAnalyze', 'nautN1Relation']);

test('empty request has no groups', () => {
  eq(an({ queries: [] }), { distinct: 0, groups: [], n1: [], n1Queries: 0 });
});

test('single unique query is not N+1', () => {
  eq(an({ queries: [{ sql: 'SELECT 1' }] }).n1, []);
});

test('12 repeated SELECTs are detected as N+1 with count and stack', () => {
  const qs = [];
  for (let i = 1; i <= 12; i++) {
    qs.push({ sql: "SELECT * FROM blog_post WHERE author_id = " + i + " AND status = 'p'", time: 1.0, stack: { file: 'C:/app/blog/views.py', line: 42 } });
  }
  const a = an({ queries: qs });
  eq(a.n1.length, 1);
  eq(a.n1[0].count, 12);
  eq(a.distinct, 1);
  ok(!/join/i.test(a.n1[0].sql), 'FK pattern should hint select_related');
  eq(a.n1[0].stack.file, 'C:/app/blog/views.py');
});

test('repeated JOIN is detected and flags prefetch hint', () => {
  const qs = [];
  for (let i = 1; i <= 9; i++) {
    qs.push({ sql: 'SELECT t1.id FROM m2m_through t1 INNER JOIN blog_tag t2 ON t1.tag_id = t2.id WHERE t1.post_id = ' + i });
  }
  const a = an({ queries: qs });
  eq(a.n1.length, 1);
  ok(/join/i.test(a.n1[0].sql), 'join pattern should hint prefetch_related');
});

test('normalization collapses literals, numbers and quoting styles', () => {
  const a = an({
    queries: [
      { sql: "SELECT id FROM app_item WHERE sku = 'A1'" },
      { sql: 'SELECT id FROM app_item WHERE sku = "B2"' },
      { sql: 'SELECT id FROM app_item WHERE sku = 1234' },
    ],
  });
  eq(a.distinct, 1);
  eq(a.groups.length, 1);
});

test('backtick-quoted identifiers normalize', () => {
  const a = an({ queries: [{ sql: 'SELECT id FROM `table` WHERE a = 1' }, { sql: 'SELECT id FROM `table` WHERE a = 2' }] });
  eq(a.distinct, 1);
});

test('threshold: 4 repeats not N+1, 5 is', () => {
  const qs = [];
  for (let i = 0; i < 4; i++) qs.push({ sql: 'SELECT id FROM x WHERE y = ' + i });
  eq(an({ queries: qs }).n1.length, 0);
  eq(an({ queries: qs }).groups.length, 1);
  qs.push({ sql: 'SELECT id FROM x WHERE y = 99' });
  eq(an({ queries: qs }).n1.length, 1);
});

test('mixed request groups unique and repeated queries', () => {
  const qs = [{ sql: 'SELECT 1' }, { sql: 'SELECT 2' }];
  for (let i = 0; i < 6; i++) qs.push({ sql: 'SELECT id FROM orders WHERE customer_id = ' + i });
  const a = an({ queries: qs });
  eq(a.distinct, 2);
  eq(a.n1.length, 1);
  eq(a.n1Queries, 6);
});

test('sql-only stackless queries still analyzed', () => {
  const qs = [];
  for (let i = 0; i < 7; i++) qs.push({ sql: 'SELECT * FROM t WHERE id = ' + i });
  const a = an({ queries: qs });
  eq(a.n1.length, 1);
  ok(!a.n1[0].stack, 'no stack recorded');
});

test('null/empty sql entries are ignored', () => {
  const a = an({ queries: [{ sql: null }, { sql: '' }, { sql: '   ' }] });
  eq(a.distinct, 0);
});

test('nautN1Relation extracts FK relation and join flag from SQL', () => {
  eq(rel("SELECT * FROM blog_post WHERE author_id = 1 AND status = 'p'"), { name: 'author', isJoin: false });
  eq(rel("SELECT * FROM orders WHERE customer_id = 7"), { name: 'customer', isJoin: false });
  eq(rel('SELECT * FROM t WHERE id = 5'), null);
  eq(rel('SELECT * FROM t'), null);
});

test('nautN1Relation returns null on ambiguous joins (m2m through-tables)', () => {
  eq(rel('SELECT t1.id FROM m2m_through t1 INNER JOIN blog_tag t2 ON t1.tag_id = t2.id WHERE t1.post_id = 1'), null);
  eq(rel('SELECT * FROM t WHERE customer_id = 1 AND order_id = 2'), null);
});
