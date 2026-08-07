// Wiring check: every panel in index.html must be handled by the renderer,
// every preload IPC channel must have an ipcMain.handle in main.js.
const fs = require('fs');
const path = require('path');
const { test, ok, repoRoot } = require('./lib');

const read = (p) => fs.readFileSync(path.join(repoRoot(), p), 'utf8');

test('activity panels exist and are referenced by the renderer', () => {
  const html = read('index.html');
  const renderer = read('renderer.js');
  const panels = [...html.matchAll(/class="sidebar-panel[^"]*" id="panel-([\w-]+)"/g)].map((m) => m[1]);
  const icons = [...html.matchAll(/class="activity-icon[^"]*" data-panel="([\w-]+)"/g)].map((m) => m[1]);
  ok(panels.length >= 30, 'expected 30+ panels, got ' + panels.length);
  ok(icons.length >= 30, 'expected 30+ activity icons, got ' + icons.length);

  for (const p of panels) {
    ok(icons.includes(p), 'missing activity icon for panel-' + p);
    // The panel must be referenced by id, or one of its inner element ids must
    // appear in the renderer (e.g. panel-django renders into #django-tree).
    const block = html.match(new RegExp('id="panel-' + p + '"[\\s\\S]*?(?=<div class="sidebar-panel" id="panel-|$)'));
    const inner = block ? [...block[0].matchAll(/id="([\w-]+)"/g)].map((m) => m[1]) : [];
    const refs = ['panel-' + p, ...inner];
    ok(refs.some((r) => renderer.includes(r)), 'renderer does not reference panel-' + p + ' (or any of its elements)');
  }
  for (const i of icons) {
    ok(panels.includes(i), 'activity icon "' + i + '" has no panel div');
  }
});

test('every preload IPC channel is handled in main.js', () => {
  const preload = read('preload.js');
  const main = read('main.js');
  const channels = [...preload.matchAll(/ipcRenderer\.(?:invoke|send)\('([^']+)'/g)].map((m) => m[1]);
  const handles = new Set([...main.matchAll(/ipcMain\.(?:handle|on)\('([^']+)'/g)].map((m) => m[1]));
  ok(channels.length >= 60, 'expected 60+ preload channels, got ' + channels.length);
  for (const ch of channels) {
    ok(handles.has(ch), 'no ipcMain.handle for "' + ch + '"');
  }
});

test('main.js registers no duplicate IPC channels', () => {
  const main = read('main.js');
  const handles = [...main.matchAll(/ipcMain\.handle\('([^']+)'/g)].map((m) => m[1]);
  const seen = new Set();
  for (const h of handles) {
    ok(!seen.has(h), 'duplicate ipcMain.handle "' + h + '"');
    seen.add(h);
  }
});
