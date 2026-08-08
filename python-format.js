// DjangoNAUT Python formatting: deterministic local formatting via black /
// autopep8 / yapf run in-place on a temp copy of the file. Pure helpers here
// are unit-testable; the actual spawn lives in the main.js IPC handler.

const FORMATTERS = [
  { name: 'black', args: ['-q'], module: 'black' },
  { name: 'autopep8', args: ['--in-place', '--aggressive'], module: 'autopep8' },
  { name: 'yapf', args: ['-i'], module: 'yapf' },
];

const PY_EXTENSIONS = new Set(['.py', '.pyw', '.pyi']);

function isPythonFile(fileName) {
  if (!fileName || typeof fileName !== 'string') return false;
  const ext = '.' + fileName.toLowerCase().split('.').pop();
  return PY_EXTENSIONS.has(ext);
}

function formatterArgs(name) {
  const f = FORMATTERS.find((x) => x.name === name);
  return f ? f.args.slice() : null;
}

// Build { root, cmd } for shellRPC.runCommand(root, cmd): `python -m <name> <args> <file>`.
function buildCommand(py, formatterName, filePath) {
  const args = formatterArgs(formatterName);
  if (!args || !filePath) return null;
  const root = filePath.split(/[/\\]/).slice(0, -1).join('/') || '.';
  return { root, cmd: [py, '-m', formatterName].concat(args, [filePath]) };
}

module.exports = { FORMATTERS, isPythonFile, formatterArgs, buildCommand };
