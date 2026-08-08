// DjangoNAUT VS Code import: pure helpers to map VS Code settings, themes and
// keybindings onto DjangoNAUT's own configuration. No fs / platform access
// here so everything is unit-testable; file discovery lives in main.js.

const VS_THEME_MAP = {
  'dark+': 'vs-dark',
  'dark plus': 'vs-dark',
  'default dark+': 'vs-dark',
  'monokai': 'monokai',
  'monokai dimmed': 'monokai',
  'solarized dark': 'solarized-dark',
  'solarized-dark': 'solarized-dark',
  'dracula': 'dracula',
  'dracula theme': 'dracula',
  'one dark pro': 'one-dark',
  'one dark': 'one-dark',
  'github dark': 'github-dark',
  'github-dark': 'github-dark',
  'light+': 'vs',
  'light plus': 'vs',
  'default light+': 'vs',
  'github light': 'vs',
  'quiet light': 'vs',
};

// VS Code command id -> DjangoNAUT hotkey action id.
const VS_HOTKEY_MAP = {
  'workbench.action.files.openFolder': 'openFolder',
  'workbench.action.files.openFileFolder': 'openFolder',
  'workbench.action.files.save': 'saveFile',
  'workbench.action.files.saveAll': 'saveFile',
  'workbench.view.explorer': 'explorer',
  'workbench.view.search': 'search',
  'workbench.action.findInFiles': 'search',
  'workbench.action.quickOpen': 'quickOpen',
  'workbench.action.gotoLine': 'goToLine',
  'workbench.action.openSettings': 'settings',
  'workbench.action.openSettings2': 'settings',
  'editor.action.commentLine': 'toggleComment',
  'editor.action.comment.line': 'toggleComment',
  'editor.action.duplicateSelection': 'duplicateLine',
  'editor.action.copyLinesDownAction': 'duplicateLine',
  'editor.action.copyLinesUpAction': 'duplicateLine',
  'editor.action.deleteLines': 'deleteLine',
  'editor.action.moveLinesUpAction': 'moveLineUp',
  'editor.action.moveLinesDownAction': 'moveLineDown',
  'workbench.action.terminal.focus': 'focusTerminal',
  'workbench.action.terminal.focus.toggleTerminal': 'focusTerminal',
  'editor.action.toggleTabFocusMode': 'focusTerminal',
  'workbench.action.files.closeFile': 'closeTab',
  'workbench.action.closeActiveEditor': 'closeTab',
  'editor.action.startFindReplaceAction': 'replace',
  'actions.find': 'find',
  'editor.action.addSelectionToNextFindMatch': 'addSelection',
  'editor.action.formatDocument': 'formatDocument',
};

const VS_KEY_NAMES = {
  'space': 'Space',
  'enter': 'Enter',
  'tab': 'Tab',
  'backspace': 'Backspace',
  'escape': 'Escape',
  'esc': 'Escape',
  'up': 'Up',
  'down': 'Down',
  'left': 'Left',
  'right': 'Right',
  'arrowup': 'ArrowUp',
  'arrowdown': 'ArrowDown',
  'arrowleft': 'ArrowLeft',
  'arrowright': 'ArrowRight',
  'home': 'Home',
  'end': 'End',
  'pageup': 'PageUp',
  'pagedown': 'PageDown',
  'delete': 'Delete',
  'del': 'Delete',
  'insert': 'Insert',
  'backquote': '`',
  '`': '`',
  ',': ',',
  '.': '.',
  '/': '/',
  ';': ';',
  "'": "'",
  '[': '[',
  ']': ']',
  '-': '-',
  '=': '=',
};

const VS_MOD_KEYS = { ctrl: 'Ctrl', control: 'Ctrl', cmd: 'Ctrl', meta: 'Ctrl', super: 'Ctrl', shift: 'Shift', alt: 'Alt', option: 'Alt' };

// 'ctrl+shift+e' -> 'Ctrl+Shift+E', 'alt+up' -> 'Alt+Up', null for unknown keys.
function parseVsKeybinding(key) {
  if (!key || typeof key !== 'string') return null;
  const parts = key.split('+').map((p) => p.trim().toLowerCase()).filter(Boolean);
  if (!parts.length) return null;
  const mods = [];
  for (const p of parts.slice(0, -1)) {
    const m = VS_MOD_KEYS[p];
    if (!m) return null;
    if (!mods.includes(m)) mods.push(m);
  }
  let k = parts[parts.length - 1];
  if (VS_KEY_NAMES[k]) k = VS_KEY_NAMES[k];
  else if (/^f\d{1,2}$/.test(k)) k = k.toUpperCase();
  else if (/^[a-z0-9]$/.test(k)) k = k.toUpperCase();
  else return null;
  return mods.concat(k).join('+');
}

function mapVsTheme(themeName) {
  if (!themeName || typeof themeName !== 'string') return null;
  return VS_THEME_MAP[themeName.trim().toLowerCase()] || null;
}

// Flat user/workspace settings (settings.json) -> our editor options subset.
function normalizeVsSettings(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null;
  const editor = settings.editor || {};
  const out = {};
  if (typeof editor.fontSize === 'number' && editor.fontSize > 0) out.fontSize = editor.fontSize;
  if (typeof editor.fontFamily === 'string' && editor.fontFamily.trim()) out.fontFamily = editor.fontFamily.trim();
  if (typeof editor.tabSize === 'number' && editor.tabSize > 0) out.tabSize = editor.tabSize;
  if (typeof editor.wordWrap === 'string' && ['off', 'on', 'wordWrapColumn', 'bounded'].includes(editor.wordWrap)) out.wordWrap = editor.wordWrap === 'off' ? 'off' : 'on';
  if (typeof editor.minimap === 'object' && editor.minimap !== null && typeof editor.minimap.enabled === 'boolean') out.minimap = editor.minimap.enabled;
  if (typeof editor.formatOnSave === 'boolean') out.formatOnSave = editor.formatOnSave;
  if (typeof settings.files === 'object' && settings.files !== null && typeof settings.files.autoSave === 'string') out.autoSave = settings.files.autoSave;
  if (settings.python && typeof settings.python === 'object') {
    if (typeof settings.python.defaultInterpreterPath === 'string' && settings.python.defaultInterpreterPath.trim()) out.pythonPath = settings.python.defaultInterpreterPath.trim();
    if (Array.isArray(settings.python.analysis && settings.python.analysis.extraPaths) && settings.python.analysis.extraPaths.length) out.extraPaths = settings.python.analysis.extraPaths.slice(0, 10);
  }
  return out;
}

// keybindings.json -> { actionId: combo, ... } for mapped commands.
function mapVsKeybindings(keybindings) {
  if (!Array.isArray(keybindings)) return null;
  const out = {};
  for (const kb of keybindings) {
    if (!kb || typeof kb !== 'object' || !kb.key || !kb.command) continue;
    if (kb.command.charAt(0) === '-' || kb.when === 'false') continue;
    const actionId = VS_HOTKEY_MAP[kb.command];
    if (!actionId) continue;
    const combo = parseVsKeybinding(kb.key);
    if (!combo) continue;
    if (!out[actionId]) out[actionId] = combo;
  }
  return Object.keys(out).length ? out : null;
}

// Build a DjangoNAUT config blob from raw VS Code data. Each section may be
// independently absent. Returns { theme, editor, hotkeys }.
function buildImport(userSettings, userKeybindings, projectSettings, projectKeybindings) {
  const mergedSettings = Object.assign({}, userSettings && typeof userSettings === 'object' ? userSettings : {});
  if (projectSettings && typeof projectSettings === 'object') {
    for (const k of Object.keys(projectSettings)) {
      const cur = mergedSettings[k];
      const next = projectSettings[k];
      if (cur && next && typeof cur === 'object' && typeof next === 'object' && !Array.isArray(cur) && !Array.isArray(next)) {
        mergedSettings[k] = Object.assign({}, cur, next);
      } else {
        mergedSettings[k] = next;
      }
    }
  }

  const out = { theme: null, editor: null, hotkeys: null };

  if (userSettings && typeof userSettings === 'object' && typeof userSettings['workbench.colorTheme'] === 'string') {
    out.theme = mapVsTheme(userSettings['workbench.colorTheme']);
  } else if (projectSettings && typeof projectSettings === 'object' && typeof projectSettings['workbench.colorTheme'] === 'string') {
    out.theme = mapVsTheme(projectSettings['workbench.colorTheme']);
  }

  out.editor = normalizeVsSettings(mergedSettings);
  if (out.editor && !Object.keys(out.editor).length) out.editor = null;

  const kb = mapVsKeybindings(projectKeybindings) || mapVsKeybindings(userKeybindings);
  out.hotkeys = kb;

  return out;
}

module.exports = { parseVsKeybinding, mapVsTheme, normalizeVsSettings, mapVsKeybindings, buildImport, VS_HOTKEY_MAP };
