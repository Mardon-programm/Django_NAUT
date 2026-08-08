// Python formatting helpers: extension gating, formatter args, command build.
const { test, eq, ok, repoRoot } = require('./lib');
const path = require('path');

const pf = require(path.join(repoRoot(), 'python-format.js'));
const isNull = (v) => eq(v, null);

test('isPythonFile gates on extension', () => {
  eq(pf.isPythonFile('models.py'), true);
  eq(pf.isPythonFile('views.pyi'), true);
  eq(pf.isPythonFile('app.pyw'), true);
  eq(pf.isPythonFile('app.js'), false);
  eq(pf.isPythonFile('noext'), false);
  eq(pf.isPythonFile(null), false);
});

test('formatterArgs returns per-tool flags', () => {
  eq(pf.formatterArgs('black'), ['-q']);
  eq(pf.formatterArgs('autopep8'), ['--in-place', '--aggressive']);
  eq(pf.formatterArgs('yapf'), ['-i']);
  isNull(pf.formatterArgs('prettier'));
});

test('buildCommand produces python -m invocation with the file path', () => {
  const b = pf.buildCommand('python', 'black', 'C:/proj/app/models.py');
  eq(b.root, 'C:/proj/app');
  eq(b.cmd, ['python', '-m', 'black', '-q', 'C:/proj/app/models.py']);
  const b2 = pf.buildCommand('C:/venv/Scripts/python.exe', 'yapf', '/tmp/x.py');
  eq(b2.cmd, ['C:/venv/Scripts/python.exe', '-m', 'yapf', '-i', '/tmp/x.py']);
  isNull(pf.buildCommand('python', 'nope', '/tmp/x.py'));
  isNull(pf.buildCommand('python', 'black', null));
});

test('FORMATTERS order is black > autopep8 > yapf', () => {
  ok(pf.FORMATTERS[0].name === 'black');
  ok(pf.FORMATTERS[1].name === 'autopep8');
  ok(pf.FORMATTERS[2].name === 'yapf');
});
