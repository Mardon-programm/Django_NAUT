// DjangoNAUT regression suite. Run with: npm test  (or node tests/run-all.js)
const { run } = require('./lib');
const t0 = Date.now();

require('./n1-analyzer.test.js');
require('./migration-drift.test.js');
require('./syntax.test.js');
require('./python-agent.test.js');
require('./package-files.test.js');

const fail = run();
console.log('suite time: ' + (Date.now() - t0) + 'ms');
process.exit(fail ? 1 : 0);
