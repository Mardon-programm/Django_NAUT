// VS Code import: keybinding/theme/settings mapping is pure and testable.
const { test, eq, repoRoot } = require('./lib');
const path = require('path');

const vs = require(path.join(repoRoot(), 'vscode-import.js'));
const isNull = (v) => eq(v, null);

test('parseVsKeybinding maps VS Code chords to DjangoNAUT format', () => {
  eq(vs.parseVsKeybinding('ctrl+shift+e'), 'Ctrl+Shift+E');
  eq(vs.parseVsKeybinding('ctrl+s'), 'Ctrl+S');
  eq(vs.parseVsKeybinding('alt+up'), 'Alt+Up');
  eq(vs.parseVsKeybinding('ctrl+`'), 'Ctrl+`');
  eq(vs.parseVsKeybinding('ctrl+,'), 'Ctrl+,');
  eq(vs.parseVsKeybinding('ctrl+/'), 'Ctrl+/');
  eq(vs.parseVsKeybinding('shift+f12'), 'Shift+F12');
  eq(vs.parseVsKeybinding('ctrl+space'), 'Ctrl+Space');
  eq(vs.parseVsKeybinding('cmd+o'), 'Ctrl+O');
});

test('parseVsKeybinding rejects unknown keys and empty input', () => {
  isNull(vs.parseVsKeybinding(''));
  isNull(vs.parseVsKeybinding(null));
  isNull(vs.parseVsKeybinding('ctrl+doesnotexist'));
  isNull(vs.parseVsKeybinding('weird+key'));
});

test('mapVsTheme maps VS Code theme names to presets', () => {
  eq(vs.mapVsTheme('Default Dark+'), 'vs-dark');
  eq(vs.mapVsTheme('Monokai'), 'monokai');
  eq(vs.mapVsTheme('Dracula'), 'dracula');
  eq(vs.mapVsTheme('One Dark Pro'), 'one-dark');
  eq(vs.mapVsTheme('GitHub Dark'), 'github-dark');
  eq(vs.mapVsTheme('Light+'), 'vs');
  isNull(vs.mapVsTheme('Some Custom Theme'));
  isNull(vs.mapVsTheme(undefined));
});

test('normalizeVsSettings extracts our editor options subset', () => {
  const s = vs.normalizeVsSettings({
    'workbench.colorTheme': 'Dracula',
    editor: { fontSize: 16, fontFamily: 'JetBrains Mono', tabSize: 2, wordWrap: 'on', minimap: { enabled: false }, formatOnSave: true },
    files: { autoSave: 'afterDelay' },
    python: { defaultInterpreterPath: '/venv/bin/python', analysis: { extraPaths: ['lib/a', 'lib/b'] } },
  });
  eq(s.fontSize, 16);
  eq(s.fontFamily, 'JetBrains Mono');
  eq(s.tabSize, 2);
  eq(s.wordWrap, 'on');
  eq(s.minimap, false);
  eq(s.formatOnSave, true);
  eq(s.autoSave, 'afterDelay');
  eq(s.pythonPath, '/venv/bin/python');
  eq(s.extraPaths.length, 2);
});

test('normalizeVsSettings ignores invalid values', () => {
  const s = vs.normalizeVsSettings({ editor: { fontSize: 'big', wordWrap: 'banana' } });
  eq('fontSize' in s, false);
  eq('wordWrap' in s, false);
});

test('mapVsKeybindings maps commands and honors overrides order', () => {
  const kb = vs.mapVsKeybindings([
    { key: 'ctrl+shift+e', command: 'workbench.view.explorer' },
    { key: 'ctrl+k ctrl+s', command: 'workbench.action.openSettings' },
    { key: 'ctrl+alt+o', command: 'workbench.action.files.openFolder' },
    { key: 'ctrl+d', command: '-editor.action.copyLinesDownAction' },
    { key: 'ctrl+unknown', command: 'some.unknown.command' },
    { key: 'f12', command: 'editor.action.formatDocument' },
  ]);
  eq(kb['explorer'], 'Ctrl+Shift+E');
  eq(kb['openFolder'], 'Ctrl+Alt+O');
  eq(kb['formatDocument'], 'F12');
  eq('settings' in kb, false);
  eq('duplicateLine' in kb, false);
});

test('buildImport combines user + project settings and picks project keybindings', () => {
  const cfg = vs.buildImport(
    { 'workbench.colorTheme': 'Monokai', editor: { fontSize: 14 } },
    [{ key: 'ctrl+shift+e', command: 'workbench.view.explorer' }],
    { editor: { tabSize: 2 } },
    [{ key: 'ctrl+alt+s', command: 'workbench.action.files.save' }]
  );
  eq(cfg.theme, 'monokai');
  eq(cfg.editor.fontSize, 14);
  eq(cfg.editor.tabSize, 2);
  eq(cfg.hotkeys['saveFile'], 'Ctrl+Alt+S');
});

test('buildImport handles absent sections', () => {
  const cfg = vs.buildImport(null, null, null, null);
  isNull(cfg.theme);
  isNull(cfg.editor);
  isNull(cfg.hotkeys);
});
