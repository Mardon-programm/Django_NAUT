// DjangoNAUT Database Inspector: introspect tables/columns and run read-only
// SQL queries against any configured database through the project shell
// (JSON-RPC via shell-rpc -> `python -m django_naut`).

function databasesCode() {
  return `
from django.conf import settings
[{'alias': a, 'engine': d.get('ENGINE', '').rsplit('.', 1)[-1], 'name': str(d.get('NAME', ''))} for a, d in settings.DATABASES.items()]
`;
}

function tablesCode(alias) {
  const a = JSON.stringify(alias);
  return `
from django.db import connections
alias = ${a}
conn = connections[alias]
cur = conn.cursor()
intro = conn.introspection
names = sorted(intro.table_names(cursor=cur))
out = []
for t in names:
    q = 'SELECT COUNT(*) FROM ' + conn.ops.quote_name(t)
    try:
        cur.execute(q)
        n = cur.fetchone()[0]
    except Exception:
        n = None
    out.append({'name': t, 'rows': n})
out
`;
}

function describeCode(alias, table) {
  const a = JSON.stringify(alias);
  const t = JSON.stringify(table);
  return `
from django.db import connections
alias = ${a}
conn = connections[alias]
cur = conn.cursor()
intro = conn.introspection
pk_cols = set()
try:
    pk_cols = set(intro.get_primary_key_columns(cur, ${t}))
except Exception:
    pk_cols = set()
cols = []
for c in intro.get_table_description(cur, ${t}):
    try:
        tn = conn.data_types_reverse.get(c.type_code, str(c.type_code))
    except Exception:
        tn = str(c.type_code)
    cols.append({'name': c.name, 'type': tn, 'null': bool(c.null_ok), 'default': c.default, 'pk': c.name in pk_cols})
cols
`;
}

function previewCode(alias, table, limit) {
  const a = JSON.stringify(alias);
  const t = JSON.stringify(table);
  const n = Math.max(1, Math.min(200, limit || 50));
  return `
from django.db import connections
alias = ${a}
conn = connections[alias]
cur = conn.cursor()
def _dbv(x):
    if x is None:
        return None
    try:
        s = str(x)
    except Exception:
        s = repr(x)
    if len(s) > 300:
        s = s[:297] + '...'
    return s
cur.execute('SELECT * FROM ' + conn.ops.quote_name(${t}) + ' LIMIT ' + str(${n}))
names = [d[0] for d in cur.description]
rows = [[_dbv(x) for x in r] for r in cur.fetchall()]
{'columns': names, 'rows': rows}
`;
}

const READ_ONLY_RE = /^\s*(select|explain|with|show|pragma|describe|desc|values)\b/i;

function isReadOnly(sql) {
  return READ_ONLY_RE.test(sql);
}

function queryCode(alias, sql, params, limit) {
  const a = JSON.stringify(alias);
  const s = JSON.stringify(sql);
  const p = JSON.stringify(params || []);
  const n = Math.max(1, Math.min(1000, limit || 100));
  return `
from django.db import connections
alias = ${a}
conn = connections[alias]
cur = conn.cursor()
def _dbv(x):
    if x is None:
        return None
    try:
        s = str(x)
    except Exception:
        s = repr(x)
    if len(s) > 300:
        s = s[:297] + '...'
    return s
sql = ${s}
params = ${p}
try:
    cur.execute(sql, params)
    if cur.description is None:
        __r = {'columns': [], 'rows': [], 'rowcount': cur.rowcount}
    else:
        names = [d[0] for d in cur.description]
        rows = []
        for i, r in enumerate(cur.fetchall()):
            if i >= ${n}:
                break
            rows.append([_dbv(x) for x in r])
        __r = {'columns': names, 'rows': rows, 'rowcount': cur.rowcount}
except Exception as e:
    __r = {'error': str(e)}
__r
`;
}

module.exports = { databasesCode, tablesCode, describeCode, previewCode, queryCode, isReadOnly };
