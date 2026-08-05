(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────────

  let currentFolder = null;
  let commandHistory = [];
  let historyIndex = -1;
  let editorMode = 'textarea';
  let scanData = null;
  let groqApiKey = localStorage.getItem('groq_api_key') || '';
  let lastBugIssues = [];
  let currentAiTab = 'analyze';
  let aiBusy = false;
  let shellType = localStorage.getItem('terminal_shell') || 'cmd';
  let os_user = 'user';
  let fileTreeGeneration = 0;
  let watcherRefreshTimer = null;

  const openTabs = [];
  let activeTabId = null;

  // ── DOM references ─────────────────────────────────────────────────────

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const fileTree = $('#file-tree');
  const folderName = $('#folder-name');
  const editorArea = $('#editor-area');
  const welcomeMsg = $('#welcome-msg');
  const tabBar = $('#tab-bar');
  const djangoTree = $('#django-tree');
  const bugList = $('#bug-list');
  const bugSummary = $('#bug-summary');
  const aiChat = $('#ai-chat');
  const aiInput = $('#ai-input');
  const aiSendBtn = $('#ai-send-btn');
  const aiWelcomeTitle = $('#ai-welcome-title');
  const aiWelcomeDesc = $('#ai-welcome-desc');
  const modalContainer = $('#modal-container');
  const contextMenu = $('#context-menu');
  const outputLog = $('#output-log');
  const problemsList = $('#problems-list');
  const statusBranch = $('#status-branch');

  // ── Toast Notifications ───────────────────────────────────────────────

  function showToast(message, type) {
    const container = $('#toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast' + (type === 'success' ? ' success' : type === 'warning' ? ' warning' : '');
    const icons = { error: '\u2716', success: '\u2714', warning: '\u26A0' };
    toast.innerHTML =
      '<span class="toast-icon">' + (icons[type] || icons.error) + '</span>' +
      '<span class="toast-body">' + escapeHtml(message) + '</span>' +
      '<button class="toast-dismiss">&times;</button>';
    container.appendChild(toast);

    let startX = 0, currentX = 0, dragging = false;

    function onPointerDown(e) {
      if (e.target.closest('.toast-dismiss')) return;
      dragging = true;
      startX = e.clientX;
      toast.classList.add('dragging');
      toast.setPointerCapture(e.pointerId);
    }

    function onPointerMove(e) {
      if (!dragging) return;
      currentX = e.clientX - startX;
      if (currentX > 0) currentX = 0;
      toast.style.transform = 'translateX(' + currentX + 'px)';
      toast.style.opacity = 1 - Math.min(Math.abs(currentX) / 160, 0.8);
    }

    function onPointerUp() {
      if (!dragging) return;
      dragging = false;
      toast.classList.remove('dragging');
      if (Math.abs(currentX) > 80) {
        toast.style.transition = 'transform 0.25s ease, opacity 0.25s ease';
        toast.style.transform = 'translateX(' + (currentX < 0 ? '-120' : '120') + 'px)';
        toast.style.opacity = 0;
        setTimeout(() => toast.remove(), 250);
      } else {
        toast.style.transform = '';
        toast.style.opacity = '';
      }
      currentX = 0;
    }

    toast.addEventListener('pointerdown', onPointerDown);
    toast.addEventListener('pointermove', onPointerMove);
    toast.addEventListener('pointerup', onPointerUp);
    toast.addEventListener('pointercancel', onPointerUp);

    toast.querySelector('.toast-dismiss').addEventListener('click', () => {
      toast.classList.add('removing');
      setTimeout(() => toast.remove(), 250);
    });

    setTimeout(() => {
      if (toast.isConnected) {
        toast.classList.add('removing');
        setTimeout(() => toast.remove(), 250);
      }
    }, 6000);
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  async function getCwd() {
    return currentFolder || await window.api.system.getHomedir();
  }

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function getTimestamp() {
    return new Date().toLocaleTimeString('en-US', {
      hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  }

  const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'ico', 'bmp', 'tiff', 'tif']);

  function isImageFile(name) {
    const ext = name.split('.').pop().toLowerCase();
    return IMAGE_EXTS.has(ext);
  }

  function showImagePreview(base64Data, mimeType) {
    const container = $('#image-preview');
    const img = $('#preview-img');
    if (!container || !img) return;
    img.src = `data:${mimeType};base64,${base64Data}`;
    container.style.display = 'flex';
    hideWelcome();
    if (window._monacoEditor) window._monacoEditor.getDomNode().style.display = 'none';
    if (window._fallbackEditor) window._fallbackEditor.style.display = 'none';
  }

  function hideImagePreview() {
    const container = $('#image-preview');
    if (container) container.style.display = 'none';
    if (window._monacoEditor) window._monacoEditor.getDomNode().style.display = '';
    if (window._fallbackEditor) window._fallbackEditor.style.display = '';
  }

  function hideWelcome() {
    if (welcomeMsg) welcomeMsg.style.display = 'none';
  }

  function showWelcome() {
    if (welcomeMsg) welcomeMsg.style.display = '';
    hideImagePreview();
    $$('.editor-container').forEach((el) => el.remove());
  }

  // ── Git Status ──────────────────────────────────────────────────────────

  async function updateGitStatus() {
    if (!currentFolder) return;
    try {
      const result = await window.api.git.status(currentFolder);
      const branchEl = $('#branch-name');
      if (branchEl) branchEl.textContent = result.branch || 'no-git';
    } catch {}
  }

  // ── Git Branch Dropdown ────────────────────────────────────────────────

  const branchDropdown = $('#branch-dropdown');
  const branchList = $('#branch-list');
  const branchGitLog = $('#branch-git-log');
  const gitLogPopup = $('#git-log-popup');
  const gitLogList = $('#git-log-list');
  const gitLogClose = $('#git-log-close');

  async function openBranchDropdown() {
    if (!currentFolder) return;
    branchDropdown.classList.remove('hidden');
    gitLogPopup.classList.add('hidden');
    branchList.innerHTML = '<div class="branch-dropdown-item" style="color:var(--text-dim)">Loading...</div>';

    try {
      const result = await window.api.git.branches(currentFolder);
      branchList.innerHTML = '';
      if (result.branches.length === 0) {
        branchList.innerHTML = '<div class="branch-dropdown-item" style="color:var(--text-dim)">No branches found</div>';
        return;
      }
      for (const branch of result.branches) {
        const item = document.createElement('div');
        item.className = 'branch-dropdown-item' + (branch === result.current ? ' active' : '');
        item.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/></svg>${escapeHtml(branch)}`;
        item.addEventListener('click', async () => {
          if (branch === result.current) { branchDropdown.classList.add('hidden'); return; }
          branchList.innerHTML = '<div class="branch-dropdown-item" style="color:var(--text-dim)">Switching...</div>';
          try {
            const switchResult = await window.api.git.switch({ cwd: currentFolder, branch });
            if (switchResult.success) {
              await updateGitStatus();
              await refreshFileTree();
              termPrint('Switched to branch: ' + branch, 'line-success');
            } else {
              termPrint('Error: ' + (switchResult.error || 'Switch failed'), 'line-stderr');
            }
          } catch (err) {
            termPrint('Error: ' + err.message, 'line-stderr');
          }
          branchDropdown.classList.add('hidden');
        });
        branchList.appendChild(item);
      }
    } catch (err) {
      branchList.innerHTML = '<div class="branch-dropdown-item" style="color:var(--text-dim)">Not a git repo</div>';
    }
  }

  if (statusBranch) {
    statusBranch.addEventListener('click', (e) => {
      e.stopPropagation();
      if (branchDropdown.classList.contains('hidden')) {
        openBranchDropdown();
      } else {
        branchDropdown.classList.add('hidden');
      }
    });
  }

  if (branchGitLog) {
    branchGitLog.addEventListener('click', async () => {
      branchDropdown.classList.add('hidden');
      await openGitLog();
    });
  }

  if (gitLogClose) {
    gitLogClose.addEventListener('click', () => gitLogPopup.classList.add('hidden'));
  }

  document.addEventListener('click', (e) => {
    if (branchDropdown && !branchDropdown.contains(e.target) && !statusBranch?.contains(e.target)) {
      branchDropdown.classList.add('hidden');
    }
    if (gitLogPopup && !gitLogPopup.contains(e.target) && !branchGitLog?.contains(e.target)) {
      gitLogPopup.classList.add('hidden');
    }
  });

  // ── Git Log ────────────────────────────────────────────────────────────

  async function openGitLog() {
    if (!currentFolder) return;
    gitLogPopup.classList.remove('hidden');
    gitLogList.innerHTML = '<div class="git-log-empty">Loading...</div>';

    try {
      const entries = await window.api.git.log(currentFolder);
      gitLogList.innerHTML = '';
      if (entries.length === 0) {
        gitLogList.innerHTML = '<div class="git-log-empty">No commits found</div>';
        return;
      }
      for (const entry of entries) {
        const el = document.createElement('div');
        el.className = 'git-log-entry';
        el.innerHTML =
          `<span class="git-log-hash">${escapeHtml(entry.hash)}</span>` +
          `<span class="git-log-message">${escapeHtml(entry.message)}</span>`;
        gitLogList.appendChild(el);
      }
    } catch (err) {
      gitLogList.innerHTML = '<div class="git-log-empty">Error loading log</div>';
    }
  }

  // ── File Watcher ─────────────────────────────────────────────────────

  async function startFileWatcher() {
    if (!currentFolder) return;
    await window.api.watcher.stop('main');
    await window.api.watcher.start({ dirPath: currentFolder, id: 'main' });
  }

  window.api.watcher.onChange(function (data) {
    if (data.id !== 'main') return;
    clearTimeout(watcherRefreshTimer);
    watcherRefreshTimer = setTimeout(function () {
      refreshFileTree();
      const fn = String(data.filename || '').toLowerCase();
      if (fn.includes('migration') || fn.endsWith('.py')) nautRefreshMigrations();
    }, 800);
  });

  // ── Shell Config ───────────────────────────────────────────────────────

  let terminalActive = false;

  function getShellCommand(cmd) {
    const shells = {
      cmd: { command: 'cmd.exe', args: ['/c', cmd] },
      powershell: { command: 'powershell.exe', args: ['-NoProfile', '-Command', cmd] },
      bash: { command: 'bash.exe', args: ['-c', cmd] },
      wsl: { command: 'wsl.exe', args: [cmd] },
    };
    return shells[shellType] || shells.cmd;
  }

  function updateShellPrompt() {
    // xterm.js handles the prompt display natively via the shell itself
  }

  // ── Output Panel ───────────────────────────────────────────────────────

  function outputPrint(text, cls) {
    if (!outputLog) return;
    const line = document.createElement('div');
    line.className = 'out-line';
    line.innerHTML = `<span class="out-time">[${getTimestamp()}]</span><span class="${cls || 'out-info'}">${escapeHtml(text)}</span>`;
    outputLog.appendChild(line);
    outputLog.scrollTop = outputLog.scrollHeight;
  }

  function outputClear() {
    if (outputLog) outputLog.innerHTML = '';
  }

  // ── Problems Panel ─────────────────────────────────────────────────────

  function updateProblemsPanel(issues) {
    problemsList.innerHTML = '';
    if (!issues || issues.length === 0) {
      problemsList.innerHTML = '<div class="problems-empty">No problems detected in the workspace.</div>';
      return;
    }
    for (const issue of issues) {
      const el = document.createElement('div');
      el.className = 'problem-item';
      const iconCls = issue.severity === 'error' ? 'error' : issue.severity === 'warning' ? 'warning' : 'info';
      const iconChar = issue.severity === 'error' ? '\u2716' : issue.severity === 'warning' ? '\u26A0' : '\u2139';
      const shortFile = issue.file ? issue.file.replace(currentFolder || '', '').replace(/^[/\\]/, '') : '';
      el.innerHTML =
        `<div class="problem-icon ${iconCls}">${iconChar}</div>` +
        `<span class="problem-msg">${escapeHtml(issue.title)}</span>` +
        `<span class="problem-file">${escapeHtml(shortFile)}${issue.line ? ':' + issue.line : ''}</span>`;
      el.addEventListener('click', () => {
        if (issue.file) openFile(issue.file, issue.file.split(/[/\\]/).pop());
      });
      problemsList.appendChild(el);
    }
  }

  function updateProblemsBadge(count) {
    const badge = $('#problems-badge');
    if (badge) badge.textContent = count > 0 ? count : '';
  }

  function updateStatusBarCounts(errors, warnings) {
    const errEl = $('#status-errors');
    const warnEl = $('#status-warnings');
    if (errEl) errEl.textContent = `${errors} error${errors !== 1 ? 's' : ''}`;
    if (warnEl) warnEl.textContent = `${warnings} warning${warnings !== 1 ? 's' : ''}`;
  }

  // ── Editor ─────────────────────────────────────────────────────────────

  // ── Monaco Themes ─────────────────────────────────────────────────────

  const MONACO_THEMES = {
    'vs-dark': {
      label: 'Dark+ (Default)',
      base: 'vs-dark',
      uiColors: {},
      rules: [
        { token: 'comment', foreground: '6A9955', fontStyle: 'italic' },
        { token: 'comment.type', foreground: '6A9955', fontStyle: 'italic' },
        { token: 'keyword', foreground: '569CD6' },
        { token: 'keyword.control', foreground: 'C586C0' },
        { token: 'string', foreground: 'CE9178' },
        { token: 'string.escape', foreground: 'D7BA7D' },
        { token: 'number', foreground: 'B5CEA8' },
        { token: 'number.hex', foreground: 'B5CEA8' },
        { token: 'number.octal', foreground: 'B5CEA8' },
        { token: 'number.binary', foreground: 'B5CEA8' },
        { token: 'type', foreground: '4EC9B0' },
        { token: 'class', foreground: '4EC9B0' },
        { token: 'class.declaration', foreground: '4EC9B0', fontStyle: 'bold' },
        { token: 'function', foreground: 'DCDCAA' },
        { token: 'function.declaration', foreground: 'DCDCAA', fontStyle: 'bold' },
        { token: 'func.name', foreground: 'DCDCAA', fontStyle: 'bold' },
        { token: 'type.identifier', foreground: '4EC9B0' },
        { token: 'variable', foreground: '9CDCFE' },
        { token: 'variable.predefined', foreground: '4FC1FF' },
        { token: 'parameter', foreground: '9CDCFE' },
        { token: 'operator', foreground: 'D4D4D4' },
        { token: 'decorator', foreground: 'C586C0' },
        { token: 'tag', foreground: '569CD6' },
        { token: 'attribute.name', foreground: '9CDCFE' },
        { token: 'attribute.value', foreground: 'CE9178' },
        { token: 'delimiter', foreground: '808080' },
        { token: 'metatag', foreground: '569CD6' },
        { token: 'regexp', foreground: 'D16969' },
        { token: 'constant', foreground: '569CD6' },
        { token: 'magic', foreground: 'DCDCAA', fontStyle: 'italic' },
        { token: 'namespace', foreground: '4EC9B0' },
        { token: 'django.field', foreground: '4EC9B0' },
        { token: 'django.class', foreground: '4EC9B0' },
        { token: 'django.shortcut', foreground: 'DCDCAA' },
        { token: 'builtin', foreground: '4FC1FF' },
        { token: 'identifier', foreground: '9CDCFE' },
        { token: 'white', foreground: 'D4D4D4' },
      ],
      colors: {
        'editor.background': '#1E1E1E',
        'editor.foreground': '#D4D4D4',
        'editorCursor.foreground': '#AEAFAD',
        'editor.lineHighlightBackground': '#2A2D2E',
        'editor.selectionBackground': '#264F78',
        'editor.inactiveSelectionBackground': '#3A3D41',
        'editorLineNumber.foreground': '#858585',
        'editorLineNumber.activeForeground': '#C6C6C6',
        'editorIndentGuide.background': '#404040',
        'editorIndentGuide.activeBackground': '#707070',
        'editorWidget.background': '#252526',
        'editorWidget.border': '#454545',
        'editorSuggestWidget.background': '#252526',
        'editorSuggestWidget.border': '#454545',
        'editorSuggestWidget.selectedBackground': '#094771',
        'editorHoverWidget.background': '#252526',
        'editorHoverWidget.border': '#454545',
      },
    },
    'monokai': {
      label: 'Monokai',
      base: 'vs-dark',
      uiColors: {},
      rules: [
        { token: 'comment', foreground: '75715E', fontStyle: 'italic' },
        { token: 'keyword', foreground: 'F92672' },
        { token: 'keyword.control', foreground: 'F92672' },
        { token: 'string', foreground: 'E6DB74' },
        { token: 'string.escape', foreground: 'AE81FF' },
        { token: 'number', foreground: 'AE81FF' },
        { token: 'type', foreground: 'A6E22E' },
        { token: 'class', foreground: 'A6E22E' },
        { token: 'function', foreground: 'A6E22E' },
        { token: 'variable', foreground: 'F8F8F2' },
        { token: 'variable.predefined', foreground: 'A6E22E' },
        { token: 'parameter', foreground: 'FD971F' },
        { token: 'operator', foreground: 'F92672' },
        { token: 'decorator', foreground: 'A6E22E' },
        { token: 'tag', foreground: 'F92672' },
        { token: 'attribute.name', foreground: 'A6E22E' },
        { token: 'attribute.value', foreground: 'E6DB74' },
        { token: 'delimiter', foreground: 'F8F8F2' },
        { token: 'comment.type', foreground: '75715E', fontStyle: 'italic' },
        { token: 'number.hex', foreground: 'AE81FF' },
        { token: 'number.octal', foreground: 'AE81FF' },
        { token: 'number.binary', foreground: 'AE81FF' },
        { token: 'class.declaration', foreground: 'A6E22E', fontStyle: 'bold' },
        { token: 'function.declaration', foreground: 'A6E22E', fontStyle: 'bold' },
        { token: 'func.name', foreground: 'A6E22E', fontStyle: 'bold' },
        { token: 'type.identifier', foreground: 'A6E22E' },
        { token: 'constant', foreground: 'F92672' },
        { token: 'magic', foreground: 'A6E22E', fontStyle: 'italic' },
        { token: 'namespace', foreground: 'A6E22E' },
        { token: 'django.field', foreground: 'A6E22E' },
        { token: 'django.class', foreground: 'A6E22E' },
        { token: 'django.shortcut', foreground: 'A6E22E' },
        { token: 'builtin', foreground: 'A6E22E' },
        { token: 'identifier', foreground: 'F8F8F2' },
        { token: 'white', foreground: 'F8F8F2' },
      ],
      colors: {
        'editor.background': '#272822',
        'editor.foreground': '#F8F8F2',
        'editorCursor.foreground': '#F8F8F0',
        'editor.lineHighlightBackground': '#3E3D32',
        'editor.selection.background': '#49483E',
        'editorLineNumber.foreground': '#90908A',
        'editorLineNumber.activeForeground': '#C2C2C0',
      },
    },
    'solarized-dark': {
      label: 'Solarized Dark',
      base: 'vs-dark',
      uiColors: {},
      rules: [
        { token: 'comment', foreground: '586E75', fontStyle: 'italic' },
        { token: 'keyword', foreground: '859900' },
        { token: 'keyword.control', foreground: '859900' },
        { token: 'string', foreground: '2AA198' },
        { token: 'string.escape', foreground: 'CB4B16' },
        { token: 'number', foreground: 'D33682' },
        { token: 'type', foreground: 'B58900' },
        { token: 'class', foreground: 'B58900' },
        { token: 'function', foreground: '268BD2' },
        { token: 'variable', foreground: '839496' },
        { token: 'variable.predefined', foreground: '268BD2' },
        { token: 'parameter', foreground: '93A1A1' },
        { token: 'operator', foreground: '859900' },
        { token: 'decorator', foreground: 'B58900' },
        { token: 'tag', foreground: '268BD2' },
        { token: 'attribute.name', foreground: '93A1A1' },
        { token: 'attribute.value', foreground: '2AA198' },
        { token: 'comment.type', foreground: '586E75', fontStyle: 'italic' },
        { token: 'number.hex', foreground: 'D33682' },
        { token: 'number.octal', foreground: 'D33682' },
        { token: 'number.binary', foreground: 'D33682' },
        { token: 'class.declaration', foreground: 'B58900', fontStyle: 'bold' },
        { token: 'function.declaration', foreground: '268BD2', fontStyle: 'bold' },
        { token: 'func.name', foreground: '268BD2', fontStyle: 'bold' },
        { token: 'type.identifier', foreground: 'B58900' },
        { token: 'constant', foreground: '859900' },
        { token: 'magic', foreground: '268BD2', fontStyle: 'italic' },
        { token: 'namespace', foreground: 'B58900' },
        { token: 'django.field', foreground: 'B58900' },
        { token: 'django.class', foreground: 'B58900' },
        { token: 'django.shortcut', foreground: '268BD2' },
        { token: 'builtin', foreground: '268BD2' },
        { token: 'identifier', foreground: '839496' },
        { token: 'white', foreground: '839496' },
      ],
      colors: {
        'editor.background': '#002B36',
        'editor.foreground': '#839496',
        'editorCursor.foreground': '#839496',
        'editor.lineHighlightBackground': '#073642',
        'editor.selection.background': '#073642',
        'editorLineNumber.foreground': '#586E75',
        'editorLineNumber.activeForeground': '#93A1A1',
      },
    },
    'dracula': {
      label: 'Dracula',
      base: 'vs-dark',
      uiColors: {},
      rules: [
        { token: 'comment', foreground: '6272A4', fontStyle: 'italic' },
        { token: 'keyword', foreground: 'FF79C6' },
        { token: 'keyword.control', foreground: 'FF79C6' },
        { token: 'string', foreground: 'F1FA8C' },
        { token: 'string.escape', foreground: 'BD93F9' },
        { token: 'number', foreground: 'BD93F9' },
        { token: 'type', foreground: '8BE9FD' },
        { token: 'class', foreground: '8BE9FD', fontStyle: 'bold' },
        { token: 'function', foreground: '50FA7B' },
        { token: 'variable', foreground: 'F8F8F2' },
        { token: 'variable.predefined', foreground: '50FA7B' },
        { token: 'parameter', foreground: 'FFB86C' },
        { token: 'operator', foreground: 'FF79C6' },
        { token: 'decorator', foreground: '50FA7B' },
        { token: 'tag', foreground: 'FF79C6' },
        { token: 'attribute.name', foreground: '50FA7B' },
        { token: 'attribute.value', foreground: 'F1FA8C' },
        { token: 'comment.type', foreground: '6272A4', fontStyle: 'italic' },
        { token: 'number.hex', foreground: 'BD93F9' },
        { token: 'number.octal', foreground: 'BD93F9' },
        { token: 'number.binary', foreground: 'BD93F9' },
        { token: 'class.declaration', foreground: '8BE9FD', fontStyle: 'bold' },
        { token: 'function.declaration', foreground: '50FA7B', fontStyle: 'bold' },
        { token: 'func.name', foreground: '50FA7B', fontStyle: 'bold' },
        { token: 'type.identifier', foreground: '8BE9FD' },
        { token: 'constant', foreground: 'FF79C6' },
        { token: 'magic', foreground: '50FA7B', fontStyle: 'italic' },
        { token: 'namespace', foreground: '8BE9FD' },
        { token: 'django.field', foreground: '8BE9FD' },
        { token: 'django.class', foreground: '8BE9FD' },
        { token: 'django.shortcut', foreground: '50FA7B' },
        { token: 'builtin', foreground: '50FA7B' },
        { token: 'identifier', foreground: 'F8F8F2' },
        { token: 'white', foreground: 'F8F8F2' },
      ],
      colors: {
        'editor.background': '#282A36',
        'editor.foreground': '#F8F8F2',
        'editorCursor.foreground': '#F8F8F2',
        'editor.lineHighlightBackground': '#44475A',
        'editor.selection.background': '#44475A',
        'editorLineNumber.foreground': '#6272A4',
        'editorLineNumber.activeForeground': '#F8F8F2',
      },
    },
    'one-dark': {
      label: 'One Dark',
      base: 'vs-dark',
      uiColors: {},
      rules: [
        { token: 'comment', foreground: '5C6370', fontStyle: 'italic' },
        { token: 'keyword', foreground: 'C678DD' },
        { token: 'keyword.control', foreground: 'C678DD' },
        { token: 'string', foreground: '98C379' },
        { token: 'string.escape', foreground: '56B6C2' },
        { token: 'number', foreground: 'D19A66' },
        { token: 'type', foreground: 'E5C07B' },
        { token: 'class', foreground: 'E5C07B' },
        { token: 'function', foreground: '61AFEF' },
        { token: 'variable', foreground: 'E06C75' },
        { token: 'variable.predefined', foreground: '61AFEF' },
        { token: 'parameter', foreground: 'E06C75' },
        { token: 'operator', foreground: 'ABB2BF' },
        { token: 'decorator', foreground: 'C678DD' },
        { token: 'tag', foreground: 'E06C75' },
        { token: 'attribute.name', foreground: 'D19A66' },
        { token: 'attribute.value', foreground: '98C379' },
        { token: 'comment.type', foreground: '5C6370', fontStyle: 'italic' },
        { token: 'number.hex', foreground: 'D19A66' },
        { token: 'number.octal', foreground: 'D19A66' },
        { token: 'number.binary', foreground: 'D19A66' },
        { token: 'class.declaration', foreground: 'E5C07B', fontStyle: 'bold' },
        { token: 'function.declaration', foreground: '61AFEF', fontStyle: 'bold' },
        { token: 'func.name', foreground: '61AFEF', fontStyle: 'bold' },
        { token: 'type.identifier', foreground: 'E5C07B' },
        { token: 'constant', foreground: 'C678DD' },
        { token: 'magic', foreground: '61AFEF', fontStyle: 'italic' },
        { token: 'namespace', foreground: 'E5C07B' },
        { token: 'django.field', foreground: 'E5C07B' },
        { token: 'django.class', foreground: 'E5C07B' },
        { token: 'django.shortcut', foreground: '61AFEF' },
        { token: 'builtin', foreground: '61AFEF' },
        { token: 'identifier', foreground: 'E06C75' },
        { token: 'white', foreground: 'E06C75' },
      ],
      colors: {
        'editor.background': '#282C34',
        'editor.foreground': '#ABB2BF',
        'editorCursor.foreground': '#528BFF',
        'editor.lineHighlightBackground': '#2C313C',
        'editor.selection.background': '#3E4451',
        'editorLineNumber.foreground': '#636D83',
        'editorLineNumber.activeForeground': '#ABB2BF',
      },
    },
    'github-dark': {
      label: 'GitHub Dark',
      base: 'vs-dark',
      uiColors: {},
      rules: [
        { token: 'comment', foreground: '8B949E', fontStyle: 'italic' },
        { token: 'keyword', foreground: 'FF7B72' },
        { token: 'keyword.control', foreground: 'FF7B72' },
        { token: 'string', foreground: 'A5D6FF' },
        { token: 'string.escape', foreground: '79C0FF' },
        { token: 'number', foreground: '79C0FF' },
        { token: 'type', foreground: 'FFA657' },
        { token: 'class', foreground: 'FFA657' },
        { token: 'function', foreground: 'D2A8FF' },
        { token: 'variable', foreground: 'FFA657' },
        { token: 'variable.predefined', foreground: '79C0FF' },
        { token: 'parameter', foreground: 'C9D1D9' },
        { token: 'operator', foreground: 'FF7B72' },
        { token: 'decorator', foreground: 'D2A8FF' },
        { token: 'tag', foreground: '7EE787' },
        { token: 'attribute.name', foreground: '79C0FF' },
        { token: 'attribute.value', foreground: 'A5D6FF' },
        { token: 'comment.type', foreground: '8B949E', fontStyle: 'italic' },
        { token: 'number.hex', foreground: '79C0FF' },
        { token: 'number.octal', foreground: '79C0FF' },
        { token: 'number.binary', foreground: '79C0FF' },
        { token: 'class.declaration', foreground: 'FFA657', fontStyle: 'bold' },
        { token: 'function.declaration', foreground: 'D2A8FF', fontStyle: 'bold' },
        { token: 'func.name', foreground: 'D2A8FF', fontStyle: 'bold' },
        { token: 'type.identifier', foreground: 'FFA657' },
        { token: 'constant', foreground: 'FF7B72' },
        { token: 'magic', foreground: 'D2A8FF', fontStyle: 'italic' },
        { token: 'namespace', foreground: 'FFA657' },
        { token: 'django.field', foreground: 'FFA657' },
        { token: 'django.class', foreground: 'FFA657' },
        { token: 'django.shortcut', foreground: 'D2A8FF' },
        { token: 'builtin', foreground: '79C0FF' },
        { token: 'identifier', foreground: 'C9D1D9' },
        { token: 'white', foreground: 'FFA657' },
      ],
      colors: {
        'editor.background': '#0D1117',
        'editor.foreground': '#C9D1D9',
        'editorCursor.foreground': '#C9D1D9',
        'editor.lineHighlightBackground': '#161B22',
        'editor.selection.background': '#264F78',
        'editorLineNumber.foreground': '#484F58',
        'editorLineNumber.activeForeground': '#C9D1D9',
      },
    },
    'vs': {
      label: 'Light+ (Default Light)',
      base: 'vs',
      uiColors: {},
      rules: [
        { token: 'comment', foreground: '008000', fontStyle: 'italic' },
        { token: 'keyword', foreground: '0000FF' },
        { token: 'keyword.control', foreground: 'AF00DB' },
        { token: 'string', foreground: 'A31515' },
        { token: 'string.escape', foreground: 'EE0000' },
        { token: 'number', foreground: '098658' },
        { token: 'type', foreground: '267F99' },
        { token: 'class', foreground: '267F99' },
        { token: 'function', foreground: '795E26' },
        { token: 'variable', foreground: '001080' },
        { token: 'variable.predefined', foreground: '795E26' },
        { token: 'parameter', foreground: '001080' },
        { token: 'operator', foreground: '000000' },
        { token: 'decorator', foreground: '795E26' },
        { token: 'tag', foreground: '800000' },
        { token: 'attribute.name', foreground: 'FF0000' },
        { token: 'attribute.value', foreground: '0000FF' },
        { token: 'comment.type', foreground: '008000', fontStyle: 'italic' },
        { token: 'number.hex', foreground: '098658' },
        { token: 'number.octal', foreground: '098658' },
        { token: 'number.binary', foreground: '098658' },
        { token: 'class.declaration', foreground: '267F99', fontStyle: 'bold' },
        { token: 'function.declaration', foreground: '795E26', fontStyle: 'bold' },
        { token: 'func.name', foreground: '795E26', fontStyle: 'bold' },
        { token: 'type.identifier', foreground: '267F99' },
        { token: 'constant', foreground: '0000FF' },
        { token: 'magic', foreground: '795E26', fontStyle: 'italic' },
        { token: 'namespace', foreground: '267F99' },
        { token: 'django.field', foreground: '267F99' },
        { token: 'django.class', foreground: '267F99' },
        { token: 'django.shortcut', foreground: '795E26' },
        { token: 'builtin', foreground: '795E26' },
        { token: 'identifier', foreground: '001080' },
        { token: 'white', foreground: '001080' },
      ],
      colors: {
        'editor.background': '#FFFFFF',
        'editor.foreground': '#000000',
        'editorCursor.foreground': '#000000',
        'editor.lineHighlightBackground': '#F5F5F5',
        'editor.selectionBackground': '#ADD6FF',
        'editorLineNumber.foreground': '#237893',
        'editorLineNumber.activeForeground': '#000000',
      },
    },
  };

  function getMonacoThemeId() {
    return localStorage.getItem('editor_theme') || 'vs-dark';
  }

  function applyThemeCssVars(themeId) {
    const cssVars = THEME_CSS_VARS[themeId] || THEME_CSS_VARS['vs-dark'];
    const root = document.documentElement;
    for (const [key, val] of Object.entries(cssVars)) {
      root.style.setProperty(key, val);
    }
  }

  function applyMonacoTheme(themeId) {
    applyThemeCssVars(themeId);
    if (!window._monacoEditor || typeof monaco === 'undefined') return;
    const theme = MONACO_THEMES[themeId];
    if (!theme) return;
    monaco.editor.defineTheme(themeId, {
      base: theme.base,
      inherit: false,
      rules: theme.rules,
      colors: theme.colors,
    });
    monaco.editor.setTheme(themeId);
    localStorage.setItem('editor_theme', themeId);
  }

  const THEME_CSS_VARS = {
    'vs-dark': {
      '--bg-1': '#1e1e1e', '--bg-2': '#252526', '--bg-3': '#2d2d2d', '--bg-4': '#333333',
      '--border': '#3c3c3c', '--text': '#cccccc', '--text-dim': '#858585', '--text-bright': '#e0e0e0',
      '--accent': '#007acc', '--accent-hover': '#1c8cd9',
      '--green': '#4ec9b0', '--yellow': '#dcdcaa', '--red': '#f44747', '--orange': '#ce9178',
      '--blue': '#569cd6', '--purple': '#c586c0',
      '--activity-bg': '#333333', '--sidebar-bg': '#252526', '--editor-bg': '#1e1e1e',
      '--panel-bg': '#1e1e1e', '--status-bg': '#007acc',
    },
    'monokai': {
      '--bg-1': '#272822', '--bg-2': '#2D2E28', '--bg-3': '#3E3D32', '--bg-4': '#49483E',
      '--border': '#49483E', '--text': '#F8F8F2', '--text-dim': '#75715E', '--text-bright': '#F9F8F5',
      '--accent': '#A6E22E', '--accent-hover': '#B8E33E',
      '--green': '#A6E22E', '--yellow': '#E6DB74', '--red': '#F92672', '--orange': '#FD971F',
      '--blue': '#66D9EF', '--purple': '#AE81FF',
      '--activity-bg': '#2D2E28', '--sidebar-bg': '#272822', '--editor-bg': '#272822',
      '--panel-bg': '#272822', '--status-bg': '#75715E',
    },
    'solarized-dark': {
      '--bg-1': '#002B36', '--bg-2': '#073642', '--bg-3': '#073642', '--bg-4': '#586E75',
      '--border': '#073642', '--text': '#839496', '--text-dim': '#586E75', '--text-bright': '#93A1A1',
      '--accent': '#268BD2', '--accent-hover': '#3AA0E0',
      '--green': '#859900', '--yellow': '#B58900', '--red': '#DC322F', '--orange': '#CB4B16',
      '--blue': '#268BD2', '--purple': '#6C71C4',
      '--activity-bg': '#073642', '--sidebar-bg': '#002B36', '--editor-bg': '#002B36',
      '--panel-bg': '#002B36', '--status-bg': '#268BD2',
    },
    'dracula': {
      '--bg-1': '#282A36', '--bg-2': '#2E303E', '--bg-3': '#343746', '--bg-4': '#44475A',
      '--border': '#44475A', '--text': '#F8F8F2', '--text-dim': '#6272A4', '--text-bright': '#FFFFFF',
      '--accent': '#BD93F9', '--accent-hover': '#CAA8FF',
      '--green': '#50FA7B', '--yellow': '#F1FA8C', '--red': '#FF5555', '--orange': '#FFB86C',
      '--blue': '#8BE9FD', '--purple': '#FF79C6',
      '--activity-bg': '#2E303E', '--sidebar-bg': '#282A36', '--editor-bg': '#282A36',
      '--panel-bg': '#282A36', '--status-bg': '#6272A4',
    },
    'one-dark': {
      '--bg-1': '#282C34', '--bg-2': '#2C313C', '--bg-3': '#31353F', '--bg-4': '#3E4451',
      '--border': '#3E4451', '--text': '#ABB2BF', '--text-dim': '#5C6370', '--text-bright': '#E6E6E6',
      '--accent': '#61AFEF', '--accent-hover': '#79BFEE',
      '--green': '#98C379', '--yellow': '#E5C07B', '--red': '#E06C75', '--orange': '#D19A66',
      '--blue': '#61AFEF', '--purple': '#C678DD',
      '--activity-bg': '#2C313C', '--sidebar-bg': '#282C34', '--editor-bg': '#282C34',
      '--panel-bg': '#282C34', '--status-bg': '#5C6370',
    },
    'github-dark': {
      '--bg-1': '#0D1117', '--bg-2': '#161B22', '--bg-3': '#1C2128', '--bg-4': '#30363D',
      '--border': '#30363D', '--text': '#C9D1D9', '--text-dim': '#484F58', '--text-bright': '#F0F6FC',
      '--accent': '#58A6FF', '--accent-hover': '#79B8FF',
      '--green': '#7EE787', '--yellow': '#E3B341', '--red': '#FF7B72', '--orange': '#FFA657',
      '--blue': '#79C0FF', '--purple': '#D2A8FF',
      '--activity-bg': '#161B22', '--sidebar-bg': '#0D1117', '--editor-bg': '#0D1117',
      '--panel-bg': '#0D1117', '--status-bg': '#1F6FEB',
    },
    'vs': {
      '--bg-1': '#FFFFFF', '--bg-2': '#F3F3F3', '--bg-3': '#EBEBEB', '--bg-4': '#E0E0E0',
      '--border': '#D4D4D4', '--text': '#333333', '--text-dim': '#808080', '--text-bright': '#000000',
      '--accent': '#007ACC', '--accent-hover': '#1C8CD9',
      '--green': '#008000', '--yellow': '#795E26', '--red': '#FF0000', '--orange': '#A31515',
      '--blue': '#0000FF', '--purple': '#AF00DB',
      '--activity-bg': '#F3F3F3', '--sidebar-bg': '#F3F3F3', '--editor-bg': '#FFFFFF',
      '--panel-bg': '#F3F3F3', '--status-bg': '#007ACC',
    },
  };

  function initMonaco() {
    if (typeof require === 'undefined') return false;
    try {
      window.MonacoEnvironment = {
        getWorkerUrl: function () {
          return 'data:text/javascript;charset=utf-8,' + encodeURIComponent(
            'self.MonacoEnvironment={baseUrl:"https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/"};importScripts("https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs/base/worker/workerMain.js");'
          );
        },
      };
      require.config({
        paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs' },
      });
      require(['vs/editor/editor.main'], function () {
        const savedTheme = getMonacoThemeId();
        for (const [id, def] of Object.entries(MONACO_THEMES)) {
          monaco.editor.defineTheme(id, {
            base: def.base,
            inherit: false,
            rules: def.rules,
            colors: def.colors,
          });
        }

        monaco.languages.setMonarchTokensProvider('python', {
          keywords: [
            'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await',
            'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except',
            'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is',
            'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return',
            'try', 'while', 'with', 'yield',
          ],
          controlKeywords: [
            'if', 'elif', 'else', 'for', 'while', 'try', 'except', 'finally',
            'with', 'as', 'return', 'yield', 'raise', 'break', 'continue', 'pass',
            'del', 'global', 'nonlocal', 'assert', 'lambda', 'in', 'is',
            'and', 'or', 'not', 'from', 'import',
          ],
          builtins: [
            'print', 'len', 'range', 'str', 'int', 'float', 'list', 'dict',
            'set', 'tuple', 'type', 'isinstance', 'enumerate', 'zip', 'map',
            'filter', 'sorted', 'super', 'property', 'staticmethod', 'classmethod',
            'open', 'abs', 'all', 'any', 'bin', 'bool', 'bytearray', 'bytes',
            'callable', 'chr', 'complex', 'divmod', 'eval', 'exec', 'format',
            'frozenset', 'getattr', 'globals', 'hasattr', 'hash', 'hex', 'id',
            'input', 'issubclass', 'iter', 'locals', 'max', 'min', 'next',
            'object', 'oct', 'ord', 'pow', 'repr', 'reversed', 'round', 'setattr',
            'slice', 'sum', 'vars', '__import__',
          ],
          djangoFields: [
            'CharField', 'IntegerField', 'FloatField', 'DecimalField', 'BooleanField',
            'DateField', 'DateTimeField', 'TimeField', 'EmailField', 'URLField',
            'SlugField', 'FileField', 'ImageField', 'TextField', 'ForeignKey',
            'ManyToManyField', 'OneToOneField', 'AutoField', 'BigAutoField',
            'SmallAutoField', 'PositiveIntegerField', 'PositiveSmallIntegerField',
            'PositiveBigIntegerField', 'BigIntegerField', 'SmallIntegerField',
            'BinaryField', 'UUIDField', 'IPAddressField', 'GenericIPAddressField',
            'NullBooleanField', 'JSONField', 'ArrayField', 'HStoreField',
          ],
          djangoClasses: [
            'Model', 'QuerySet', 'Manager', 'BaseManager',
            'Serializer', 'ModelSerializer', 'HyperlinkedModelSerializer',
            'APIView', 'GenericAPIView', 'ListCreateAPIView', 'RetrieveUpdateDestroyAPIView',
            'ViewSet', 'ModelViewSet', 'ReadOnlyModelViewSet',
            'TestCase', 'TransactionTestCase', 'SimpleTestCase',
            'Command', 'BaseCommand',
            'User', 'Group', 'Permission',
            'Request', 'Response',
          ],
          djangoShortcuts: [
            'render', 'redirect', 'get_object_or_404', 'get_list_or_404',
          ],
          djangoModules: [
            'models', 'views', 'admin', 'forms', 'serializers', 'urls',
            'settings', 'exceptions', 'middleware', 'signals', 'utils',
            'test', 'decorators', 'shortcuts', 'http', 'template',
            'db', 'conf', 'contrib', 'dispatch', 'core',
            'rest_framework',
          ],
          operators: [
            '=', '>', '<', '!', '~', '?', ':',
            '==', '<=', '>=', '<>', '!=', '<<', '>>',
            '**', '//', '+=', '-=', '*=', '/=', '%=', '&=',
            '|=', '^=', '->', ':=', '@',
          ],
          symbols: /[=><!~?:&|+\-*/^%]+/,
          digits: /\d+(_+\d+)*/,
          octaldigits: /[0-7]+(_+[0-7]+)*/,
          hexdigits: /[0-9a-fA-F]+(_+[0-9a-fA-F]+)*/,

          tokenizer: {
            root: [
              [/# type:\s*ignore/, 'comment.type'],
              [/#.*$/, 'comment'],

              [/(f|fr|rf|F|FR|RF)"/, 'string', '@fstringDouble'],
              [/(f|fr|rf|F|FR|RF)'/, 'string', '@fstringSingle'],
              [/(r|b|u|R|B|U)"""[^"]*"""/, 'string'],
              [/(r|b|u|R|B|U)'''[^']*'''/, 'string'],
              [/"""/, 'string', '@tripleDouble'],
              [/'''/, 'string', '@tripleSingle'],
              [/(r|b|u|R|B|U)"/, 'string', '@doubleString'],
              [/(r|b|u|R|B|U)'/, 'string', '@singleString'],
              [/"/, 'string', '@doubleString'],
              [/'/, 'string', '@singleString'],

              [/\d+(\.\d+)?([eE][+-]?\d+)?j?/, 'number'],
              [/\b0[xX][\da-fA-F]+(_+[\da-fA-F]+)*\b/, 'number.hex'],
              [/\b0[oO][0-7]+(_+[0-7]+)*\b/, 'number.octal'],
              [/\b0[bB][01]+(_+[01]+)*\b/, 'number.binary'],

              [/@\w+/, 'decorator'],

              [/\bdef\b/, 'keyword', '@defName'],
              [/\bclass\b/, 'keyword', '@className'],
              [/\basync\s+def\b/, 'keyword', '@defName'],
              [/\basync\s+for\b/, 'keyword'],
              [/\basync\s+with\b/, 'keyword'],

              [/\b(True|False|None)\b/, 'constant'],
              [/\b(self|cls)\b/, 'variable.predefined'],

              [/\b(?:__\w+__)\b/, 'magic'],

              [/\b(?:CharField|IntegerField|FloatField|DecimalField|BooleanField|DateField|DateTimeField|TimeField|EmailField|URLField|SlugField|FileField|ImageField|TextField|ForeignKey|ManyToManyField|OneToOneField|AutoField|BigAutoField|SmallAutoField|PositiveIntegerField|PositiveSmallIntegerField|PositiveBigIntegerField|BigIntegerField|SmallIntegerField|BinaryField|UUIDField|IPAddressField|GenericIPAddressField|NullBooleanField|JSONField|ArrayField|HStoreField)\b/, 'django.field'],

              [/\b(?:Model|QuerySet|Manager|BaseManager|Serializer|ModelSerializer|HyperlinkedModelSerializer|APIView|GenericAPIView|ListCreateAPIView|RetrieveUpdateDestroyAPIView|ViewSet|ModelViewSet|ReadOnlyModelViewSet|TestCase|TransactionTestCase|SimpleTestCase|BaseCommand|User|Group|Permission|Request|Response)\b/, 'django.class'],

              [/\b(?:render|redirect|get_object_or_404|get_list_or_404)\b/, 'django.shortcut'],

              [/\b(?:models|views|admin|forms|serializers|urls|settings|exceptions|middleware|signals|utils|test|decorators|shortcuts|http|template|db|conf|contrib|dispatch|core|rest_framework)\b/, 'namespace'],

              [/\b(Optional|Union|List|Dict|Tuple|Set|Any|Callable|Type|ClassVar|Final|Literal)\b/, 'type'],

              [/\b[A-Z]\w*/, 'type'],

              [/\b(?:print|len|range|str|int|float|list|dict|set|tuple|type|isinstance|enumerate|zip|map|filter|sorted|super|property|staticmethod|classmethod|open|abs|all|any|bin|bool|callable|chr|divmod|eval|exec|format|getattr|globals|hasattr|hash|hex|id|input|iter|locals|max|min|next|object|oct|ord|pow|repr|reversed|round|setattr|sum|vars)\b/, 'builtin'],

              [/\b(?:if|elif|else|for|while|try|except|finally|with|as|return|yield|raise|break|continue|pass|del|global|nonlocal|assert|lambda)\b/, 'keyword.control'],

              [/\b(?:and|or|not|in|is|from|import|class|def|async|await)\b/, 'keyword'],

              [/[a-zA-Z_]\w*/, 'identifier'],

              [/[()[\]{},;:@]/, 'delimiter'],
              [/\.\.\./, 'delimiter'],
              [/\./, 'delimiter'],

              [/[=!<>]=?/, 'operator'],
              [/\*\*|\/\/|[+\-*/%&|^~<>]/, 'operator'],

              [/\s+/, 'white'],
            ],

            defName: [
              [/[a-zA-Z_]\w*/, 'func.name', '@pop'],
              [/./, '@pop'],
            ],
            className: [
              [/[a-zA-Z_]\w*/, 'type.identifier', '@pop'],
              [/./, '@pop'],
            ],

            fstringDouble: [
              [/[^\\"]+/, 'string'],
              [/\\./, 'string.escape'],
              [/"/, 'string', '@pop'],
            ],
            fstringSingle: [
              [/[^\\']+/, 'string'],
              [/\\./, 'string.escape'],
              [/'/, 'string', '@pop'],
            ],

            tripleDouble: [
              [/[^\\"]+/, 'string'],
              [/\\./, 'string.escape'],
              [/"""/, 'string', '@pop'],
              [/"/, 'string'],
            ],
            tripleSingle: [
              [/[^\\']+/, 'string'],
              [/\\./, 'string.escape'],
              [/'''/, 'string', '@pop'],
              [/'/, 'string'],
            ],

            doubleString: [
              [/[^\\"]+/, 'string'],
              [/\\./, 'string.escape'],
              [/"/, 'string', '@pop'],
            ],
            singleString: [
              [/[^\\']+/, 'string'],
              [/\\./, 'string.escape'],
              [/'/, 'string', '@pop'],
            ],
          },
        });

        window._monacoEditor = monaco.editor.create(editorArea, {
          value: '',
          language: 'python',
          theme: savedTheme,
          automaticLayout: true,
          fontSize: parseInt(localStorage.getItem('editor_fontsize') || '14'),
          minimap: { enabled: localStorage.getItem('editor_minimap') !== 'false' },
          scrollBeyondLastLine: false,
          wordWrap: localStorage.getItem('editor_wordwrap') !== 'false' ? 'on' : 'off',
          tabSize: parseInt(localStorage.getItem('editor_tabsize') || '4'),
          padding: { top: 8 },
          glyphMargin: true,
          folding: true,
          bracketPairColorization: { enabled: true },
          codeLens: true,
          suggest: {
            showKeywords: true,
            showSnippets: true,
            showFunctions: true,
            showVariables: true,
          },
        });

        window._monacoEditor.onDidChangeCursorPosition((e) => {
          const pos = e.position;
          const cursorEl = $('#status-cursor');
          if (cursorEl) cursorEl.textContent = 'Ln ' + pos.lineNumber + ', Col ' + pos.column;
        });
        window._monacoEditor.onDidChangeModelContent(() => {
          const tab = openTabs.find((t) => t.id === activeTabId);
          if (tab) {
            tab._content = window._monacoEditor.getValue();
            if (!tab.modified) {
              tab.modified = true;
              updateTabClasses();
            }
          }
        });

        applyThemeCssVars(savedTheme);

        monaco.languages.registerHoverProvider('python', {
          provideHover: function (model, position) {
            const word = model.getWordAtPosition(position);
            if (!word) return null;
            const wordRange = new monaco.Range(
              position.lineNumber, word.startColumn,
              position.lineNumber, word.endColumn
            );
            const text = model.getLineContent(position.lineNumber);
            const linePrefix = text.substring(0, position.column - 1);

            const PY_HOVER = {
              'def': { label: 'keyword: def', description: 'Define a function' },
              'class': { label: 'keyword: class', description: 'Define a class' },
              'import': { label: 'keyword: import', description: 'Import a module' },
              'from': { label: 'keyword: from', description: 'Import from a module' },
              'return': { label: 'keyword: return', description: 'Return a value from a function' },
              'if': { label: 'keyword: if', description: 'Conditional execution' },
              'else': { label: 'keyword: else', description: 'Alternative branch' },
              'elif': { label: 'keyword: elif', description: 'Else if condition' },
              'for': { label: 'keyword: for', description: 'Iterate over a sequence' },
              'while': { label: 'keyword: while', description: 'Loop while condition is true' },
              'try': { label: 'keyword: try', description: 'Try block for exception handling' },
              'except': { label: 'keyword: except', description: 'Handle an exception' },
              'finally': { label: 'keyword: finally', description: 'Always execute this block' },
              'raise': { label: 'keyword: raise', description: 'Raise an exception' },
              'with': { label: 'keyword: with', description: 'Context manager' },
              'as': { label: 'keyword: as', description: 'Alias for import or context' },
              'yield': { label: 'keyword: yield', description: 'Yield value in a generator' },
              'lambda': { label: 'keyword: lambda', description: 'Create an anonymous function' },
              'pass': { label: 'keyword: pass', description: 'Null operation (no action)' },
              'break': { label: 'keyword: break', description: 'Exit the nearest enclosing loop' },
              'continue': { label: 'keyword: continue', description: 'Skip to next loop iteration' },
              'None': { label: 'NoneType', description: 'The absence of a value' },
              'True': { label: 'bool', description: 'Boolean True' },
              'False': { label: 'bool', description: 'Boolean False' },
              'self': { label: 'parameter: self', description: 'Reference to the current instance' },
              'print': { label: 'builtins.print(*objects, sep=" ", end="\\n", file=sys.stdout)', description: 'Print objects to the text stream' },
              'len': { label: 'builtins.len(s)', description: 'Return the length (the number of items) of an object' },
              'range': { label: 'builtins.range(stop)', description: 'Create a sequence of numbers' },
              'str': { label: 'class str', description: 'Create a string object' },
              'int': { label: 'class int', description: 'Create an integer object' },
              'float': { label: 'class float', description: 'Create a floating point number' },
              'list': { label: 'class list', description: 'Create a mutable sequence' },
              'dict': { label: 'class dict', description: 'Create a mapping object' },
              'set': { label: 'class set', description: 'Create a mutable set' },
              'tuple': { label: 'class tuple', description: 'Create an immutable sequence' },
              'type': { label: 'class type', description: 'The type of an object' },
              'isinstance': { label: 'builtins.isinstance(obj, classinfo)', description: 'Check if an object is an instance of a class' },
              'enumerate': { label: 'builtins.enumerate(iterable, start=0)', description: 'Return an enumerate object' },
              'zip': { label: 'builtins.zip(*iterables)', description: 'Combine iterables element-wise' },
              'map': { label: 'builtins.map(func, *iterables)', description: 'Apply function to every item' },
              'filter': { label: 'builtins.filter(function, iterable)', description: 'Filter items' },
              'sorted': { label: 'builtins.sorted(iterable, key=None, reverse=False)', description: 'Return a new sorted list' },
              'super': { label: 'builtins.super()', description: 'Return a proxy object for the parent class' },
              'property': { label: 'class property', description: 'Return a property attribute' },
              'staticmethod': { label: 'class staticmethod', description: 'Create a static method' },
              'classmethod': { label: 'class classmethod', description: 'Create a class method' },
              'request': { label: 'django.http.HttpRequest', description: 'The request object passed to Django views' },
              'HttpResponse': { label: 'django.http.HttpResponse', description: 'An HTTP response class' },
              'JsonResponse': { label: 'django.http.JsonResponse', description: 'An HTTP response class for JSON data' },
              'redirect': { label: 'django.shortcuts.redirect(to, *args, **kwargs)', description: 'Return an HttpResponseRedirect' },
              'render': { label: 'django.shortcuts.render(request, template_name, context=None)', description: 'Combine a template with a context and return HttpResponse' },
              'get_object_or_404': { label: 'django.shortcuts.get_object_or_404(klass, *args, **kwargs)', description: 'Fetch an object or raise 404' },
              'models': { label: 'django.db.models', description: 'Django ORM models module' },
              'Model': { label: 'class django.db.models.Model', description: 'Base class for all Django models' },
              'CharField': { label: 'class django.db.models.CharField(max_length)', description: 'A string field with max length' },
              'IntegerField': { label: 'class django.db.models.IntegerField', description: 'An integer field' },
              'ForeignKey': { label: 'class django.db.models.ForeignKey(to, on_delete)', description: 'A many-to-one relationship' },
              'ManyToManyField': { label: 'class django.db.models.ManyToManyField(to)', description: 'A many-to-many relationship' },
              'TextField': { label: 'class django.db.models.TextField', description: 'A large text field' },
              'BooleanField': { label: 'class django.db.models.BooleanField', description: 'A true/false field' },
              'DateField': { label: 'class django.db.models.DateField(auto_now=False, auto_now_add=False)', description: 'A date field' },
              'DateTimeField': { label: 'class django.db.models.DateTimeField', description: 'A date and time field' },
              'ForeignKey': { label: 'class django.db.models.ForeignKey(to, on_delete)', description: 'A many-to-one relationship' },
              'Serializer': { label: 'rest_framework.serializers.Serializer', description: 'DRF base serializer class' },
              'ModelSerializer': { label: 'rest_framework.serializers.ModelSerializer', description: 'DRF model serializer' },
              'APIView': { label: 'rest_framework.views.APIView', description: 'DRF base API view class' },
              'generics': { label: 'rest_framework.generics', description: 'DRF generic views module' },
              'urlpatterns': { label: 'list of URL patterns', description: 'Django URL configuration list' },
              'path': { label: 'django.urls.path(route, view, name=None)', description: 'Django URL path converter' },
              're_path': { label: 'django.urls.re_path(route, view, name=None)', description: 'Django URL regex path' },
              'admin': { label: 'django.contrib.admin', description: 'Django admin module' },
              'settings': { label: 'django.conf.settings', description: 'Django settings module' },
              'objects': { label: 'Manager', description: 'Default manager for model queries' },
              'save': { label: 'Model.save(*args, **kwargs)', description: 'Save this instance to the database' },
              'delete': { label: 'Model.delete(*args, **kwargs)', description: 'Delete this instance from the database' },
              'clean': { label: 'Model.clean()', description: 'Model validation method' },
              'objects': { label: 'Manager', description: 'Default manager for model queries' },
              'create': { label: 'Manager.create(**kwargs)', description: 'Create a new object and save it' },
              'filter': { label: 'Manager.filter(*args, **kwargs)', description: 'Return a queryset matching the parameters' },
              'all': { label: 'Manager.all()', description: 'Return all objects' },
              'get': { label: 'Manager.get(*args, **kwargs)', description: 'Fetch a single object' },
              'first': { label: 'Manager.first()', description: 'Return the first object' },
              'count': { label: 'Manager.count()', description: 'Return the count of objects' },
            };

            const dj = PY_HOVER[word.word];
            if (dj) {
              return {
                range: wordRange,
                contents: [
                  { value: '**' + dj.label + '**' },
                  { value: dj.description },
                ],
              };
            }

            return null;
          },
        });

        monaco.languages.registerCompletionItemProvider('python', {
          triggerCharacters: ['.', "'", '"'],
          provideCompletionItems: function (model, position) {
            const word = model.getWordUntilPosition(position);
            const range = {
              startLineNumber: position.lineNumber,
              startColumn: word.startColumn,
              endLineNumber: position.lineNumber,
              endColumn: word.endColumn,
            };
            const suggestions = [
              { label: 'def', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'def ${1:function_name}(${2:args}):\n\t${3:pass}', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range },
              { label: 'class', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'class ${1:ClassName}:\n\tdef __init__(self${2:, args}):\n\t\t${3:pass}', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range },
              { label: 'for', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'for ${1:item} in ${2:iterable}:\n\t${3:pass}', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range },
              { label: 'if', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'if ${1:condition}:\n\t${2:pass}', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range },
              { label: 'try', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'try:\n\t${1:pass}\nexcept ${2:Exception} as e:\n\t${3:print(e)}', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range },
              { label: 'with', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'with ${1:expression} as ${2:var}:\n\t${3:pass}', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range },
              { label: 'while', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'while ${1:condition}:\n\t${2:pass}', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range },
              { label: 'return', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'return ${1:value}', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range },
              { label: 'import', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'import ${1:module}', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range },
              { label: 'from import', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'from ${1:module} import ${2:name}', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range },
              { label: '__init__', kind: monaco.languages.CompletionItemKind.Snippet, insertText: 'def __init__(self${1:, args}):\n\tsuper().__init__()\n\t${2:pass}', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range, detail: 'Django __init__ method' },
              { label: '__str__', kind: monaco.languages.CompletionItemKind.Snippet, insertText: 'def __str__(self):\n\treturn ${1:self.name}', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range, detail: 'String representation' },
              { label: '__repr__', kind: monaco.languages.CompletionItemKind.Snippet, insertText: 'def __repr__(self):\n\treturn f"<${1:Model}({2:self.id})>"', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range },
              { label: 'models.Model', kind: monaco.languages.CompletionItemKind.Class, insertText: 'class ${1:MyModel}(models.Model):\n\t${2:name} = models.CharField(max_length=${3:100})\n\n\tdef __str__(self):\n\t\treturn self.${2:name}', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range, detail: 'Django Model' },
              { label: 'models.CharField', kind: monaco.languages.CompletionItemKind.Property, insertText: '${1:name} = models.CharField(max_length=${2:100})', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range },
              { label: 'models.TextField', kind: monaco.languages.CompletionItemKind.Property, insertText: '${1:description} = models.TextField(${2:blank=True, null=True})', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range },
              { label: 'models.IntegerField', kind: monaco.languages.CompletionItemKind.Property, insertText: '${1:count} = models.IntegerField(${2:default=0})', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range },
              { label: 'models.ForeignKey', kind: monaco.languages.CompletionItemKind.Property, insertText: '${1:user} = models.ForeignKey(${2:User}, on_delete=models.${3:CASCADE})', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range },
              { label: 'models.BooleanField', kind: monaco.languages.CompletionItemKind.Property, insertText: '${1:is_active} = models.BooleanField(${2:default=True})', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range },
              { label: 'models.DateTimeField', kind: monaco.languages.CompletionItemKind.Property, insertText: '${1:created} = models.DateTimeField(auto_now_add=${2:True})', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range },
              { label: 'models.DateField', kind: monaco.languages.CompletionItemKind.Property, insertText: '${1:date} = models.DateField(${2:auto_now_add=True})', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range },
              { label: 'models.DecimalField', kind: monaco.languages.CompletionItemKind.Property, insertText: '${1:price} = models.DecimalField(max_digits=${2:10}, decimal_places=${3:2})', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range },
              { label: 'models.SlugField', kind: monaco.languages.CompletionItemKind.Property, insertText: '${1:slug} = models.SlugField(${2:unique=True})', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range },
              { label: 'models.EmailField', kind: monaco.languages.CompletionItemKind.Property, insertText: '${1:email} = models.EmailField(${2:max_length=254})', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range },
              { label: 'models.URLField', kind: monaco.languages.CompletionItemKind.Property, insertText: '${1:url} = models.URLField(${2:max_length=200})', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range },
              { label: 'models.ImageField', kind: monaco.languages.CompletionItemKind.Property, insertText: '${1:image} = models.ImageField(upload_to=${2:"uploads/"})', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range },
              { label: 'models.UUIDField', kind: monaco.languages.CompletionItemKind.Property, insertText: '${1:id} = models.UUIDField(primary_key=${2:True}, default=${3:uuid.uuid4}, editable=${4:False})', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range },
              { label: 'models.JSONField', kind: monaco.languages.CompletionItemKind.Property, insertText: '${1:data} = models.JSONField(${2:default=dict})', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range },
              { label: 'models.ManyToManyField', kind: monaco.languages.CompletionItemKind.Property, insertText: '${1:tags} = models.ManyToManyField(${2:Tag}, ${3:blank=True})', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range },
              { label: 'class Meta', kind: monaco.languages.CompletionItemKind.Snippet, insertText: 'class Meta:\n\tverbose_name = ${1:"${2:model}"}\n\tverbose_name_plural = ${3:"${4:models}"}\n\tordering = ${5:("-created",)}', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range, detail: 'Django Meta class' },
              { label: 'class Serializer', kind: monaco.languages.CompletionItemKind.Snippet, insertText: 'class ${1:Model}Serializer(serializers.ModelSerializer):\n\tclass Meta:\n\t\tmodel = ${2:Model}\n\t\tfields = ${3:"__all__"}', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range, detail: 'DRF ModelSerializer' },
              { label: 'class ViewSet', kind: monaco.languages.CompletionItemKind.Snippet, insertText: 'class ${1:Model}ViewSet(viewsets.ModelViewSet):\n\tqueryset = ${2:Model}.objects.all()\n\tserializer_class = ${3:Model}Serializer', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range, detail: 'DRF ViewSet' },
              { label: 'class APIView', kind: monaco.languages.CompletionItemKind.Snippet, insertText: 'class ${1:MyView}(APIView):\n\tdef get(self, request):\n\t\t${2:pass}\n\n\tdef post(self, request):\n\t\t${3:pass}', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range, detail: 'DRF APIView' },
              { label: 'def get_queryset', kind: monaco.languages.CompletionItemKind.Snippet, insertText: 'def get_queryset(self):\n\treturn ${1:Model}.objects.filter(${2:user=self.request.user})', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range },
              { label: 'def perform_create', kind: monaco.languages.CompletionItemKind.Snippet, insertText: 'def perform_create(self, serializer):\n\tserializer.save(${1:user=self.request.user})', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range },
              { label: 'def get_permissions', kind: monaco.languages.CompletionItemKind.Snippet, insertText: 'def get_permissions(self):\n\tif self.action in ${1:["list", "retrieve"]}:\n\t\treturn [permissions.AllowAny()]\n\treturn [permissions.IsAuthenticated()]', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range },
              { label: 'urlpatterns', kind: monaco.languages.CompletionItemKind.Snippet, insertText: 'urlpatterns = [\n\tpath("${1:admin/}", admin.site.urls),\n\tpath("${2:api/}", include("${3:app}.urls")),\n]', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range },
              { label: 'path', kind: monaco.languages.CompletionItemKind.Function, insertText: 'path("${1:route}/", ${2:view}.as_view(), name="${3:name}")', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range },
            ];
            return { suggestions };
          },
        });

        editorMode = 'monaco';
        hideWelcome();
      });
      return true;
    } catch { return false; }
  }

  function createTextareaEditor() {
    const ta = document.createElement('textarea');
    ta.id = 'fallback-editor';
    editorArea.appendChild(ta);
    window._fallbackEditor = ta;
    editorMode = 'textarea';
    hideWelcome();
  }

  function getEditorValue() {
    if (editorMode === 'monaco' && window._monacoEditor) return window._monacoEditor.getValue();
    if (window._fallbackEditor) return window._fallbackEditor.value;
    return '';
  }

  function setEditorValue(text) {
    if (editorMode === 'monaco' && window._monacoEditor) {
      window._monacoEditor.setValue(text);
      return;
    }
    if (window._fallbackEditor) window._fallbackEditor.value = text;
  }

  function setEditorLanguage(name) {
    if (editorMode !== 'monaco' || !window._monacoEditor) return;
    const ext = name.split('.').pop().toLowerCase();
    const langMap = {
      py: 'python', html: 'html', htm: 'html', css: 'css', scss: 'scss', less: 'less',
      js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
      ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
      json: 'json', jsonc: 'json', md: 'markdown', txt: 'plaintext',
      xml: 'xml', xsd: 'xml', xsl: 'xml', svg: 'xml',
      yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini', cfg: 'ini', conf: 'ini',
      sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell',
      bat: 'bat', ps1: 'powershell', psd1: 'powershell', psm1: 'powershell',
      sql: 'sql', mysql: 'sql', pgsql: 'pgsql',
      cpp: 'cpp', c: 'c', h: 'c', hpp: 'cpp', cc: 'cpp', cxx: 'cpp',
      cs: 'csharp', java: 'java', go: 'go', rs: 'rust', rb: 'ruby',
      php: 'php', swift: 'swift', kt: 'kotlin', kts: 'kotlin', scala: 'scala',
      dart: 'dart', lua: 'lua', r: 'r', pl: 'perl', pm: 'perl',
      dockerfile: 'dockerfile', makefile: 'makefile', mk: 'makefile',
      graphql: 'graphql', gql: 'graphql', svelte: 'html', vue: 'html',
      tex: 'latex', bib: 'latex', diff: 'diff', patch: 'diff',
    };
    const lang = langMap[ext] || 'plaintext';
    monaco.editor.setModelLanguage(window._monacoEditor.getModel(), lang);
    const typeEl = $('#status-filetype');
    const names = {
      py: 'Python', html: 'HTML', css: 'CSS', scss: 'SCSS', less: 'Less',
      js: 'JavaScript', jsx: 'JSX', ts: 'TypeScript', tsx: 'TSX',
      json: 'JSON', md: 'Markdown', txt: 'Plain Text',
      yml: 'YAML', yaml: 'YAML', toml: 'TOML', ini: 'INI', sh: 'Shell Script',
      bat: 'Batch', ps1: 'PowerShell',
      sql: 'SQL', cpp: 'C++', c: 'C', cs: 'C#', java: 'Java',
      go: 'Go', rs: 'Rust', rb: 'Ruby', php: 'PHP', swift: 'Swift',
      kt: 'Kotlin', scala: 'Scala', dart: 'Dart', lua: 'Lua', r: 'R',
      pl: 'Perl', dockerfile: 'Dockerfile', makefile: 'Makefile',
      graphql: 'GraphQL', tex: 'LaTeX', diff: 'Diff', vue: 'Vue', svelte: 'Svelte',
      xml: 'XML', cfg: 'Config',
    };
    if (typeEl) typeEl.textContent = names[ext] || 'Plain Text';
  }

  // ── Tab System ─────────────────────────────────────────────────────────

  function findTab(filePath) {
    return openTabs.find((t) => t.path === filePath);
  }

  function createTab(filePath, name) {
    let tab = findTab(filePath);
    if (tab) {
      activateTab(tab.id);
      return tab;
    }

    tab = {
      id: 'tab-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      path: filePath,
      name: name || filePath.split(/[/\\]/).pop(),
      modified: false,
      _content: null,
    };
    openTabs.push(tab);
    renderTabs();
    activateTab(tab.id);
    return tab;
  }

  function activateTab(tabId) {
    const tab = openTabs.find((t) => t.id === tabId);
    if (!tab) return;
    if (activeTabId === tabId) return;
    activeTabId = tabId;

    $$('.tab').forEach((t) => t.classList.remove('active'));
    const el = tabBar.querySelector(`[data-tab="${tabId}"]`);
    if (el) el.classList.add('active');

    if (isImageFile(tab.name)) {
      hideImagePreview();
      if (tab._imgData) {
        showImagePreview(tab._imgData.data, tab._imgData.mime);
      } else {
        loadImageFile(tab.path, tab);
      }
      hideWelcome();
      highlightFileInTree(tab.name || tab.path.split(/[/\\]/).pop());
    } else if (tab._content !== null) {
      hideImagePreview();
      setEditorValue(tab._content);
      setEditorLanguage(tab.name || tab.path);
      hideWelcome();
      highlightFileInTree(tab.name || tab.path.split(/[/\\]/).pop());
    } else {
      hideImagePreview();
      loadFileIntoEditor(tab.path, tab.name);
    }
  }

  function loadFileIntoEditor(filePath, name) {
    const loadTab = findTab(filePath);
    const loadId = loadTab ? loadTab.id : null;
    window.api.fs.readfile(filePath).then((content) => {
      const tab = findTab(filePath);
      if (tab) tab._content = content;
      if (activeTabId === loadId) {
        hideImagePreview();
        setEditorValue(content);
        setEditorLanguage(name || filePath);
        hideWelcome();
        highlightFileInTree(name || filePath.split(/[/\\]/).pop());
      }
    }).catch((err) => {
      termPrint('Error: ' + err.message, 'line-stderr');
    });
  }

  function loadImageFile(filePath, tab) {
    window.api.fs.readfilebinary(filePath).then((result) => {
      const t = tab || findTab(filePath);
      if (t) t._imgData = result;
      if (activeTabId === (t ? t.id : null)) {
        showImagePreview(result.data, result.mime);
        hideWelcome();
        highlightFileInTree(t.name || filePath.split(/[/\\]/).pop());
      }
    }).catch((err) => {
      termPrint('Error: ' + err.message, 'line-stderr');
    });
  }

  function closeTab(tabId) {
    const idx = openTabs.findIndex((t) => t.id === tabId);
    if (idx === -1) return;
    openTabs.splice(idx, 1);

    if (activeTabId === tabId) {
      if (openTabs.length > 0) {
        const next = openTabs[Math.min(idx, openTabs.length - 1)];
        activateTab(next.id);
      } else {
        activeTabId = null;
        showWelcome();
      }
    }
    renderTabs();
  }

  function renderTabs() {
    tabBar.innerHTML = '';
    for (const tab of openTabs) {
      const el = document.createElement('div');
      el.className = 'tab' + (tab.id === activeTabId ? ' active' : '') + (tab.modified ? ' modified' : '');
      el.dataset.tab = tab.id;
      el.innerHTML =
        `<span class="tab-dot"></span>` +
        `<span class="tab-name">${escapeHtml(tab.name)}</span>` +
        `<span class="tab-close" data-close="${tab.id}">&times;</span>`;

      el.addEventListener('click', (e) => {
        if (e.target.dataset.close) {
          e.stopPropagation();
          closeTab(e.target.dataset.close);
          return;
        }
        activateTab(tab.id);
      });

      el.addEventListener('auxclick', (e) => {
        if (e.button === 1) {
          e.preventDefault();
          closeTab(tab.id);
        }
      });

      tabBar.appendChild(el);
    }

    if (openTabs.length === 0) {
      tabBar.innerHTML = '<div class="welcome-tab active" data-tab="welcome">Welcome</div>';
    }

    if (openTabs.length > 10) {
      const scrollBtns = document.createElement('div');
      scrollBtns.className = 'tab-scroll-btns';
      scrollBtns.innerHTML = `
        <button class="tab-scroll-btn" id="tab-scroll-left" title="Scroll left">&lt;</button>
        <button class="tab-scroll-btn" id="tab-scroll-right" title="Scroll right">&gt;</button>
      `;
      tabBar.appendChild(scrollBtns);

      const scrollLeftBtn = scrollBtns.querySelector('#tab-scroll-left');
      const scrollRightBtn = scrollBtns.querySelector('#tab-scroll-right');

      if (scrollLeftBtn) scrollLeftBtn.addEventListener('click', () => { tabBar.scrollLeft -= 100; });
      if (scrollRightBtn) scrollRightBtn.addEventListener('click', () => { tabBar.scrollLeft += 100; });
    }
  }

  function updateTabClasses() {
    for (const tab of openTabs) {
      const el = tabBar.querySelector(`[data-tab="${tab.id}"]`);
      if (el) {
        el.classList.toggle('active', tab.id === activeTabId);
        el.classList.toggle('modified', tab.modified);
      }
    }
  }

  function markTabModified(filePath, modified) {
    const tab = findTab(filePath);
    if (tab) {
      tab.modified = modified;
      updateTabClasses();
    }
  }

  // ── Terminal (xterm.js + node-pty via raw WebSocket) ─────────────────────

  const TERMINAL_THEME = {
    background: '#1e1e1e',
    foreground: '#cccccc',
    cursor: '#aeafad',
    selectionBackground: '#264f78',
    black: '#000000', red: '#cd3131', green: '#0dbc79', yellow: '#e5e510',
    blue: '#2472c8', magenta: '#bc3fbc', cyan: '#11a8cd', white: '#e5e5e5',
    brightBlack: '#666666', brightRed: '#f14c4c', brightGreen: '#23d18b', brightYellow: '#f5f543',
    brightBlue: '#3b8eea', brightMagenta: '#d670d6', brightCyan: '#29b8db', brightWhite: '#ffffff',
  };

  const termInstances = new Map();
  let activeTermId = 0;
  let nextTermId = 0;

  let _termWs = null;
  let _termWsReady = false;
  const _termWsQueue = [];

  function connectTerminalSocket() {
    return window.api.terminal.getPort().then((port) => {
      _termWs = new WebSocket('ws://127.0.0.1:' + port);

      _termWs.onopen = () => {
        _termWsReady = true;
        for (const msg of _termWsQueue) _termWs.send(msg);
        _termWsQueue.length = 0;
        const term = getActiveTerm();
        if (term && !term._processActive) {
          setTimeout(() => {
            try { term._fitAddon.fit(); } catch {}
            spawnTerminalProcess(term);
          }, 50);
        }
      };

      _termWs.onmessage = (evt) => {
        let msg;
        try { msg = JSON.parse(evt.data); } catch { return; }

        if (msg.type === 'output') {
          const term = termInstances.get(msg.tid);
          if (term) term.write(msg.data);

        } else if (msg.type === 'exit') {
          terminalActive = false;
          const term = termInstances.get(msg.tid);
          if (term) {
            term._processActive = false;
            term.write('\r\n[Shell exited with code ' + msg.data.code + ']\r\n');
          }
          outputPrint('Shell exited with code ' + msg.data.code, msg.data.code === 0 ? 'out-success' : 'out-error');

        } else if (msg.type === 'spawned') {
          const term = termInstances.get(msg.tid);
          if (term) term._processActive = true;
          terminalActive = true;

        } else if (msg.type === 'error') {
          const term = termInstances.get(msg.tid);
          if (term) term.write('\r\n[Error: ' + msg.data.message + ']\r\n');
        }
      };

      _termWs.onclose = () => { _termWsReady = false; _termWsQueue.length = 0; };
      _termWs.onerror = () => { _termWsReady = false; };
    });
  }

  function termSocketSend(type, tid, data) {
    const raw = JSON.stringify({ type, tid, data });
    if (!_termWs || _termWs.readyState !== 1) {
      _termWsQueue.push(raw);
      return;
    }
    _termWs.send(raw);
  }

  function spawnTerminalProcess(term, initialInput) {
    const tid = term._termId;
    const cwd = currentFolder || '';
    const dims = term._fitAddon ? term._fitAddon.proposeDimensions() : { cols: 80, rows: 24 };
    termSocketSend('spawn', tid, {
      shellType: term._shellType || shellType,
      cwd,
      cols: dims ? dims.cols : 80,
      rows: dims ? dims.rows : 24,
    });
    term._processActive = true;
    if (initialInput) termSocketSend('input', tid, initialInput);
  }

  function createXtermInstance(containerId, termId, termShellType) {
    const container = document.createElement('div');
    container.id = containerId;
    container.className = 'xterm-container';
    const panelContent = $('#bpanel-terminal');
    if (panelContent) panelContent.appendChild(container);

    const TermClass = typeof Terminal !== 'undefined' ? Terminal : (typeof window !== 'undefined' ? window.Terminal : null);
    if (!TermClass) throw new Error('xterm.js Terminal class not available');
    const term = new TermClass({
      fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Consolas', monospace",
      fontSize: 14,
      lineHeight: 1.2,
      letterSpacing: 0,
      theme: TERMINAL_THEME,
      cursorBlink: true,
      cursorStyle: 'bar',
      cursorWidth: 2,
      scrollback: 10000,
      drawBoldTextInBrightColors: true,
      minimumContrastRatio: 1,
      tabStopWidth: 8,
      scrollOnUserInput: true,
      fastScrollModifier: 'alt',
      fastScrollSensitivity: 5,
      allowProposedApi: true,
    });

    const fit = new FitAddon.FitAddon();
    term.loadAddon(fit);

    try {
      const links = new WebLinksAddon.WebLinksAddon();
      term.loadAddon(links);
    } catch {}

    term.open(container);

    term._fitAddon = fit;
    term._container = container;
    term._processActive = false;
    term._termId = termId;
    term._shellType = termShellType || shellType;

    term.onData((data) => {
      if (!term._processActive) {
        spawnTerminalProcess(term, data === '\x7F' ? '\x08' : data);
        return;
      }
      termSocketSend('input', term._termId, data === '\x7F' ? '\x08' : data);
    });

    term.onResize(({ cols, rows }) => {
      termSocketSend('resize', term._termId, { cols, rows });
    });

    return term;
  }

  function getActiveTerm() {
    return termInstances.get(activeTermId);
  }

  function termPrint(text) {
    const term = getActiveTerm();
    if (term) term.write(text);
  }

  async function ensureTerminal() {
    const term = getActiveTerm();
    if (!term || term._processActive) return;
    spawnTerminalProcess(term);
  }

  async function executeCommand(cmd) {
    await ensureTerminal();
    commandHistory.push(cmd);
    historyIndex = commandHistory.length;
    outputPrint('Executing: ' + cmd, 'out-info');
    const term = getActiveTerm();
    if (term) termSocketSend('input', term._termId, cmd + '\r\n');
  }

  const bottomPanel = $('#bottom-panel');
  if (bottomPanel) {
    bottomPanel.addEventListener('click', (e) => {
      if (e.target.closest('.panel-tabs')) return;
      const term = getActiveTerm();
      if (term) term.focus();
    });
  }

  function initFirstTerminal() {
    const TermClass = typeof Terminal !== 'undefined' ? Terminal : (typeof window !== 'undefined' ? window.Terminal : null);
    if (!TermClass) {
      outputPrint('xterm.js not loaded. Terminal unavailable.', 'out-error');
      return;
    }
    try {
      const id = nextTermId++;
      const term = createXtermInstance('xterm-container-0', id, shellType);
      termInstances.set(id, term);
      activeTermId = id;
      renderTerminalTabs();
      setTimeout(() => {
        try { term._fitAddon.fit(); } catch {}
        term.focus();
      }, 100);
    } catch (err) {
      console.error('Terminal init failed:', err);
      outputPrint('Terminal init error: ' + err.message, 'out-error');
    }
  }

  // ── Debounced ResizeObserver for smooth fit ────────────────────────────

  let termFitTimer = null;
  const termRo = new ResizeObserver(() => {
    if (termFitTimer) cancelAnimationFrame(termFitTimer);
    termFitTimer = requestAnimationFrame(() => {
      const term = getActiveTerm();
      if (term && term._fitAddon) {
        try { term._fitAddon.fit(); } catch {}
      }
    });
  });
  const termPanelContent = $('#bpanel-terminal');
  if (termPanelContent) termRo.observe(termPanelContent);

  // ── Multiple Terminals (tabs) ────────────────────────────────────────

  const terminalTabBar = $('#terminal-tab-bar');
  const terminalAddBtn = $('#terminal-add');

  function renderTerminalTabs() {
    if (!terminalTabBar) return;
    terminalTabBar.innerHTML = '';
    const shellShort = { cmd: 'CMD', powershell: 'PS', bash: 'bash', wsl: 'WSL' };
    for (const [id] of termInstances) {
      const term = termInstances.get(id);
      const st = term._shellType || shellType;
      const btn = document.createElement('button');
      btn.className = 'terminal-tab' + (id === activeTermId ? ' active' : '');
      btn.dataset.term = id;

      const label = document.createElement('span');
      label.className = 'terminal-tab-label';
      label.textContent = (shellShort[st] || st) + ' ' + (id + 1);

      const close = document.createElement('span');
      close.className = 'terminal-tab-close';
      close.textContent = '\u00d7';
      close.title = 'Close terminal';
      close.addEventListener('click', (e) => {
        e.stopPropagation();
        closeTerminal(id);
      });

      btn.appendChild(label);
      if (termInstances.size > 1) btn.appendChild(close);
      btn.addEventListener('click', () => switchTerminal(id));
      terminalTabBar.appendChild(btn);
    }
  }

  function switchTerminal(id) {
    if (!termInstances.has(id)) return;
    const prev = getActiveTerm();
    if (prev) prev._container.classList.add('hidden');

    activeTermId = id;
    const term = getActiveTerm();
    if (term) {
      term._container.classList.remove('hidden');
      setTimeout(() => {
        try { term._fitAddon.fit(); } catch {}
        term.focus();
      }, 20);
    }
    renderTerminalTabs();
  }

  function closeTerminal(id) {
    if (termInstances.size <= 1) return;
    const term = termInstances.get(id);
    if (term) {
      termSocketSend('kill', term._termId, {});
      term.dispose();
      term._container.remove();
      termInstances.delete(id);
    }
    if (activeTermId === id) {
      const ids = [...termInstances.keys()];
      switchTerminal(ids[0]);
    }
    renderTerminalTabs();
  }

  if (terminalAddBtn) {
    terminalAddBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const existing = document.querySelector('.shell-picker');
      if (existing) { existing.remove(); return; }

      const picker = document.createElement('div');
      picker.className = 'shell-picker';
      const shells = [
        { id: 'cmd', label: 'CMD', desc: 'Command Prompt' },
        { id: 'powershell', label: 'PowerShell', desc: 'pwsh' },
        { id: 'bash', label: 'Bash', desc: 'Git Bash / WSL' },
        { id: 'wsl', label: 'WSL', desc: 'Windows Subsystem for Linux' },
      ];
      for (const s of shells) {
        const item = document.createElement('div');
        item.className = 'shell-picker-item';
        item.innerHTML = '<strong>' + s.label + '</strong><small>' + s.desc + '</small>';
        item.addEventListener('click', () => {
          picker.remove();
          addNewTerminal(s.id);
        });
        picker.appendChild(item);
      }

      document.body.appendChild(picker);
      const rect = terminalAddBtn.getBoundingClientRect();
      picker.style.left = rect.left + 'px';
      picker.style.top = rect.bottom + 4 + 'px';

      const closePicker = (ev) => {
        if (!picker.contains(ev.target)) { picker.remove(); document.removeEventListener('click', closePicker); }
      };
      setTimeout(() => document.addEventListener('click', closePicker), 0);
    });
  }

  function addNewTerminal(termShellType) {
    const id = nextTermId++;
    const term = createXtermInstance('xterm-container-' + id, id, termShellType);
    termInstances.set(id, term);

    const prev = getActiveTerm();
    if (prev) prev._container.classList.add('hidden');

    activeTermId = id;
    term._container.classList.remove('hidden');
    renderTerminalTabs();
    setTimeout(() => {
      try { term._fitAddon.fit(); } catch {}
      spawnTerminalProcess(term);
      term.focus();
    }, 100);
  }

  // ── Process output (for Django runserver etc.) ──────────────────────────

  window.api.process.onOutput((data) => {
    const t = getActiveTerm();
    if (t) t.write(data.data);
    if (data.type === 'stderr') {
      outputPrint(data.data.trim(), 'out-error');
    }
  });

  window.api.process.onExit((data) => {
    outputPrint('Process exited with code ' + data.code, data.code === 0 ? 'out-success' : 'out-error');
  });

  // ── Bottom Panel Splitter (drag to resize) ─────────────────────────────

  const resizePanel = $('#resize-panel');
  const bottomPanelEl = $('#bottom-panel');
  if (resizePanel && bottomPanelEl) {
    let dragging = false, startY = 0, startH = 0;
    resizePanel.addEventListener('mousedown', (e) => {
      e.preventDefault();
      dragging = true;
      startY = e.clientY;
      startH = bottomPanelEl.offsetHeight;
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const newH = Math.max(80, Math.min(window.innerHeight * 0.5, startH - (e.clientY - startY)));
      bottomPanelEl.style.height = newH + 'px';
      bottomPanelEl.style.flexShrink = '0';
      const term = getActiveTerm();
      if (term && term._fitAddon) {
        try { term._fitAddon.fit(); } catch {}
      }
    });
    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    });
  }

  // ── Activity Bar ──────────────────────────────────────────────────────

  $$('.activity-icon[data-panel]').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.activity-icon[data-panel]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const panelId = btn.dataset.panel;
      $$('.sidebar-panel').forEach((p) => p.classList.remove('active'));
      const panel = $(`#panel-${panelId}`);
      if (panel) panel.classList.add('active');
    });
  });

  // ── Bottom Panel Tabs ─────────────────────────────────────────────────

  $$('.panel-tab[data-bpanel]').forEach((tab) => {
    tab.addEventListener('click', (e) => {
      if (e.target.tagName === 'SELECT') return;
      $$('.panel-tab[data-bpanel]').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      $$('.panel-content').forEach((p) => p.classList.remove('active'));
      const panel = $(`#bpanel-${tab.dataset.bpanel}`);
      if (panel) panel.classList.add('active');
    });
  });

  // ── File Tree ──────────────────────────────────────────────────────────

  const IGNORE_DIRS = new Set([
    'node_modules', '.git', '__pycache__', '.venv', 'venv', 'env',
    '.idea', '.vscode', 'dist', 'build', '.tox', '.mypy_cache',
  ]);

  function getFileIcon(name, isDir) {
    if (isDir) return { icon: '\uD83D\uDCC1', cls: 'dir' };
    const lower = name.toLowerCase();
    const ext = lower.split('.').pop();
    if (lower === 'dockerfile') return { icon: '\uD83D\uDC33', cls: 'file-docker' };
    if (lower.startsWith('docker-compose')) return { icon: '\uD83D\uDCC8', cls: 'file-docker' };
    if (lower === '.gitignore') return { icon: '\uD83D\uDD00', cls: 'file-git' };
    if (lower === '.gitlab-ci.yml') return { icon: '\uD83D\uDEE0', cls: 'file-ci' };
    if (lower === '.env' || lower.startsWith('.env.')) return { icon: '\uD83D\uDD12', cls: 'file-env' };
    if (lower === 'requirements.txt' || lower.startsWith('requirements') && ext === 'txt') return { icon: '\uD83D\uDCE6', cls: 'file-req' };
    if (lower === 'manage.py') return { icon: '\uD83D\uDC0D', cls: 'file-py' };
    if (lower === 'pyproject.toml' || lower === 'setup.cfg' || lower === 'setup.py') return { icon: '\uD83D\uDCE6', cls: 'file-config' };
    if (lower === 'Procfile') return { icon: '\u2699', cls: 'file-config' };
    if (lower === 'Makefile' || lower === 'makefile') return { icon: '\u2699', cls: 'file-config' };
    if (lower.endsWith('.sqlite') || lower.endsWith('.sqlite3') || lower === 'db.sqlite3' || lower === 'db.sqlite') return { icon: '\uD83D\uDDC4', cls: 'file-db' };
    const nameMap = {
      'readme.md': { icon: '\uD83D\uDCD6', cls: 'file-md' },
      'license': { icon: '\uD83D\uDCDC', cls: 'file-txt' },
      'license.md': { icon: '\uD83D\uDCDC', cls: 'file-txt' },
    };
    if (nameMap[lower]) return nameMap[lower];
    const map = {
      py: { icon: '\uD83D\uDC0D', cls: 'file-py' },
      html: { icon: '\uD83C\uDF10', cls: 'file-html' },
      htm: { icon: '\uD83C\uDF10', cls: 'file-html' },
      css: { icon: '\uD83C\uDFA8', cls: 'file-css' },
      scss: { icon: '\uD83C\uDFA8', cls: 'file-css' },
      js: { icon: '\u26A1', cls: 'file-js' },
      ts: { icon: '\uD83D\uDD35', cls: 'file-ts' },
      jsx: { icon: '\u269B', cls: 'file-js' },
      tsx: { icon: '\u269B', cls: 'file-ts' },
      json: { icon: '{ }', cls: 'file-json' },
      txt: { icon: '\uD83D\uDCC4', cls: 'file-txt' },
      md: { icon: '\uD83D\uDCDD', cls: 'file-md' },
      yml: { icon: '\uD83D\uDCCB', cls: 'file-yaml' },
      yaml: { icon: '\uD83D\uDCCB', cls: 'file-yaml' },
      toml: { icon: '\uD83D\uDCCB', cls: 'file-config' },
      ini: { icon: '\uD83D\uDCCB', cls: 'file-config' },
      cfg: { icon: '\uD83D\uDCCB', cls: 'file-config' },
      xml: { icon: '\uD83C\uDF10', cls: 'file-html' },
      sh: { icon: '\uD83D\uDCBB', cls: 'file-shell' },
      bash: { icon: '\uD83D\uDCBB', cls: 'file-shell' },
      bat: { icon: '\uD83D\uDCBB', cls: 'file-shell' },
      ps1: { icon: '\uD83D\uDCBB', cls: 'file-shell' },
      sql: { icon: '\uD83D\uDDC4', cls: 'file-db' },
      java: { icon: '\uD83C\uDF4F', cls: 'file-java' },
      go: { icon: '\uD83D\uDC33', cls: 'file-go' },
      rs: { icon: '\uD83E\uDE99', cls: 'file-rust' },
      rb: { icon: '\uD83D\uDC39', cls: 'file-ruby' },
      php: { icon: '\uD83D\uDCA0', cls: 'file-php' },
      c: { icon: '\uD83D\uDD35', cls: 'file-c' },
      cpp: { icon: '\uD83D\uDD35', cls: 'file-c' },
      h: { icon: '\uD83D\uDD35', cls: 'file-c' },
      'jpg': { icon: '\uD83D\uDDBC', cls: 'file-img' },
      'jpeg': { icon: '\uD83D\uDDBC', cls: 'file-img' },
      'png': { icon: '\uD83D\uDDBC', cls: 'file-img' },
      'gif': { icon: '\uD83D\uDDBC', cls: 'file-img' },
      'svg': { icon: '\uD83D\uDDBC', cls: 'file-img' },
      'webp': { icon: '\uD83D\uDDBC', cls: 'file-img' },
      'ico': { icon: '\uD83D\uDDBC', cls: 'file-img' },
      lock: { icon: '\uD83D\uDD12', cls: 'file-lock' },
    };
    return map[ext] || { icon: '\uD83D\uDCC4', cls: 'file-default' };
  }

  async function buildFileTree(dirPath, container, depth, generation) {
    try {
      const items = await window.api.fs.readdir(dirPath);
      items.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      for (const item of items) {
        if (generation !== fileTreeGeneration) return;
        if (IGNORE_DIRS.has(item.name)) continue;

        const info = getFileIcon(item.name, item.isDirectory);
        const row = document.createElement('div');
        row.className = `file-item ${info.cls}` + (item.isDirectory ? ' dir' : '');
        row.dataset.path = item.path;
        row.dataset.name = item.name;
        row.dataset.isDir = item.isDirectory;
        row.innerHTML =
          `<span class="icon">${info.icon}</span>` +
          `<span class="name">${escapeHtml(item.name)}</span>`;

        row.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (item.isDirectory) {
            const children = row.nextElementSibling;
            if (children?.classList.contains('file-children')) {
              const hidden = children.style.display === 'none' || children.style.display === '';
              const isCurrentlyHidden = children.style.display === 'none';
              if (isCurrentlyHidden) {
                children.style.display = '';
                const icon = row.querySelector('.icon');
                if (icon) icon.textContent = '\uD83D\uDCC2';
                if (children.children.length === 0) {
                  await buildFileTree(item.path, children, depth + 1, generation);
                }
              } else {
                children.style.display = 'none';
                const icon = row.querySelector('.icon');
                if (icon) icon.textContent = '\uD83D\uDCC1';
              }
            }
          } else {
            await openFile(item.path, item.name);
          }
        });

        row.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          showContextMenu(e.clientX, e.clientY, item.path, item.name, item.isDirectory);
        });

        container.appendChild(row);

        if (item.isDirectory) {
          const childContainer = document.createElement('div');
          childContainer.className = 'file-children';
          childContainer.style.display = 'none';
          container.appendChild(childContainer);
          if (depth < 1) {
            childContainer.style.display = '';
            row.querySelector('.icon').textContent = '\uD83D\uDCC2';
            await buildFileTree(item.path, childContainer, depth + 1, generation);
          }
        }
      }
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
      termPrint('Error: ' + err.message, 'line-stderr');
    }
  }

  async function refreshFileTree() {
    const expandedPaths = new Set();
    fileTree.querySelectorAll('.file-children').forEach((ch) => {
      if (ch.style.display !== 'none') {
        const row = ch.previousElementSibling;
        if (row && row.dataset.path) expandedPaths.add(row.dataset.path);
      }
    });
    fileTreeGeneration++;
    const gen = fileTreeGeneration;
    fileTree.innerHTML = '';
    if (!currentFolder) return;
    await buildFileTree(currentFolder, fileTree, 0, gen);
    for (const path of expandedPaths) {
      const row = fileTree.querySelector(`[data-path="${CSS.escape(path)}"]`);
      if (row && row.dataset.isDir === 'true') {
        const ch = row.nextElementSibling;
        if (ch && ch.classList.contains('file-children')) {
          ch.style.display = '';
          const icon = row.querySelector('.icon');
          if (icon) icon.textContent = '\uD83D\uDCC2';
          if (ch.children.length === 0) {
            await buildFileTree(path, ch, 1, gen);
          }
        }
      }
    }
  }

  // ── Open / Save File ───────────────────────────────────────────────────

  async function openFile(filePath, name) {
    try {
      hideWelcome();
      createTab(filePath, name);
      highlightFileInTree(name || filePath.split(/[/\\]/).pop());
    } catch (err) {
      showToast('Error opening file: ' + err.message, 'error');
      termPrint('Error: ' + err.message, 'line-stderr');
    }
  }

  async function openFileSilent(filePath, name) {
    try {
      if (isImageFile(name || filePath)) {
        const result = await window.api.fs.readfilebinary(filePath);
        showImagePreview(result.data, result.mime);
        hideWelcome();
        highlightFileInTree(name || filePath.split(/[/\\]/).pop());
      } else {
        const content = await window.api.fs.readfile(filePath);
        hideImagePreview();
        setEditorValue(content);
        setEditorLanguage(name || filePath);
        hideWelcome();
        highlightFileInTree(name || filePath.split(/[/\\]/).pop());
      }
    } catch (err) {
      showToast('Error reading file: ' + err.message, 'error');
      termPrint('Error: ' + err.message, 'line-stderr');
    }
  }

  function highlightFileInTree(name) {
    $$('.file-item.active').forEach((e) => e.classList.remove('active'));
    for (const item of $$('.file-item')) {
      if (item.querySelector('.name')?.textContent === name) {
        item.classList.add('active');
        break;
      }
    }
  }

  async function saveCurrentFile() {
    const tab = openTabs.find((t) => t.id === activeTabId);
    if (!tab) return;
    const content = getEditorValue();
    try {
      await window.api.fs.writefile({ filePath: tab.path, content });
      tab._content = content;
      markTabModified(tab.path, false);
      outputPrint('Saved: ' + tab.name, 'out-success');
    } catch (err) {
      showToast('Error saving: ' + err.message, 'error');
      termPrint('Error: ' + err.message, 'line-stderr');
    }
  }

  // ── Context Menu ───────────────────────────────────────────────────────

  let ctxTargetPath = null;
  let ctxTargetName = null;
  let ctxIsDir = false;

  function showContextMenu(x, y, filePath, name, isDir) {
    ctxTargetPath = filePath;
    ctxTargetName = name;
    ctxIsDir = isDir;
    contextMenu.classList.remove('hidden');
    contextMenu.style.left = x + 'px';
    contextMenu.style.top = y + 'px';

    const rect = contextMenu.getBoundingClientRect();
    if (rect.right > window.innerWidth) contextMenu.style.left = (x - rect.width) + 'px';
    if (rect.bottom > window.innerHeight) contextMenu.style.top = (y - rect.height) + 'px';
  }

  function hideContextMenu() {
    contextMenu.classList.add('hidden');
    ctxTargetPath = null;
  }

  document.addEventListener('click', hideContextMenu);

  $$('.ctx-item').forEach((item) => {
    item.addEventListener('click', async () => {
      const action = item.dataset.action;
      const targetPath = ctxTargetPath;
      const targetName = ctxTargetName;
      const isDir = ctxIsDir;
      if (!targetPath && action !== 'new-file' && action !== 'new-folder') return;
      hideContextMenu();

      if (action === 'new-file') {
        const baseDir = targetPath && isDir ? targetPath : (currentFolder || await getCwd());
        const name = prompt('File name:', 'untitled.py');
        if (!name) return;
        await window.api.fs.mkfile(baseDir + '/' + name);
        await refreshFileTree();
        outputPrint('Created file: ' + name, 'out-success');
      } else if (action === 'new-folder') {
        const baseDir = targetPath && isDir ? targetPath : (currentFolder || await getCwd());
        const name = prompt('Folder name:', 'new_folder');
        if (!name) return;
        await window.api.fs.mkdir(baseDir + '/' + name);
        await refreshFileTree();
        outputPrint('Created folder: ' + name, 'out-success');
      } else if (action === 'rename') {
        const newName = prompt('Rename to:', targetName);
        if (!newName || newName === targetName) return;
        const dir = targetPath.replace(/[/\\][^/\\]+$/, '');
        await window.api.fs.rename({ oldPath: targetPath, newPath: dir + '/' + newName });
        await refreshFileTree();
        outputPrint(`Renamed: ${targetName} -> ${newName}`, 'out-success');
      } else if (action === 'delete') {
        if (!confirm(`Delete "${targetName}"? This cannot be undone.`)) return;
        await window.api.fs.delete(targetPath);
        const tab = findTab(targetPath);
        if (tab) closeTab(tab.id);
        await refreshFileTree();
        outputPrint('Deleted: ' + targetName, 'out-info');
      } else if (action === 'copy-path') {
        if (navigator.clipboard) {
          await navigator.clipboard.writeText(targetPath);
          outputPrint('Path copied to clipboard', 'out-info');
        }
      }
    });
  });

  // ── Actions ────────────────────────────────────────────────────────────

  async function openFolder() {
    const folder = await window.api.dialog.openFolder();
    if (!folder) return;

    currentFolder = folder;
    addRecentFolder(folder);
    const name = folder.split(/[/\\]/).pop();
    folderName.textContent = name;
    updateShellPrompt();

    await refreshFileTree();
    await startFileWatcher();
    await updateGitStatus();

    termPrint('Opened: ' + folder, 'line-info');
    outputPrint('Folder opened: ' + folder, 'out-info');

    const scan = await window.api.django.scan(folder);
    if (!scan.error) {
      scanData = scan;
      buildDjangoTree(scan);
      $('#status-django').innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2"/></svg> Django`;
      buildDjangoManagementButtons();
    }
    nautAfterFolderOpen();
  }

  async function createProject() {
    const name = prompt('Project name:', 'myproject');
    if (!name) return;

    const cwd = await getCwd();
    executeCommand('cd /d "' + cwd + '" && django-admin startproject ' + name);
    outputPrint('Creating project: ' + name + '...', 'out-info');
    showToast('Creating Django project in terminal...', 'success');
  }

  // ── Search ─────────────────────────────────────────────────────────────

  let searchTimeout = null;

  async function performSearch() {
    const query = $('#search-input').value.trim();
    const resultsContainer = $('#search-results');
    if (!query || !currentFolder) {
      resultsContainer.innerHTML = '';
      return;
    }

    resultsContainer.innerHTML = '<div class="search-count">Searching...</div>';

    const matchCase = $('#search-case')?.checked;
    const isRegex = $('#search-regex')?.checked;

    try {
      const results = await window.api.fs.search({ dirPath: currentFolder, query, matchCase, isRegex });
      resultsContainer.innerHTML = '';

      if (results.length === 0) {
        resultsContainer.innerHTML = '<div class="search-count">No results found.</div>';
        return;
      }

      let totalMatches = 0;
      for (const r of results) totalMatches += r.matches.length;
      resultsContainer.innerHTML = `<div class="search-count">${totalMatches} results in ${results.length} files</div>`;

      for (const r of results) {
        const shortPath = r.file.replace(currentFolder, '').replace(/^[/\\]/, '');
        const fileEl = document.createElement('div');
        fileEl.className = 'search-result-file';
        fileEl.innerHTML = `<span>${escapeHtml(shortPath)}</span>`;
        fileEl.addEventListener('click', () => openFile(r.file, r.file.split(/[/\\]/).pop()));
        resultsContainer.appendChild(fileEl);

        for (const m of r.matches) {
          const matchEl = document.createElement('div');
          matchEl.className = 'search-result-match';
          let highlighted;
          try {
            const pattern = isRegex ? query : escapeHtml(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(pattern, matchCase ? 'g' : 'gi');
            highlighted = escapeHtml(m.text).replace(regex, '<mark>$&</mark>');
          } catch {
            highlighted = escapeHtml(m.text);
          }
          matchEl.innerHTML = `<span class="search-result-line">${m.line}</span><span class="search-result-text">${highlighted}</span>`;
          matchEl.addEventListener('click', () => openFile(r.file, r.file.split(/[/\\]/).pop()));
          resultsContainer.appendChild(matchEl);
        }
      }
    } catch (err) {
      resultsContainer.innerHTML = `<div class="search-count">Error: ${escapeHtml(err.message)}</div>`;
    }
  }

  $('#search-input')?.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(performSearch, 300);
  });

  $('#search-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      clearTimeout(searchTimeout);
      performSearch();
    }
  });

  // ── Django Tree ────────────────────────────────────────────────────────

  function buildDjangoTree(scan) {
    djangoTree.innerHTML = '';

    if (scan.settings) {
      const section = document.createElement('div');
      section.className = 'django-app';
      const header = document.createElement('div');
      header.className = 'django-app-header';
      header.innerHTML = `<span class="app-icon">&#9654;</span> settings.py`;
      const body = document.createElement('div');
      body.className = 'file-children';
      body.style.display = 'none';
      const items = [
        { text: `DEBUG = ${scan.settings.debug}`, color: scan.settings.debug ? 'var(--red)' : 'var(--green)' },
        { text: `DB: ${scan.settings.databaseEngine || 'sqlite3'}` },
      ];
      if (scan.settings.installedApps && scan.settings.installedApps.length > 0) {
        items.push({ text: `Installed Apps (${scan.settings.installedApps.length}):`, bold: true });
        for (const app of scan.settings.installedApps) {
          items.push({ text: `  ${app}`, indent: true });
        }
      }
      for (const item of items) {
        const el = document.createElement('div');
        el.className = 'django-model';
        el.innerHTML = `<span class="model-icon">&#9679;</span> <span style="${item.color ? 'color:' + item.color : ''}${item.bold ? ';font-weight:bold' : ''}${item.indent ? ';padding-left:24px;color:var(--text-dim)' : ''}">${escapeHtml(item.text)}</span>`;
        body.appendChild(el);
      }
      header.addEventListener('click', () => {
        body.style.display = body.style.display === 'none' ? '' : 'none';
        header.querySelector('.app-icon').innerHTML = body.style.display === 'none' ? '&#9654;' : '&#9660;';
      });
      section.appendChild(header);
      section.appendChild(body);
      djangoTree.appendChild(section);
    }

    const modelsByDir = {};
    for (const model of scan.models) {
      const dir = model.filePath.replace(/[/\\][^/\\]+$/, '');
      if (!modelsByDir[dir]) modelsByDir[dir] = [];
      modelsByDir[dir].push(model);
    }

    for (const [dir, models] of Object.entries(modelsByDir)) {
      const appName = dir.split(/[/\\]/).pop();
      const section = document.createElement('div');
      section.className = 'django-app';
      const header = document.createElement('div');
      header.className = 'django-app-header';
      header.innerHTML = `<span class="app-icon">&#9654;</span> ${appName}`;
      section.appendChild(header);

      const body = document.createElement('div');
      body.className = 'file-children';
      body.style.display = 'none';

      for (const model of models) {
        const item = document.createElement('div');
        item.className = 'django-model';
        item.innerHTML = `<span class="model-icon">&#9679;</span> ${model.name}`;
        item.addEventListener('click', () => openFile(model.filePath, 'models.py'));
        body.appendChild(item);

        for (const field of model.fields) {
          if (field.relatedModel) {
            const dep = document.createElement('div');
            dep.className = 'django-model';
            dep.style.paddingLeft = '44px';
            dep.innerHTML = `<span class="view-icon">&#8594;</span> ${field.name} -> ${field.relatedModel}`;
            body.appendChild(dep);
          }
        }
      }

      header.addEventListener('click', () => {
        body.style.display = body.style.display === 'none' ? '' : 'none';
        header.querySelector('.app-icon').innerHTML = body.style.display === 'none' ? '&#9654;' : '&#9660;';
      });

      section.appendChild(body);
      djangoTree.appendChild(section);
    }

    if (scan.views.length > 0) {
      const section = document.createElement('div');
      section.className = 'django-app';
      const header = document.createElement('div');
      header.className = 'django-app-header';
      header.innerHTML = `<span class="app-icon">&#9654;</span> Views (${scan.views.length})`;
      const body = document.createElement('div');
      body.className = 'file-children';
      body.style.display = 'none';
      for (const view of scan.views) {
        const item = document.createElement('div');
        item.className = 'django-model';
        const icon = view.type === 'class' ? '&#9673;' : '&#9675;';
        item.innerHTML = `<span class="view-icon">${icon}</span> ${view.name} <span style="color:var(--text-dim);font-size:10px;">${view.type}</span>`;
        item.addEventListener('click', () => openFile(view.filePath, view.filePath.split(/[/\\]/).pop()));
        body.appendChild(item);
      }
      header.addEventListener('click', () => {
        body.style.display = body.style.display === 'none' ? '' : 'none';
        header.querySelector('.app-icon').innerHTML = body.style.display === 'none' ? '&#9654;' : '&#9660;';
      });
      section.appendChild(header);
      section.appendChild(body);
      djangoTree.appendChild(section);
    }

    if (scan.serializers.length > 0) {
      const section = document.createElement('div');
      section.className = 'django-app';
      const header = document.createElement('div');
      header.className = 'django-app-header';
      header.innerHTML = `<span class="app-icon">&#9654;</span> Serializers (${scan.serializers.length})`;
      const body = document.createElement('div');
      body.className = 'file-children';
      body.style.display = 'none';
      for (const ser of scan.serializers) {
        const item = document.createElement('div');
        item.className = 'django-model';
        item.innerHTML = `<span class="model-icon">&#9673;</span> ${ser.name}`;
        item.addEventListener('click', () => openFile(ser.filePath, ser.filePath.split(/[/\\]/).pop()));
        body.appendChild(item);
      }
      header.addEventListener('click', () => {
        body.style.display = body.style.display === 'none' ? '' : 'none';
        header.querySelector('.app-icon').innerHTML = body.style.display === 'none' ? '&#9654;' : '&#9660;';
      });
      section.appendChild(header);
      section.appendChild(body);
      djangoTree.appendChild(section);
    }

    if (scan.urls.length > 0) {
      const section = document.createElement('div');
      section.className = 'django-app';
      const header = document.createElement('div');
      header.className = 'django-app-header';
      header.innerHTML = `<span class="app-icon">&#9654;</span> URLs (${scan.urls.length})`;
      const body = document.createElement('div');
      body.className = 'file-children';
      body.style.display = 'none';
      for (const url of scan.urls) {
        const item = document.createElement('div');
        item.className = 'django-model';
        item.innerHTML = `<span class="view-icon">&#8594;</span> <span style="color:var(--green)">${escapeHtml(url.pattern)}</span>`;
        item.addEventListener('click', () => openFile(url.filePath, url.filePath.split(/[/\\]/).pop()));
        body.appendChild(item);
      }
      header.addEventListener('click', () => {
        body.style.display = body.style.display === 'none' ? '' : 'none';
        header.querySelector('.app-icon').innerHTML = body.style.display === 'none' ? '&#9654;' : '&#9660;';
      });
      section.appendChild(header);
      section.appendChild(body);
      djangoTree.appendChild(section);
    }
  }

  // ── Django Management Commands ─────────────────────────────────────────

  function buildDjangoManagementButtons() {
    let mgmtContainer = djangoTree.querySelector('.django-mgmt');
    if (!mgmtContainer) {
      mgmtContainer = document.createElement('div');
      mgmtContainer.className = 'django-mgmt';
      djangoTree.appendChild(mgmtContainer);
    }
    mgmtContainer.innerHTML = `
      <div class="django-mgmt-header">
        <span class="app-icon">&#9654;</span> Management
      </div>
      <div class="django-mgmt-buttons">
        <button class="django-cmd-btn" data-cmd="runserver" title="Start development server">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg> runserver
        </button>
        <button class="django-cmd-btn" data-cmd="makemigrations" title="Create database migrations">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> makemigrations
        </button>
        <button class="django-cmd-btn" data-cmd="migrate" title="Apply database migrations">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg> migrate
        </button>
        <button class="django-cmd-btn" data-cmd="createsuperuser" title="Create admin user">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> createsuperuser
        </button>
        <button class="django-cmd-btn" data-cmd="collectstatic" title="Collect static files">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> collectstatic
        </button>
        <button class="django-cmd-btn django-cmd-stop" data-cmd="stopserver" title="Stop server">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="6" width="12" height="12" rx="2"/></svg> stop server
        </button>
      </div>
    `;

    mgmtContainer.querySelectorAll('.django-cmd-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cmd = btn.dataset.cmd;
        if (cmd === 'stopserver') {
          const t = getActiveTerm();
          if (t && t._processActive) {
            termSocketSend('input', t._termId, '\x03');
            showToast('Sent Ctrl+C to terminal.', 'success');
          } else {
            showToast('No active terminal process.', 'warning');
          }
          return;
        }
        runDjangoCmd(cmd);
      });
    });
  }

  async function runDjangoCmd(cmd) {
    if (!currentFolder) {
      showToast('Open a folder first.', 'warning');
      return;
    }
    const djangoRoot = scanData?.root || currentFolder;
    const fullCmd = cmd === 'runserver'
      ? 'cd /d "' + djangoRoot + '" && python manage.py runserver'
      : 'cd /d "' + djangoRoot + '" && python manage.py ' + cmd;

    const term = getActiveTerm();
    if (term && term._processActive) {
      ensureTerminal();
      executeCommand(fullCmd);
      outputPrint('Django: ' + fullCmd, 'out-info');
      if (cmd === 'runserver') {
        showToast('Starting dev server in terminal. Use Ctrl+C to stop.', 'success');
      }
    } else {
      if (cmd === 'stopserver') {
        const term = getActiveTerm();
        if (!term) return;
        termSocketSend('input', term._termId, '\x03');
        showToast('Server stopped.', 'success');
        return;
      }
      showToast('No active terminal. Open a terminal first.', 'warning');
    }
  }

  // ── Bug Hunter ─────────────────────────────────────────────────────────

  async function runBugHunter() {
    if (!currentFolder) {
      termPrint('Open a folder first.', 'line-info');
      return;
    }

    bugList.innerHTML = '<div class="bug-empty"><p>Scanning...</p></div>';
    bugSummary.classList.add('hidden');

    const result = await window.api.django.bughunt(currentFolder);
    if (result.scan.error) {
      bugList.innerHTML = `<div class="bug-empty"><p>${result.scan.error}</p></div>`;
      return;
    }

    scanData = result.scan;
    buildDjangoTree(result.scan);
    buildDjangoManagementButtons();

    if (result.issues.length === 0) {
      bugList.innerHTML = `
        <div class="bug-empty">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#4ec9b0" stroke-width="1.5">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
            <polyline points="22 4 12 14.01 9 11.01"/>
          </svg>
          <p style="color: var(--green);">No issues found!</p>
        </div>`;
      updateProblemsBadge(0);
      updateProblemsPanel([]);
      updateStatusBarCounts(0, 0);
      return;
    }

    bugList.innerHTML = '';
    const errors = result.issues.filter((i) => i.severity === 'error').length;
    const warnings = result.issues.filter((i) => i.severity === 'warning').length;
    const perfs = result.issues.filter((i) => i.severity === 'performance').length;
    const infos = result.issues.filter((i) => i.severity === 'info').length;

    updateProblemsBadge(errors + warnings);
    updateProblemsPanel(result.issues);
    updateStatusBarCounts(errors, warnings);

    for (const issue of result.issues) {
      const el = document.createElement('div');
      el.className = 'bug-item';
      const sevIcon = issue.severity === 'error' ? '\u2716' :
                      issue.severity === 'warning' ? '\u26A0' :
                      issue.severity === 'performance' ? '\u26A1' : '\u2139';
      const shortFile = issue.file ? issue.file.replace(currentFolder, '').replace(/[/\\]/, '') : '';
      el.innerHTML =
        `<div class="bug-severity ${issue.severity}">${sevIcon}</div>` +
        `<div class="bug-info">` +
          `<div class="bug-title">${escapeHtml(issue.title)}</div>` +
          `<div class="bug-message">${escapeHtml(issue.message)}</div>` +
          (shortFile ? `<div class="bug-file">${escapeHtml(shortFile)}${issue.line ? ':' + issue.line : ''}</div>` : '') +
        `</div>`;
      el.addEventListener('click', () => {
        if (issue.file) openFile(issue.file, issue.file.split(/[/\\]/).pop());
      });
      bugList.appendChild(el);
    }

    bugSummary.classList.remove('hidden');
    bugSummary.innerHTML =
      `<div class="counts">` +
      (errors ? `<span class="count-error">${errors} error${errors > 1 ? 's' : ''}</span>` : '') +
      (warnings ? `<span class="count-warning">${warnings} warning${warnings > 1 ? 's' : ''}</span>` : '') +
      (perfs ? `<span style="color:var(--green)">${perfs} performance</span>` : '') +
      (infos ? `<span class="count-info">${infos} info</span>` : '') +
      `</div>`;

    lastBugIssues = result.issues;

    const aiBtn = document.createElement('button');
    aiBtn.className = 'bug-ai-btn';
    aiBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg> Deep AI Analysis';
    aiBtn.addEventListener('click', runBugHunterAI);
    bugSummary.appendChild(aiBtn);

    termPrint(`Bug Hunter: ${result.issues.length} issues found.`, 'line-info');
    outputPrint(`Bug Hunter scan complete: ${result.issues.length} issues`, 'out-info');
  }

  // ── Simple Markdown Renderer ────────────────────────────────────────

  function renderMarkdown(text) {
    let html = escapeHtml(text);
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
    html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/^---+$/gm, '<hr>');
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/\n/g, '<br>');
    return html;
  }

  // ── AI Panel ──────────────────────────────────────────────────────────

  const aiTabDescriptions = {
    analyze: { title: 'AI Code Analyzer', desc: 'Ask about your code and get expert Django advice.' },
    architect: { title: 'AI Architect', desc: 'Describe a feature and get a full implementation plan.' },
    memory: { title: 'Django Memory', desc: 'Ask where code is, how components connect, dependencies.' },
  };

  function switchAiTab(tab) {
    currentAiTab = tab;
    $$('.ai-tab').forEach((t) => t.classList.toggle('active', t.dataset.aitab === tab));
    const info = aiTabDescriptions[tab];
    if (aiWelcomeTitle) aiWelcomeTitle.textContent = info.title;
    if (aiWelcomeDesc) aiWelcomeDesc.textContent = info.desc;
    const placeholders = {
      analyze: 'Ask about code quality, security, performance...',
      architect: 'Describe the feature you want to build...',
      memory: 'Where is JWT created? How do models connect?',
    };
    if (aiInput) aiInput.placeholder = placeholders[tab] || 'Ask AI...';
  }

  function addAiMessage(role, text) {
    if (!aiChat) return null;
    const welcome = aiChat.querySelector('.ai-welcome');
    if (welcome) welcome.remove();
    const msg = document.createElement('div');
    msg.className = `ai-msg ${role}`;
    if (role === 'assistant') msg.innerHTML = renderMarkdown(text);
    else msg.textContent = text;
    aiChat.appendChild(msg);
    aiChat.scrollTop = aiChat.scrollHeight;
    return msg;
  }

  function addAiLoading() { return addAiMessage('loading', 'Thinking...'); }
  function removeAiLoading(el) { if (el && el.parentNode) el.remove(); }

  async function readProjectFilesForAI(maxFiles) {
    if (!currentFolder) return [];
    const files = [];
    const MAX = maxFiles || 8;
    const extensions = ['py', 'html', 'json', 'yml', 'yaml', 'toml'];

    async function walk(dir, depth) {
      if (depth > 3 || files.length >= MAX) return;
      try {
        const items = await window.api.fs.readdir(dir);
        for (const item of items) {
          if (files.length >= MAX) break;
          if (IGNORE_DIRS.has(item.name)) continue;
          if (item.isDirectory) { await walk(item.path, depth + 1); }
          else {
            const ext = item.name.split('.').pop().toLowerCase();
            if (extensions.includes(ext)) {
              try {
                const content = await window.api.fs.readfile(item.path);
                if (content.length < 50000) files.push({ name: item.name, path: item.path, content });
              } catch {}
            }
          }
        }
      } catch {}
    }

    await walk(currentFolder, 0);
    return files;
  }

  async function sendAiMessage() {
    if (aiBusy) return;
    const text = aiInput.value.trim();
    if (!text) return;

    aiBusy = true;
    aiSendBtn.disabled = true;
    aiInput.value = '';

    addAiMessage('user', text);
    const loading = addAiLoading();

    try {
      let result;
      const files = await readProjectFilesForAI(6);

      if (currentAiTab === 'architect') {
        result = await window.api.ai.architect({ apiKey: groqApiKey, feature: text, scanData });
      } else if (currentAiTab === 'memory') {
        result = await window.api.ai.memory({ apiKey: groqApiKey, question: text, scanData });
      } else {
        result = await window.api.ai.analyze({ apiKey: groqApiKey, prompt: text, files, mode: 'general', scanData });
      }

      removeAiLoading(loading);
      addAiMessage('assistant', result);
    } catch (err) {
      removeAiLoading(loading);
      addAiMessage('error', 'Error: ' + err.message);
    }

    aiBusy = false;
    aiSendBtn.disabled = false;
    aiInput.focus();
  }

  $$('.ai-tab').forEach((tab) => {
    tab.addEventListener('click', () => switchAiTab(tab.dataset.aitab));
  });

  if (aiSendBtn) aiSendBtn.addEventListener('click', sendAiMessage);
  if (aiInput) {
    aiInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAiMessage(); }
    });
  }

  // ── Bug Hunter + AI ───────────────────────────────────────────────────

  async function runBugHunterAI() {
    if (!lastBugIssues.length) { termPrint('Run Bug Hunter scan first.', 'line-info'); return; }
    if (aiBusy) return;

    $$('.activity-icon[data-panel]').forEach((b) => b.classList.remove('active'));
    $$('.sidebar-panel').forEach((p) => p.classList.remove('active'));
    $('[data-panel="ai"]').classList.add('active');
    $('#panel-ai').classList.add('active');
    switchAiTab('analyze');

    aiBusy = true;
    aiSendBtn.disabled = true;
    addAiMessage('user', 'Analyze Bug Hunter results and provide deeper insights');
    const loading = addAiLoading();

    try {
      const files = await readProjectFilesForAI(4);
      const result = await window.api.ai.bughunt({ apiKey: groqApiKey, issues: lastBugIssues, files, scanData });
      removeAiLoading(loading);
      addAiMessage('assistant', result);
    } catch (err) {
      removeAiLoading(loading);
      addAiMessage('error', 'Error: ' + err.message);
    }

    aiBusy = false;
    aiSendBtn.disabled = false;
  }

  // ── Settings Modal ────────────────────────────────────────────────────

  function openSettings() {
    modalContainer.innerHTML = `
      <div class="modal-overlay" id="settings-overlay">
        <div class="modal">
          <div class="modal-header">
            <span>Settings</span>
            <button class="modal-close" id="settings-close">&times;</button>
          </div>
          <div class="modal-body">
            <div class="settings-section">
              <div class="settings-section-title">AI Configuration</div>
              <div class="settings-group">
                <label class="settings-label">GROQ API Key</label>
                <input type="password" class="settings-input" id="settings-apikey"
                       value="${escapeHtml(groqApiKey)}" placeholder="gsk_...">
                <div class="settings-hint">Get your key at console.groq.com. Leave empty for default.</div>
              </div>
              <div class="settings-group">
                <label class="settings-label">AI Model</label>
                <select class="settings-select" id="settings-model">
                  <option value="llama-3.3-70b-versatile">Llama 3.3 70B Versatile (Recommended)</option>
                  <option value="llama-3.1-8b-instant">Llama 3.1 8B Instant (Fast)</option>
                  <option value="mixtral-8x7b-32768">Mixtral 8x7B (32K context)</option>
                  <option value="gemma2-9b-it">Gemma 2 9B</option>
                </select>
              </div>
            </div>

            <div class="settings-section">
              <div class="settings-section-title">Terminal</div>
              <div class="settings-group">
                <label class="settings-label">Default Shell</label>
                <select class="settings-select" id="settings-shell">
                  <option value="cmd">Command Prompt (CMD)</option>
                  <option value="powershell">PowerShell</option>
                  <option value="bash">Git Bash</option>
                  <option value="wsl">WSL (Windows Subsystem for Linux)</option>
                </select>
              </div>
            </div>

            <div class="settings-section">
              <div class="settings-section-title">Editor</div>
              <div class="settings-group">
                <label class="settings-label">Color Theme</label>
                <div class="theme-preview-grid" id="theme-preview-grid">
                  <div class="theme-preview-item" data-theme="vs-dark" style="background:#1e1e1e;color:#ccc">Dark+</div>
                  <div class="theme-preview-item" data-theme="monokai" style="background:#272822;color:#F8F8F2">Monokai</div>
                  <div class="theme-preview-item" data-theme="solarized-dark" style="background:#002B36;color:#839496">Solarized</div>
                  <div class="theme-preview-item" data-theme="dracula" style="background:#282A36;color:#F8F8F2">Dracula</div>
                  <div class="theme-preview-item" data-theme="one-dark" style="background:#282C34;color:#ABB2BF">One Dark</div>
                  <div class="theme-preview-item" data-theme="github-dark" style="background:#0D1117;color:#C9D1D9">GitHub</div>
                  <div class="theme-preview-item" data-theme="vs" style="background:#F3F3F3;color:#333">Light+</div>
                </div>
              </div>
              <div class="settings-row">
                <div class="settings-group">
                  <label class="settings-label">Font Size</label>
                  <select class="settings-select" id="settings-fontsize">
                    <option value="12">12px</option>
                    <option value="13">13px</option>
                    <option value="14" selected>14px</option>
                    <option value="15">15px</option>
                    <option value="16">16px</option>
                    <option value="18">18px</option>
                    <option value="20">20px</option>
                  </select>
                </div>
                <div class="settings-group">
                  <label class="settings-label">Tab Size</label>
                  <select class="settings-select" id="settings-tabsize">
                    <option value="2">2 spaces</option>
                    <option value="4" selected>4 spaces</option>
                    <option value="8">8 spaces</option>
                  </select>
                </div>
              </div>
              <div class="settings-toggle-row">
                <div>
                  <div class="settings-toggle-label">Word Wrap</div>
                  <div class="settings-toggle-desc">Wrap long lines</div>
                </div>
                <input type="checkbox" id="settings-wordwrap" checked>
              </div>
              <div class="settings-toggle-row">
                <div>
                  <div class="settings-toggle-label">Minimap</div>
                  <div class="settings-toggle-desc">Show minimap in editor</div>
                </div>
                <input type="checkbox" id="settings-minimap" checked>
              </div>
              <div class="settings-group">
                <label class="settings-label">Auto-Save Interval</label>
                <select class="settings-select" id="settings-autosave">
                  <option value="0">Off</option>
                  <option value="1000">1 second</option>
                  <option value="2000">2 seconds</option>
                  <option value="5000">5 seconds</option>
                  <option value="10000">10 seconds</option>
                  <option value="30000">30 seconds</option>
                </select>
                <div class="settings-hint">Automatically save modified files.</div>
              </div>
            </div>

            <div class="settings-section">
              <div class="settings-section-title">Keyboard Shortcuts (click to edit, press key combo to set)</div>
              <div class="hotkey-grid" id="hotkey-grid"></div>
              <div style="margin-top:8px;">
                <button class="btn" id="hotkey-reset-all" style="font-size:11px;">Reset All to Defaults</button>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn" id="settings-cancel">Cancel</button>
            <button class="btn btn-primary" id="settings-save">Save</button>
          </div>
        </div>
      </div>`;

    const overlay = $('#settings-overlay');
    const savedModel = localStorage.getItem('groq_model') || 'llama-3.3-70b-versatile';
    const savedShell = localStorage.getItem('terminal_shell') || 'cmd';
    const savedFontSize = localStorage.getItem('editor_fontsize') || '14';
    const savedTabSize = localStorage.getItem('editor_tabsize') || '4';
    const savedWordWrap = localStorage.getItem('editor_wordwrap') !== 'false';
    const savedMinimap = localStorage.getItem('editor_minimap') !== 'false';
    const savedAutoSave = localStorage.getItem('editor_autosave_interval') || '0';

    const currentTheme = getMonacoThemeId();
    const themeItems = $$('#theme-preview-grid .theme-preview-item');
    themeItems.forEach((item) => {
      if (item.dataset.theme === currentTheme) item.classList.add('active');
      item.addEventListener('click', () => {
        themeItems.forEach((t) => t.classList.remove('active'));
        item.classList.add('active');
      });
    });

    $('#settings-model').value = savedModel;
    $('#settings-shell').value = savedShell;
    $('#settings-fontsize').value = savedFontSize;
    $('#settings-tabsize').value = savedTabSize;
    $('#settings-wordwrap').checked = savedWordWrap;
    $('#settings-minimap').checked = savedMinimap;
    $('#settings-autosave').value = savedAutoSave;

    const hotkeyGrid = $('#hotkey-grid');
    const currentHotkeys = getHotkeys();
    const hotkeyEntries = Object.entries(HOTKEY_LABELS);

    for (const [actionId, label] of hotkeyEntries) {
      const row = document.createElement('div');
      row.className = 'hotkey-row';
      const combo = currentHotkeys[actionId] || DEFAULT_HOTKEYS[actionId] || '';
      row.innerHTML =
        `<span class="hotkey-label">${escapeHtml(label)}</span>` +
        `<input type="text" class="hotkey-input" data-action="${actionId}" value="${escapeHtml(combo)}" readonly title="Click then press a key combination">` +
        `<button class="hotkey-reset" data-action="${actionId}" title="Reset to default">Reset</button>`;
      hotkeyGrid.appendChild(row);
    }

    hotkeyGrid.addEventListener('click', (e) => {
      const input = e.target.closest('.hotkey-input');
      if (input) {
        const actionId = input.dataset.action;
        input.classList.add('recording');
        input.value = 'Press keys...';
        input.focus();

        const handler = (ke) => {
          ke.preventDefault();
          ke.stopPropagation();
          if (ke.key === 'Escape') {
            input.value = currentHotkeys[actionId] || DEFAULT_HOTKEYS[actionId] || '';
            input.classList.remove('recording');
            document.removeEventListener('keydown', handler, true);
            return;
          }
          const parts = [];
          if (ke.ctrlKey || ke.metaKey) parts.push('Ctrl');
          if (ke.shiftKey) parts.push('Shift');
          if (ke.altKey) parts.push('Alt');
          const key = ke.key;
          if (!['Control', 'Shift', 'Alt', 'Meta'].includes(key)) {
            parts.push(key.length === 1 ? key.toUpperCase() : key);
          }
          input.value = parts.join('+');
          input.classList.remove('recording');
          document.removeEventListener('keydown', handler, true);
        };
        document.addEventListener('keydown', handler, true);
        return;
      }

      const resetBtn = e.target.closest('.hotkey-reset');
      if (resetBtn) {
        const action = resetBtn.dataset.action;
        const inp = hotkeyGrid.querySelector(`.hotkey-input[data-action="${action}"]`);
        if (inp) inp.value = DEFAULT_HOTKEYS[action] || '';
      }
    });

    $('#hotkey-reset-all')?.addEventListener('click', () => {
      hotkeyGrid.querySelectorAll('.hotkey-input').forEach((inp) => {
        inp.value = DEFAULT_HOTKEYS[inp.dataset.action] || '';
      });
    });

    const closeModal = () => overlay.remove();
    $('#settings-close').addEventListener('click', closeModal);
    $('#settings-cancel').addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

    $('#settings-save').addEventListener('click', () => {
      groqApiKey = $('#settings-apikey').value.trim();
      localStorage.setItem('groq_api_key', groqApiKey);
      localStorage.setItem('groq_model', $('#settings-model').value);

      shellType = $('#settings-shell').value;
      localStorage.setItem('terminal_shell', shellType);
      updateShellPrompt();

      const fontSize = parseInt($('#settings-fontsize').value);
      const tabSize = parseInt($('#settings-tabsize').value);
      const wordWrap = $('#settings-wordwrap').checked;
      const minimap = $('#settings-minimap').checked;
      localStorage.setItem('editor_fontsize', fontSize);
      localStorage.setItem('editor_tabsize', tabSize);
      localStorage.setItem('editor_wordwrap', wordWrap);
      localStorage.setItem('editor_minimap', minimap);

      const themeId = document.querySelector('.theme-preview-item.active')?.dataset.theme || getMonacoThemeId();
      localStorage.setItem('editor_theme', themeId);
      applyMonacoTheme(themeId);

      if (editorMode === 'monaco' && window._monacoEditor) {
        window._monacoEditor.updateOptions({ fontSize, tabSize, wordWrap: wordWrap ? 'on' : 'off', minimap: { enabled: minimap } });
      }

      const customHotkeys = {};
      hotkeyGrid.querySelectorAll('.hotkey-input').forEach((inp) => {
        const defaultVal = DEFAULT_HOTKEYS[inp.dataset.action] || '';
        if (inp.value && inp.value !== 'Press keys...' && inp.value !== defaultVal) {
          customHotkeys[inp.dataset.action] = inp.value;
        }
      });
      localStorage.setItem('custom_hotkeys', JSON.stringify(customHotkeys));

      const autoSaveInterval = parseInt($('#settings-autosave').value);
      localStorage.setItem('editor_autosave_interval', autoSaveInterval);
      if (autoSaveInterval > 0) startAutoSave(); else stopAutoSave();

      closeModal();
      outputPrint('Settings saved.', 'out-success');
      termPrint('Settings saved.', 'line-info');
    });
  }

  // ── Docker Panel ──────────────────────────────────────────────────────

  const dockerContainers = $('#docker-containers');
  const dockerImages = $('#docker-images');

  async function refreshDocker() {
    if (!dockerContainers || !dockerImages) return;
    dockerContainers.innerHTML = '<div class="docker-empty">Loading...</div>';
    dockerImages.innerHTML = '<div class="docker-empty">Loading...</div>';

    const [containersResult, imagesResult] = await Promise.all([
      window.api.docker.containers(),
      window.api.docker.images(),
    ]);

    if (containersResult.error) {
      dockerContainers.innerHTML = '<div class="docker-empty">' + escapeHtml(containersResult.error) + '</div>';
    } else if (containersResult.containers.length === 0) {
      dockerContainers.innerHTML = '<div class="docker-empty">No containers found.</div>';
    } else {
      dockerContainers.innerHTML = '';
      for (const c of containersResult.containers) {
        const isRunning = c.status && c.status.toLowerCase().startsWith('up');
        const el = document.createElement('div');
        el.className = 'docker-item';
        el.innerHTML =
          '<div class="docker-item-status ' + (isRunning ? 'running' : 'stopped') + '"></div>' +
          '<div class="docker-item-info">' +
            '<div class="docker-item-name">' + escapeHtml(c.name || c.id) + '</div>' +
            '<div class="docker-item-detail">' + escapeHtml(c.image) + ' | ' + escapeHtml(c.status || 'Exited') + '</div>' +
            (c.ports ? '<div class="docker-item-detail">' + escapeHtml(c.ports) + '</div>' : '') +
          '</div>' +
          '<div class="docker-item-actions">' +
            (isRunning
              ? '<button title="Stop" data-action="stop" data-id="' + c.id + '">&#9632;</button>'
              : '<button title="Start" data-action="start" data-id="' + c.id + '">&#9654;</button>') +
            '<button title="Logs" data-action="logs" data-id="' + c.id + '">&#9781;</button>' +
            '<button title="Remove" class="docker-btn-remove" data-action="remove" data-id="' + c.id + '">&#10005;</button>' +
          '</div>';
        el.querySelectorAll('button').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const action = btn.dataset.action;
            const id = btn.dataset.id;
            if (action === 'start') { await window.api.docker.start(id); termPrint('Starting container ' + id, 'line-info'); }
            else if (action === 'stop') { await window.api.docker.stop(id); termPrint('Stopping container ' + id, 'line-info'); }
            else if (action === 'remove') {
              if (confirm('Remove container ' + id + '?')) { await window.api.docker.remove(id); termPrint('Removed container ' + id, 'line-info'); }
            }
            else if (action === 'logs') {
              const logsResult = await window.api.docker.logs(id);
              termPrint('--- Container logs: ' + id + ' ---', 'line-info');
              termPrint(logsResult.logs || 'No logs', 'line-stdout');
              outputPrint('Docker logs: ' + id, 'out-info');
            }
            setTimeout(refreshDocker, 500);
          });
        });
        dockerContainers.appendChild(el);
      }
    }

    if (imagesResult.error) {
      dockerImages.innerHTML = '<div class="docker-empty">' + escapeHtml(imagesResult.error) + '</div>';
    } else if (imagesResult.images.length === 0) {
      dockerImages.innerHTML = '<div class="docker-empty">No images found.</div>';
    } else {
      dockerImages.innerHTML = '';
      for (const img of imagesResult.images) {
        const el = document.createElement('div');
        el.className = 'docker-item';
        el.innerHTML =
          '<div class="docker-item-info">' +
            '<div class="docker-item-name">' + escapeHtml(img.repo) + ':' + escapeHtml(img.tag) + '</div>' +
            '<div class="docker-item-detail">' + escapeHtml(img.id) + ' | ' + escapeHtml(img.size) + '</div>' +
          '</div>';
        dockerImages.appendChild(el);
      }
    }
  }

  $('#btn-docker-refresh')?.addEventListener('click', refreshDocker);

  $('#btn-docker-run')?.addEventListener('click', async () => {
    const image = prompt('Image name (e.g. nginx:latest):');
    if (!image) return;
    const name = prompt('Container name (optional):', '');
    const ports = prompt('Port mapping (optional, e.g. 8080:80):', '');
    const result = await window.api.docker.run({ image, name, ports });
    if (result.success) {
      termPrint('Container started: ' + result.output.trim(), 'line-success');
      outputPrint('Docker run: ' + image, 'out-success');
    } else {
      termPrint('Error: ' + (result.error || result.output), 'line-stderr');
    }
    setTimeout(refreshDocker, 1000);
  });

  $('#btn-docker-build')?.addEventListener('click', async () => {
    if (!currentFolder) { termPrint('Open a folder first.', 'line-info'); return; }
    const tagName = prompt('Image tag (e.g. myapp:v1):', 'myapp:latest');
    if (!tagName) return;
    termPrint('Building Docker image: ' + tagName + '...', 'line-info');
    outputPrint('Docker build: ' + tagName, 'out-info');
    const result = await window.api.docker.build({ context: currentFolder, tagName });
    if (result.success) {
      termPrint('Build successful!', 'line-success');
      outputPrint('Docker build completed', 'out-success');
    } else {
      termPrint('Build failed (code ' + result.code + ')', 'line-stderr');
    }
    setTimeout(refreshDocker, 1000);
  });

  // ── API Client Panel ──────────────────────────────────────────────────

  const apiMethod = $('#api-method');
  const apiUrl = $('#api-url');
  const apiBody = $('#api-body');
  const apiSendBtn = $('#api-send-btn');
  const apiHeadersList = $('#api-headers-list');
  const apiResponseBody = $('#api-response-body');
  const apiResponseHeaders = $('#api-response-headers');
  const apiResponseRaw = $('#api-response-raw');
  const apiResponseMeta = $('#api-response-meta');
  let lastApiResponse = null;

  const METHOD_COLORS = { GET: 'var(--green)', POST: 'var(--yellow)', PUT: 'var(--blue)', PATCH: 'var(--purple)', DELETE: 'var(--red)', HEAD: 'var(--text-dim)', OPTIONS: 'var(--text-dim)' };

  function updateMethodColor() {
    if (apiMethod) apiMethod.style.color = METHOD_COLORS[apiMethod.value] || 'var(--green)';
  }
  updateMethodColor();
  apiMethod?.addEventListener('change', updateMethodColor);

  $$('.api-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('.api-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      $$('.api-tab-content').forEach((c) => c.classList.remove('active'));
      const panel = $('#api-tab-' + tab.dataset.apitab);
      if (panel) panel.classList.add('active');
    });
  });

  $$('.api-resp-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('.api-resp-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      if (apiResponseBody) apiResponseBody.classList.add('hidden');
      if (apiResponseHeaders) apiResponseHeaders.classList.add('hidden');
      if (apiResponseRaw) apiResponseRaw.classList.add('hidden');
      if (tab.dataset.resptab === 'body' && apiResponseBody) apiResponseBody.classList.remove('hidden');
      else if (tab.dataset.resptab === 'headers' && apiResponseHeaders) apiResponseHeaders.classList.remove('hidden');
      else if (tab.dataset.resptab === 'raw' && apiResponseRaw) apiResponseRaw.classList.remove('hidden');
    });
  });

  $('#api-add-header')?.addEventListener('click', () => {
    const row = document.createElement('div');
    row.className = 'api-kv-row';
    row.innerHTML =
      '<input type="text" class="api-kv-key" placeholder="Key">' +
      '<input type="text" class="api-kv-value" placeholder="Value">' +
      '<button class="api-kv-remove">&times;</button>';
    row.querySelector('.api-kv-remove').addEventListener('click', () => row.remove());
    apiHeadersList.appendChild(row);
  });

  apiHeadersList?.querySelectorAll('.api-kv-remove').forEach((btn) => {
    btn.addEventListener('click', () => btn.closest('.api-kv-row').remove());
  });

  async function sendApiRequest() {
    if (!apiUrl.value.trim()) { apiUrl.focus(); return; }
    apiSendBtn.disabled = true;
    apiSendBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>';
    apiResponseBody.innerHTML = '<div class="api-empty-response">Sending request...</div>';
    apiResponseHeaders.innerHTML = '';
    apiResponseRaw.innerHTML = '';
    apiResponseMeta.textContent = '';

    const headers = [];
    apiHeadersList.querySelectorAll('.api-kv-row').forEach((row) => {
      const key = row.querySelector('.api-kv-key')?.value.trim();
      const value = row.querySelector('.api-kv-value')?.value.trim();
      if (key) headers.push({ key, value });
    });

    let body = apiBody?.value.trim() || '';
    if (body && apiMethod.value !== 'GET' && apiMethod.value !== 'HEAD') {
      try { body = JSON.parse(body); } catch {}
    } else {
      body = undefined;
    }

    const startTime = Date.now();
    try {
      const result = await window.api.http.request({
        method: apiMethod.value,
        url: apiUrl.value.trim(),
        headers,
        body,
      });
      lastApiResponse = result;
      const elapsed = Date.now() - startTime;

      if (result.error) {
        apiResponseBody.innerHTML = '<div class="api-empty-response" style="color:var(--red)">' +
          '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--red)" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>' +
          '<div>' + escapeHtml(result.error) + '</div></div>';
        apiResponseMeta.innerHTML = '';
        return;
      }

      let statusClass = 'status-ok';
      if (result.status >= 400) statusClass = 'status-err';
      else if (result.status >= 300) statusClass = 'status-warn';
      apiResponseMeta.innerHTML =
        '<span class="' + statusClass + '">' + result.status + ' ' + result.statusText + '</span> ' +
        elapsed + 'ms ' + formatBytes(result.size);

      let displayBody = result.body;
      try {
        const parsed = JSON.parse(result.body);
        displayBody = JSON.stringify(parsed, null, 2);
      } catch {}
      apiResponseBody.textContent = displayBody;

      let headersText = '';
      if (result.headers) {
        for (const [k, v] of Object.entries(result.headers)) {
          headersText += k + ': ' + v + '\n';
        }
      }
      apiResponseHeaders.textContent = headersText || 'No response headers available.';
      apiResponseRaw.textContent = result.body || '';

      outputPrint('API ' + apiMethod.value + ' ' + apiUrl.value + ' => ' + result.status, result.status >= 200 && result.status < 400 ? 'out-success' : 'out-error');
    } catch (err) {
      apiResponseBody.innerHTML = '<div class="api-empty-response" style="color:var(--red)">' +
        '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--red)" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>' +
        '<div>' + escapeHtml(err.message) + '</div></div>';
    }

    apiSendBtn.disabled = false;
    apiSendBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  apiSendBtn?.addEventListener('click', sendApiRequest);
  apiUrl?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.ctrlKey) sendApiRequest(); });

  // ── Deploy Panel ──────────────────────────────────────────────────────

  const deployChecks = $('#deploy-checks');
  const deploySummary = $('#deploy-summary');

  async function runDeployCheck() {
    if (!currentFolder) { termPrint('Open a folder first.', 'line-info'); return; }
    deployChecks.innerHTML = '<div class="deploy-empty">Running deployment checks...</div>';

    try {
      const checks = await window.api.deploy.check({ cwd: currentFolder });
      deployChecks.innerHTML = '';

      if (checks.length === 0) {
        deployChecks.innerHTML = '<div class="deploy-empty">No checks available.</div>';
        return;
      }

      const passed = checks.filter((c) => c.passed === true).length;
      const failed = checks.filter((c) => c.passed === false).length;
      const skipped = checks.filter((c) => c.passed === null).length;

      for (const check of checks) {
        const el = document.createElement('div');
        el.className = 'deploy-item';
        const iconChar = check.passed === true ? '\u2714' : check.passed === false ? '\u2716' : '\u2139';
        const iconCls = check.passed === true ? 'pass' : check.passed === false ? 'fail' : 'skip';
        el.innerHTML =
          '<div class="deploy-icon ' + iconCls + '">' + iconChar + '</div>' +
          '<div class="deploy-info">' +
            '<div class="deploy-name">' + escapeHtml(check.name) + '</div>' +
            '<div class="deploy-detail">' + escapeHtml(check.detail) + '</div>' +
          '</div>';
        deployChecks.appendChild(el);
      }

      deploySummary.classList.remove('hidden');
      deploySummary.innerHTML =
        '<div class="counts">' +
          '<span style="color:var(--green)">' + passed + ' passed</span>' +
          (failed > 0 ? '<span style="color:var(--red)">' + failed + ' failed</span>' : '') +
          (skipped > 0 ? '<span style="color:var(--text-dim)">' + skipped + ' skipped</span>' : '') +
        '</div>';

      outputPrint('Deploy check: ' + passed + ' passed, ' + failed + ' failed, ' + skipped + ' skipped', failed > 0 ? 'out-error' : 'out-success');
      termPrint('Deploy check complete: ' + passed + '/' + checks.length + ' passed', failed > 0 ? 'line-stderr' : 'line-success');
      const statusDeploy = $('#status-deploy');
      if (statusDeploy) {
        statusDeploy.textContent = failed > 0 ? failed + ' issues' : 'Ready';
        statusDeploy.style.color = failed > 0 ? 'var(--red)' : 'var(--green)';
      }
    } catch (err) {
      deployChecks.innerHTML = '<div class="deploy-empty">Error: ' + escapeHtml(err.message) + '</div>';
    }
  }

  $('#btn-deploy-check')?.addEventListener('click', runDeployCheck);

  // ── Button Bindings ────────────────────────────────────────────────────

  $('#btn-open-folder')?.addEventListener('click', openFolder);
  $('#btn-create-project')?.addEventListener('click', createProject);
  $('#btn-scan')?.addEventListener('click', runBugHunter);
  $('#btn-settings')?.addEventListener('click', openSettings);
  $('#btn-aitests-generate')?.addEventListener('click', runAITests);
  $('#btn-aitests-save')?.addEventListener('click', saveAITestsToFile);

  if ($('#btn-new-file')) {
    $('#btn-new-file').addEventListener('click', async () => {
      if (!currentFolder) { termPrint('Open a folder first.', 'line-info'); return; }
      const name = prompt('File name:', 'untitled.py');
      if (!name) return;
      await window.api.fs.mkfile(currentFolder + '/' + name);
      await refreshFileTree();
      outputPrint('Created file: ' + name, 'out-success');
    });
  }

  // ── Lint Current File ──────────────────────────────────────────────────

  async function lintCurrentFile() {
    if (!currentFolder) { termPrint('Open a folder first.', 'line-info'); return; }
    if (aiBusy) return;
    const tab = openTabs.find((t) => t.id === activeTabId);
    if (!tab) { termPrint('No file open.', 'line-info'); return; }

    const content = getEditorValue();
    if (!content.trim()) { termPrint('File is empty.', 'line-info'); return; }

    aiBusy = true;
    aiSendBtn.disabled = true;
    addAiMessage('user', 'Analyze this file for issues: ' + tab.name);
    const loading = addAiLoading();

    try {
      const files = [{ name: tab.name, path: tab.path, content }];
      const result = await window.api.ai.analyze({
        apiKey: groqApiKey,
        prompt: 'Analyze ' + tab.name + ' for bugs, security issues, and code quality problems. List each issue with severity, file, and line number if possible.',
        files,
        mode: 'general',
        scanData,
      });
      removeAiLoading(loading);
      addAiMessage('assistant', result);
    } catch (err) {
      removeAiLoading(loading);
      addAiMessage('error', 'Error: ' + err.message);
    }

    aiBusy = false;
    aiSendBtn.disabled = false;
  }

  // ── Custom Hotkeys ─────────────────────────────────────────────────────

  const DEFAULT_HOTKEYS = {
    'openFolder': 'Ctrl+O',
    'saveFile': 'Ctrl+S',
    'closeTab': 'Ctrl+W',
    'focusTerminal': 'Ctrl+`',
    'explorer': 'Ctrl+Shift+E',
    'search': 'Ctrl+Shift+F',
    'aiAssistant': 'Ctrl+Shift+A',
    'settings': 'Ctrl+,',
    'lintFile': 'Ctrl+Shift+L',
    'quickOpen': 'Ctrl+P',
    'goToLine': 'Ctrl+G',
    'executeLine': 'Ctrl+Enter',
    'toggleComment': 'Ctrl+/',
    'duplicateLine': 'Ctrl+D',
    'deleteLine': 'Ctrl+Shift+K',
    'moveLineUp': 'Alt+Up',
    'moveLineDown': 'Alt+Down',
    'find': 'Ctrl+F',
    'replace': 'Ctrl+H',
  };

  const HOTKEY_LABELS = {
    'openFolder': 'Open Folder',
    'saveFile': 'Save File',
    'closeTab': 'Close Tab',
    'focusTerminal': 'Focus Terminal',
    'explorer': 'Explorer',
    'search': 'Search',
    'aiAssistant': 'AI Assistant',
    'settings': 'Settings',
    'lintFile': 'Lint with AI',
    'quickOpen': 'Quick Open',
    'goToLine': 'Go to Line',
    'executeLine': 'Execute Line in Terminal',
    'toggleComment': 'Toggle Comment',
    'duplicateLine': 'Duplicate Line',
    'deleteLine': 'Delete Line',
    'moveLineUp': 'Move Line Up',
    'moveLineDown': 'Move Line Down',
    'find': 'Find',
    'replace': 'Replace',
  };

  function getHotkeys() {
    try {
      const saved = JSON.parse(localStorage.getItem('custom_hotkeys') || '{}');
      return { ...DEFAULT_HOTKEYS, ...saved };
    } catch {
      return { ...DEFAULT_HOTKEYS };
    }
  }

  function parseHotkeyCombo(combo) {
    const parts = combo.split('+').map((s) => s.trim().toLowerCase());
    return {
      ctrl: parts.includes('ctrl') || parts.includes('ctrlcmd'),
      shift: parts.includes('shift'),
      alt: parts.includes('alt'),
      meta: parts.includes('meta') || parts.includes('cmd'),
      key: parts.find((p) => !['ctrl', 'ctrlcmd', 'shift', 'alt', 'meta', 'cmd'].includes(p)) || '',
    };
  }

  function matchHotkey(e, combo) {
    const hk = parseHotkeyCombo(combo);
    const ctrlMatch = hk.ctrl ? (e.ctrlKey || e.metaKey) : !(e.ctrlKey || e.metaKey);
    const shiftMatch = hk.shift ? e.shiftKey : !e.shiftKey;
    const altMatch = hk.alt ? e.altKey : !e.altKey;
    const keyMatch = e.key.toLowerCase() === hk.key || e.code.toLowerCase() === 'key' + hk.key;
    return ctrlMatch && shiftMatch && altMatch && keyMatch;
  }

  // ── Quick Open ────────────────────────────────────────────────────────

  const quickOpenHtml = `
    <div class="modal-overlay" id="quickopen-overlay">
      <div class="quickopen-box">
        <input type="text" class="quickopen-input" id="quickopen-input" placeholder="Type to search files..." spellcheck="false" autofocus>
        <div class="quickopen-results" id="quickopen-results"></div>
      </div>
    </div>
  `;

  async function showQuickOpen() {
    if (!currentFolder) { termPrint('Open a folder first.', 'line-info'); return; }

    const existing = $('#quickopen-overlay');
    if (existing) existing.remove();

    document.body.insertAdjacentHTML('beforeend', quickOpenHtml);
    const overlay = $('#quickopen-overlay');
    const input = $('#quickopen-input');
    const results = $('#quickopen-results');

    const allFiles = [];
    async function collectFiles(dir, depth) {
      if (depth > 6 || allFiles.length > 500) return;
      try {
        const items = await window.api.fs.readdir(dir);
        for (const item of items) {
          if (allFiles.length >= 500) break;
          if (IGNORE_DIRS.has(item.name)) continue;
          if (item.isDirectory) { await collectFiles(item.path, depth + 1); }
          else {
            const rel = item.path.replace(currentFolder, '').replace(/^[/\\]/, '');
            allFiles.push({ name: item.name, path: item.path, rel });
          }
        }
      } catch {}
    }
    await collectFiles(currentFolder, 0);

    function filterFiles(query) {
      if (!query) return allFiles.slice(0, 20);
      const lower = query.toLowerCase();
      const scored = [];
      for (const f of allFiles) {
        const nameLower = f.name.toLowerCase();
        const relLower = f.rel.toLowerCase();
        let score = 0;
        if (nameLower === lower) score = 100;
        else if (nameLower.startsWith(lower)) score = 80;
        else if (nameLower.includes(lower)) score = 60;
        else if (relLower.includes(lower)) score = 40;
        if (score > 0) scored.push({ ...f, score });
      }
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, 20);
    }

    function renderResults(files) {
      results.innerHTML = '';
      if (files.length === 0) {
        results.innerHTML = '<div class="quickopen-empty">No matching files</div>';
        return;
      }
      for (const f of files) {
        const el = document.createElement('div');
        el.className = 'quickopen-item';
        const icon = getFileIcon(f.name, false);
        el.innerHTML = `<span class="icon">${icon.icon}</span><span class="name">${escapeHtml(f.name)}</span><span class="path">${escapeHtml(f.rel)}</span>`;
        el.addEventListener('click', () => {
          openFile(f.path, f.name);
          overlay.remove();
        });
        results.appendChild(el);
      }
      if (results.children.length > 0) results.children[0].classList.add('selected');
    }

    renderResults(allFiles.slice(0, 20));

    let selectedIdx = 0;
    input.addEventListener('input', () => {
      const query = input.value.trim();
      const filtered = filterFiles(query);
      renderResults(filtered);
      selectedIdx = 0;
    });

    input.addEventListener('keydown', (e) => {
      const items = results.querySelectorAll('.quickopen-item');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        items[selectedIdx]?.classList.remove('selected');
        selectedIdx = Math.min(selectedIdx + 1, items.length - 1);
        items[selectedIdx]?.classList.add('selected');
        items[selectedIdx]?.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        items[selectedIdx]?.classList.remove('selected');
        selectedIdx = Math.max(selectedIdx - 1, 0);
        items[selectedIdx]?.classList.add('selected');
        items[selectedIdx]?.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        items[selectedIdx]?.click();
      } else if (e.key === 'Escape') {
        overlay.remove();
      }
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    setTimeout(() => input.focus(), 50);
  }

  // ── Go to Line ────────────────────────────────────────────────────────

  function showGoToLine() {
    if (editorMode !== 'monaco' || !window._monacoEditor) return;

    const existing = $('#quickopen-overlay');
    if (existing) existing.remove();

    document.body.insertAdjacentHTML('beforeend', `
      <div class="modal-overlay" id="quickopen-overlay">
        <div class="quickopen-box" style="max-width:300px;">
          <input type="number" class="quickopen-input" id="quickopen-input" placeholder="Go to line..." min="1" autofocus>
        </div>
      </div>
    `);
    const overlay = $('#quickopen-overlay');
    const input = $('#quickopen-input');
    const editor = window._monacoEditor;
    const maxLine = editor.getModel().getLineCount();
    input.max = maxLine;

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const line = parseInt(input.value);
        if (line >= 1 && line <= maxLine) {
          editor.revealLineInCenter(line);
          editor.setPosition({ lineNumber: line, column: 1 });
          editor.focus();
        }
        overlay.remove();
      } else if (e.key === 'Escape') {
        overlay.remove();
      }
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    setTimeout(() => input.focus(), 50);
  }

  // ── Keyboard Shortcuts ─────────────────────────────────────────────────

  document.addEventListener('keydown', (e) => {
    try {
      const hotkeys = getHotkeys();

      if (e.key === 'Escape') {
        const cmdPalette = $('#cmdpalette-overlay');
        if (cmdPalette && !cmdPalette.classList.contains('hidden')) { cmdPalette.classList.add('hidden'); return; }
        const overlay = $('#quickopen-overlay');
        if (overlay) { overlay.remove(); return; }
        const settingsOverlay = $('#settings-overlay');
        if (settingsOverlay) { settingsOverlay.remove(); return; }
        hideContextMenu();
        if (editorMode === 'monaco' && window._monacoEditor) window._monacoEditor.focus();
        else if (window._fallbackEditor) window._fallbackEditor.focus();
        return;
      }

      const activeEl = document.activeElement;
      const inInput = activeEl && (
        activeEl.tagName === 'INPUT' ||
        activeEl.tagName === 'TEXTAREA' ||
        activeEl.isContentEditable
      ) && !activeEl.closest('.monaco-editor') && !activeEl.closest('.xterm-helper-textarea');
      if (inInput) return;

      const inXterm = activeEl && activeEl.closest && activeEl.closest('.xterm-helper-textarea');

      if (matchHotkey(e, hotkeys.openFolder)) { e.preventDefault(); e.stopPropagation(); openFolder(); return; }
      if (matchHotkey(e, hotkeys.saveFile)) { e.preventDefault(); e.stopPropagation(); saveCurrentFile(); return; }
      if (matchHotkey(e, hotkeys.closeTab)) { e.preventDefault(); e.stopPropagation(); if (activeTabId) closeTab(activeTabId); return; }
      if (matchHotkey(e, hotkeys.focusTerminal)) {
        e.preventDefault();
        e.stopPropagation();
        if (inXterm) {
          if (editorMode === 'monaco' && window._monacoEditor) window._monacoEditor.focus();
          else if (welcomeMsg) welcomeMsg.style.display = '';
        } else {
          ensureTerminal().then(() => { const t = getActiveTerm(); if (t) t.focus(); });
        }
        return;
      }
      if (matchHotkey(e, hotkeys.explorer)) {
        e.preventDefault();
        e.stopPropagation();
        $$('.activity-icon[data-panel]').forEach((b) => b.classList.remove('active'));
        $$('.sidebar-panel').forEach((p) => p.classList.remove('active'));
        $('[data-panel="explorer"]').classList.add('active');
        $('#panel-explorer').classList.add('active');
        return;
      }
      if (matchHotkey(e, hotkeys.search)) {
        e.preventDefault();
        e.stopPropagation();
        $$('.activity-icon[data-panel]').forEach((b) => b.classList.remove('active'));
        $$('.sidebar-panel').forEach((p) => p.classList.remove('active'));
        $('[data-panel="search"]').classList.add('active');
        $('#panel-search').classList.add('active');
        setTimeout(() => $('#search-input')?.focus(), 50);
        return;
      }
      if (matchHotkey(e, hotkeys.aiAssistant)) {
        e.preventDefault();
        e.stopPropagation();
        $$('.activity-icon[data-panel]').forEach((b) => b.classList.remove('active'));
        $$('.sidebar-panel').forEach((p) => p.classList.remove('active'));
        $('[data-panel="ai"]').classList.add('active');
        $('#panel-ai').classList.add('active');
        if (aiInput) aiInput.focus();
        return;
      }
      if (matchHotkey(e, hotkeys.settings)) { e.preventDefault(); e.stopPropagation(); openSettings(); return; }
      if (matchHotkey(e, hotkeys.lintFile)) { e.preventDefault(); e.stopPropagation(); lintCurrentFile(); return; }
      if (matchHotkey(e, hotkeys.quickOpen)) { e.preventDefault(); e.stopPropagation(); showQuickOpen(); return; }
      if (matchHotkey(e, hotkeys.goToLine)) { e.preventDefault(); e.stopPropagation(); showGoToLine(); return; }
      if (e.ctrlKey && e.shiftKey && e.key === 'P') { e.preventDefault(); e.stopPropagation(); showCommandPalette(); return; }
      if (e.ctrlKey && e.key === 'l') { e.preventDefault(); e.stopPropagation(); const t = getActiveTerm(); if (t) t.clear(); return; }
      if (matchHotkey(e, hotkeys.executeLine)) {
        e.preventDefault();
        e.stopPropagation();
        if (editorMode === 'monaco' && window._monacoEditor) {
          const editor = window._monacoEditor;
          const selection = editor.getSelection();
          let lineText;
          if (!selection.isEmpty()) {
            lineText = editor.getModel().getValueInRange(selection);
          } else {
            const pos = editor.getPosition();
            lineText = editor.getModel().getLineContent(pos.lineNumber);
          }
          if (lineText && lineText.trim()) executeCommand(lineText.trim());
        }
        return;
      }
      if (e.key === 'F2' && activeTabId) {
        e.stopPropagation();
        const tab = openTabs.find((t) => t.id === activeTabId);
        if (tab) {
          const newName = prompt('Rename file:', tab.name);
          if (newName && newName !== tab.name) {
            const dir = tab.path.replace(/[/\\][^/\\]+$/, '');
            window.api.fs.rename({ oldPath: tab.path, newPath: dir + '/' + newName }).then(() => {
              tab.path = dir + '/' + newName;
              tab.name = newName;
              renderTabs();
              refreshFileTree();
            });
          }
        }
      }
    } catch (err) {
      console.error('Hotkey handler error:', err);
    }
  }, true);

  // ── Command Palette ──────────────────────────────────────────────────

  function buildCommandList() {
    return [
      { label: 'File: Open Folder', action: openFolder, category: 'File' },
      { label: 'File: Save', action: saveCurrentFile, category: 'File' },
      { label: 'File: New File', action: () => $('#btn-new-file')?.click(), category: 'File' },
      { label: 'File: Close Tab', action: () => { if (activeTabId) closeTab(activeTabId); }, category: 'File' },
      { label: 'File: Rename', action: () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2' })); }, category: 'File' },
      { label: 'View: Toggle Terminal', action: () => ensureTerminal().then(() => { const t = getActiveTerm(); if (t) t.focus(); }), category: 'View' },
      { label: 'View: Toggle Explorer', action: () => { $$('.activity-icon[data-panel]').forEach((b) => b.classList.remove('active')); $$('.sidebar-panel').forEach((p) => p.classList.remove('active')); $('[data-panel="explorer"]').classList.add('active'); $('#panel-explorer').classList.add('active'); }, category: 'View' },
      { label: 'View: Toggle Search', action: () => { $$('.activity-icon[data-panel]').forEach((b) => b.classList.remove('active')); $$('.sidebar-panel').forEach((p) => p.classList.remove('active')); $('[data-panel="search"]').classList.add('active'); $('#panel-search').classList.add('active'); setTimeout(() => $('#search-input')?.focus(), 50); }, category: 'View' },
      { label: 'View: Toggle AI Assistant', action: () => { $$('.activity-icon[data-panel]').forEach((b) => b.classList.remove('active')); $$('.sidebar-panel').forEach((p) => p.classList.remove('active')); $('[data-panel="ai"]').classList.add('active'); $('#panel-ai').classList.add('active'); if (aiInput) aiInput.focus(); }, category: 'View' },
      { label: 'View: Toggle Docker', action: () => { $$('.activity-icon[data-panel]').forEach((b) => b.classList.remove('active')); $$('.sidebar-panel').forEach((p) => p.classList.remove('active')); $('[data-panel="docker"]').classList.add('active'); $('#panel-docker').classList.add('active'); }, category: 'View' },
      { label: 'View: Toggle API Client', action: () => { $$('.activity-icon[data-panel]').forEach((b) => b.classList.remove('active')); $$('.sidebar-panel').forEach((p) => p.classList.remove('active')); $('[data-panel="apiclient"]').classList.add('active'); $('#panel-apiclient').classList.add('active'); }, category: 'View' },
      { label: 'View: Zen Mode', action: toggleZenMode, category: 'View' },
      { label: 'View: Quick Open (Ctrl+P)', action: showQuickOpen, category: 'View' },
      { label: 'View: Go to Line (Ctrl+G)', action: showGoToLine, category: 'View' },
      { label: 'Django: New Project', action: createProject, category: 'Django' },
      { label: 'Django: Run Server', action: () => runDjangoCmd('runserver'), category: 'Django' },
      { label: 'Django: Stop Server', action: () => { const t = getActiveTerm(); if (t && t._processActive) { termSocketSend('input', t._termId, '\x03'); showToast('Sent Ctrl+C.', 'success'); } }, category: 'Django' },
      { label: 'Django: Migrate', action: () => runDjangoCmd('migrate'), category: 'Django' },
      { label: 'Django: Makemigrations', action: () => runDjangoCmd('makemigrations'), category: 'Django' },
      { label: 'Django: Createsuperuser', action: () => runDjangoCmd('createsuperuser'), category: 'Django' },
      { label: 'Django: Collectstatic', action: () => runDjangoCmd('collectstatic'), category: 'Django' },
      { label: 'AI: Generate Tests', action: runAITests, category: 'AI' },
      { label: 'AI: Run Bug Hunter', action: runBugHunter, category: 'AI' },
      { label: 'AI: Lint Current File', action: lintCurrentFile, category: 'AI' },
      { label: 'Terminal: Clear', action: () => { const t = getActiveTerm(); if (t) t.clear(); }, category: 'Terminal' },
      { label: 'Terminal: Kill', action: () => { const t = getActiveTerm(); if (t) termSocketSend('kill', t._termId, {}); terminalActive = false; termPrint('Terminal killed.', 'line-info'); }, category: 'Terminal' },
      { label: 'Git: Status', action: updateGitStatus, category: 'Git' },
      { label: 'Settings: Open Settings', action: openSettings, category: 'Settings' },
      { label: 'Settings: Change Theme', action: openSettings, category: 'Settings' },
    ];
  }

  function showCommandPalette() {
    const overlay = $('#cmdpalette-overlay');
    const input = $('#cmdpalette-input');
    const results = $('#cmdpalette-results');
    overlay.classList.remove('hidden');

    const commands = buildCommandList();
    let selectedIdx = 0;

    function render(query) {
      const q = (query || '').toLowerCase().replace(/^> */, '');
      const filtered = q ? commands.filter((c) => c.label.toLowerCase().includes(q)) : commands;
      results.innerHTML = '';
      selectedIdx = 0;
      if (filtered.length === 0) {
        results.innerHTML = '<div class="quickopen-empty">No matching commands</div>';
        return;
      }
      for (let i = 0; i < filtered.length; i++) {
        const c = filtered[i];
        const el = document.createElement('div');
        el.className = 'quickopen-item' + (i === 0 ? ' selected' : '');
        el.innerHTML = `<span class="icon" style="color:var(--accent);font-size:11px;width:auto;">${escapeHtml(c.category)}</span><span class="name">${escapeHtml(c.label)}</span>`;
        el.addEventListener('click', () => {
          overlay.classList.add('hidden');
          input.value = '';
          c.action();
        });
        results.appendChild(el);
      }
    }

    input.value = '';
    render('');
    setTimeout(() => input.focus(), 50);

    input.oninput = () => render(input.value);

    input.onkeydown = (e) => {
      const items = results.querySelectorAll('.quickopen-item');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        items[selectedIdx]?.classList.remove('selected');
        selectedIdx = Math.min(selectedIdx + 1, items.length - 1);
        items[selectedIdx]?.classList.add('selected');
        items[selectedIdx]?.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        items[selectedIdx]?.classList.remove('selected');
        selectedIdx = Math.max(selectedIdx - 1, 0);
        items[selectedIdx]?.classList.add('selected');
        items[selectedIdx]?.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        items[selectedIdx]?.click();
      } else if (e.key === 'Escape') {
        overlay.classList.add('hidden');
      }
    };

    overlay.onclick = (e) => { if (e.target === overlay) overlay.classList.add('hidden'); };
  }

  // ── Zen Mode ────────────────────────────────────────────────────────

  let zenMode = false;

  function toggleZenMode() {
    zenMode = !zenMode;
    const sidebar = $('#sidebar');
    const resizeHandle = $('#resize-sidebar');
    const activityBar = $('.activity-bar');
    const bottomPanel = $('#bottom-panel');
    const resizePanel = $('#resize-panel');
    const statusBar = $('.status-bar');
    const tabBar = $('#tab-bar');

    if (zenMode) {
      if (sidebar) sidebar.style.display = 'none';
      if (resizeHandle) resizeHandle.style.display = 'none';
      if (activityBar) activityBar.style.display = 'none';
      if (bottomPanel) bottomPanel.style.display = 'none';
      if (resizePanel) resizePanel.style.display = 'none';
      if (statusBar) statusBar.style.display = 'none';
      if (tabBar) tabBar.style.display = 'none';
      if (window._monacoEditor) window._monacoEditor.focus();
    } else {
      if (sidebar) sidebar.style.display = '';
      if (resizeHandle) resizeHandle.style.display = '';
      if (activityBar) activityBar.style.display = '';
      if (bottomPanel) bottomPanel.style.display = '';
      if (resizePanel) resizePanel.style.display = '';
      if (statusBar) statusBar.style.display = '';
      if (tabBar) tabBar.style.display = '';
    }
  }

  // ── Auto-Save ───────────────────────────────────────────────────────

  let autoSaveTimer = null;

  function startAutoSave() {
    stopAutoSave();
    const interval = parseInt(localStorage.getItem('editor_autosave_interval') || '0');
    if (interval > 0) {
      autoSaveTimer = setInterval(() => {
        if (openTabs.some((t) => t.modified)) {
          saveCurrentFile();
        }
      }, interval);
    }
  }

  function stopAutoSave() {
    if (autoSaveTimer) { clearInterval(autoSaveTimer); autoSaveTimer = null; }
  }

  // ── Status Bar Enhancements ─────────────────────────────────────────

  function updateStatusBarInfo() {
    const tab = openTabs.find((t) => t.id === activeTabId);
    if (!tab) return;

    const encodingEl = $('#status-encoding');
    const sizeEl = $('#status-filetype');
    if (tab._content !== null) {
      const bytes = new Blob([tab._content]).size;
      let sizeStr;
      if (bytes < 1024) sizeStr = bytes + ' B';
      else if (bytes < 1048576) sizeStr = (bytes / 1024).toFixed(1) + ' KB';
      else sizeStr = (bytes / 1048576).toFixed(1) + ' MB';
      if (encodingEl) encodingEl.title = sizeStr;
    }
  }

  // ── Recent Folders ──────────────────────────────────────────────────

  function addRecentFolder(folder) {
    let recent = JSON.parse(localStorage.getItem('recent_folders') || '[]');
    recent = recent.filter((f) => f !== folder);
    recent.unshift(folder);
    if (recent.length > 10) recent = recent.slice(0, 10);
    localStorage.setItem('recent_folders', JSON.stringify(recent));
  }

  function getRecentFolders() {
    return JSON.parse(localStorage.getItem('recent_folders') || '[]');
  }

  // ── Init ───────────────────────────────────────────────────────────────

  if (!initMonaco()) {
    setTimeout(() => {
      if (editorMode !== 'monaco') createTextareaEditor();
    }, 3000);
  }

  const shellNames = { cmd: 'CMD', powershell: 'PowerShell', bash: 'Bash', wsl: 'WSL' };
  const statusShellEl = $('#status-shell');
  if (statusShellEl) statusShellEl.textContent = shellNames[shellType] || 'CMD';

  const savedTheme = localStorage.getItem('editor_theme') || 'vs-dark';
  applyThemeCssVars(savedTheme);

  window.api.system.getHomedir().then((h) => {
    os_user = h.split(/[/\\]/).pop() || 'user';
    updateShellPrompt();
  }).catch(() => {});

  (window._errorQueue || []).forEach(function(m) { showToast(m, 'error'); });
  window._errorQueue = [];

  renderTabs();
  outputPrint('DjangoNAUT ready.', 'out-info');
  outputPrint('Terminal: ' + (shellNames[shellType] || 'CMD'), 'out-info');
  updateProblemsPanel([]);
  startAutoSave();

  try {
    initFirstTerminal();
    connectTerminalSocket().catch((err) => {
      console.error('Terminal socket failed:', err);
      showToast('Terminal connection error: ' + err.message, 'error');
      outputPrint('Terminal socket error: ' + err.message, 'out-error');
    });
  } catch (err) {
    console.error('Terminal init failed:', err);
    showToast('Terminal init error: ' + err.message, 'error');
    outputPrint('Terminal init error: ' + err.message, 'out-error');
  }

  // ── AI Test Generator ──────────────────────────────────────────────

  let aiLastTests = '';

  async function runAITests() {
    if (!currentFolder) { outputPrint('Open a folder first', 'line-warn'); return; }
    const status = $('#aitests-status');
    const output = $('#aitests-output');
    const filesEl = $('#aitests-files');
    const emptyEl = $('#aitests-empty');
    const saveBtn = $('#btn-aitests-save');
    const genBtn = $('#btn-aitests-generate');

    status.innerHTML = '<span style="color:var(--yellow)">Scanning project and generating tests...</span>';
    output.style.display = 'none';
    filesEl.innerHTML = '';
    genBtn.disabled = true;
    genBtn.textContent = 'Generating...';
    if (emptyEl) emptyEl.style.display = 'none';

    try {
      const result = await window.api.ai.gentests({
        apiKey: groqApiKey,
        model: localStorage.getItem('groq_model') || 'llama-3.3-70b-versatile',
        projectPath: currentFolder,
      });

      if (result.error) {
        status.innerHTML = '<span style="color:var(--red)">' + escapeHtml(result.error) + '</span>';
        return;
      }

      aiLastTests = result.choices[0].message.content;
      output.textContent = aiLastTests;
      output.style.display = 'block';
      status.innerHTML = '<span style="color:var(--green)">Tests generated!</span>';
      if (saveBtn) saveBtn.style.display = 'block';
    } catch (err) {
      status.innerHTML = '<span style="color:var(--red)">Error: ' + escapeHtml(err.message) + '</span>';
    } finally {
      genBtn.disabled = false;
      genBtn.textContent = 'Generate Tests';
    }
  }

  async function saveAITestsToFile() {
    if (!aiLastTests || !currentFolder) return;
    const name = prompt('Save tests as:', 'tests/test_generated.py');
    if (!name) return;
    await window.api.fs.mkfile(currentFolder + '/' + name);
    await window.api.fs.writefile({ filePath: currentFolder + '/' + name, content: aiLastTests });
    await refreshFileTree();
    outputPrint('Tests saved to: ' + name, 'out-success');
  }

  // ════════════════════════════════════════════════════════════════════════
  // DjangoNAUT Agent Features
  // ════════════════════════════════════════════════════════════════════════

  // ── State ───────────────────────────────────────────────────────────────

  const nautSqlLenses = {};        // file -> line -> {queries, time, queries: [sql]}
  const nautSignalLenses = {};     // file -> [{line, model, total, save, delete, signals}]
  let nautLastError = null;
  let codeLensDisposable = null;
  let nautTelemetryPort = 0;

  const nautNorm = (p) => String(p || '').replace(/\\/g, '/');
  const nautModel = () => localStorage.getItem('groq_model') || 'llama-3.3-70b-versatile';

  // ── Generic modal ───────────────────────────────────────────────────────

  function nautModal(title, bodyHtml) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML =
      '<div class="modal naut-modal" style="min-width:480px;max-width:720px">' +
      '<div class="modal-header"><span>' + escapeHtml(title) + '</span>' +
      '<button class="modal-close">&times;</button></div>' +
      '<div class="modal-body" style="max-height:70vh;overflow:auto">' + bodyHtml + '</div></div>';
    document.body.appendChild(overlay);
    overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    return overlay;
  }

  // ── Telemetry: SQL ingestion ───────────────────────────────────────────

  function ingestSql(payload) {
    const byFile = {};
    for (const q of payload.queries || []) {
      if (q.stack && q.stack.file) {
        const file = nautNorm(q.stack.file);
        if (!byFile[file]) byFile[file] = {};
        const line = q.stack.line;
        if (!byFile[file][line]) byFile[file][line] = { queries: 0, time: 0, sqls: [] };
        const e = byFile[file][line];
        e.queries++;
        e.time += q.time || 0;
        if (e.sqls.length < 20) e.sqls.push({ sql: q.sql, time: q.time });
      }
    }
    for (const file of Object.keys(byFile)) {
      if (!nautSqlLenses[file]) nautSqlLenses[file] = {};
      for (const line of Object.keys(byFile[file])) {
        const e = byFile[file][line];
        nautSqlLenses[file][line] = {
          queries: e.queries,
          time: +e.time.toFixed(1),
          sqls: e.sqls,
          view: payload.view,
          path: payload.path,
        };
      }
    }
    const el = $('#status-telemetry');
    if (el) {
      const total = (payload.queries || []).length;
      const warn = total > 50 || payload.totalTime > 1000;
      el.style.color = warn ? 'var(--red)' : 'var(--green)';
      el.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/></svg> ${total} SQL${warn ? ' ⚠' : ''}`;
    }
  }

  // ── Error Interceptor ───────────────────────────────────────────────────

  function nautMarkError(file, line) {
    if (typeof monaco === 'undefined' || !window._monacoEditor) return;
    const model = window._monacoEditor.getModel();
    if (!model) return;
    const msg = nautLastError ? nautLastError.exception + ': ' + nautLastError.message : 'Runtime error';
    monaco.editor.setModelMarkers(model, 'naut-error', [{
      severity: monaco.MarkerSeverity.Error,
      message: msg,
      startLineNumber: line, startColumn: 1,
      endLineNumber: line, endColumn: 1000,
    }]);
    window._monacoEditor.revealLineInCenter(line);
  }

  async function handleNautError(payload) {
    nautLastError = payload;
    const toastMsg = payload.exception + ': ' + payload.message;
    showToast(toastMsg, 'error');
    outputPrint('⛔ ' + toastMsg, 'line-stderr');
    if (payload.frame && payload.frame.file) {
      const name = payload.frame.file.split(/[/\\]/).pop();
      await openFileSilent(payload.frame.file, name);
      setTimeout(() => nautMarkError(payload.frame.file, payload.frame.line), 400);
    }
    if (groqApiKey) {
      try {
        const r = await window.api.ai.analyze({
          apiKey: groqApiKey, model: nautModel(),
          prompt: 'Analyze this Django runtime error and propose a concrete fix:\n\n' + (payload.traceback || payload.message),
          files: [], mode: 'general', scanData,
        });
        addAiMessage('assistant', '🧠 **Error Interceptor:**\n\n' + r);
      } catch (e) {}
    } else {
      addAiMessage('assistant', '⛔ **Runtime error:** ' + toastMsg + '\n\nSet a GROQ API key in Settings to get an AI-powered fix.');
    }
  }

  function nautOnTelemetry(payload) {
    if (!payload) return;
    if (payload.kind === 'sql') ingestSql(payload);
    else if (payload.kind === 'error') handleNautError(payload);
    refreshCodeLenses();
  }

  // ── Monaco CodeLens: SQL telemetry + Signals ───────────────────────────

  function registerNautCommands() {
    if (typeof monaco === 'undefined' || window.__nautCmdsRegistered) return;
    try {
      monaco.editor.registerCommand('naut.sqlDetails', (_a, file, line) => nautShowSqlDetails(file, line));
      monaco.editor.registerCommand('naut.signalDetails', (_a, file, line) => nautShowSignalDetails(file, line));
      window.__nautCmdsRegistered = true;
    } catch (e) {}
  }

  function registerCodeLenses() {
    if (typeof monaco === 'undefined') return;
    if (codeLensDisposable) { try { codeLensDisposable.dispose(); } catch {} codeLensDisposable = null; }
    try {
      codeLensDisposable = monaco.languages.registerCodeLensProvider('python', {
        provideCodeLenses(model) {
          if (!model || !model.uri) return { lenses: [] };
          const path = nautNorm(model.uri.fsPath);
          const lenses = [];
          const sql = nautSqlLenses[path];
          if (sql) {
            for (const line of Object.keys(sql)) {
              const e = sql[line];
              const n = parseInt(line, 10);
              const warn = e.queries > 5;
              const title = '⏱ ' + e.queries + ' запросов · ' + e.time + 'ms' + (warn ? ' · N+1!' : '') + (e.view ? ' · ' + e.view : '');
              lenses.push({
                range: new monaco.Range(n, 1, n, 1),
                command: { id: 'naut.sqlDetails', title, arguments: [path, n] },
              });
            }
          }
          const sig = nautSignalLenses[path];
          if (sig) {
            for (const s of sig) {
              const title = '⚡ ' + s.total + ' signal handler' + (s.total === 1 ? '' : 's') + ' (save: ' + s.save + ', delete: ' + s.delete + ')';
              lenses.push({
                range: new monaco.Range(s.line, 1, s.line, 1),
                command: { id: 'naut.signalDetails', title, arguments: [path, s.line] },
              });
            }
          }
          return { lenses };
        },
      });
    } catch (e) {
      console.warn('[naut] codelens failed:', e.message);
    }
  }

  function refreshCodeLenses() {
    registerNautCommands();
    registerCodeLenses();
  }

  function nautShowSqlDetails(file, line) {
    const data = (nautSqlLenses[file] || {})[line];
    if (!data) return;
    let html = '<div class="mig-summary">' + data.queries + ' queries · ' + data.time + 'ms total' + (data.view ? ' · view: ' + escapeHtml(data.view) : '') + '</div>';
    html += data.sqls.map((q) => '<pre class="scrapbook-sql">' + escapeHtml(q.sql) + ' <span class="scrapbook-sql-time">' + (q.time || 0) + 'ms</span></pre>').join('');
    nautModal('SQL Telemetry — line ' + line, html);
  }

  function nautShowSignalDetails(file, line) {
    const list = (nautSignalLenses[file] || []).filter((s) => s.line === line);
    if (!list.length) return;
    const s = list[0];
    let html = '<div class="mig-summary">' + s.model + ': ' + s.total + ' signal handler(s)</div>';
    for (const sig of s.signals) {
      html += '<div class="sig-item" data-file="' + escapeHtml(sig.file) + '" data-line="' + sig.line + '">' +
        '<span class="sig-sender">' + escapeHtml(sig.signal || 'post_save') + '</span> → <span class="sig-handler">' + escapeHtml(sig.handler || '?') + '</span>' +
        '<div style="font-size:10px;color:var(--text-dim)">' + escapeHtml(sig.file.split(/[/\\]/).pop()) + ':' + sig.line + '</div></div>';
    }
    const overlay = nautModal('Signal Effects — ' + s.model, html);
    overlay.querySelectorAll('.sig-item').forEach((item) => {
      item.addEventListener('click', () => nautGoto(item.dataset.file, parseInt(item.dataset.line, 10)));
    });
  }

  async function nautGoto(file, line) {
    const name = file.split(/[/\\]/).pop();
    await openFileSilent(file, name);
    setTimeout(() => {
      if (window._monacoEditor && typeof monaco !== 'undefined') {
        window._monacoEditor.revealLineInCenter(line);
        window._monacoEditor.setPosition({ lineNumber: line, column: 1 });
        window._monacoEditor.focus();
      }
    }, 250);
  }

  // ── Migration Guard ─────────────────────────────────────────────────────

  async function nautRefreshMigrations() {
    if (!currentFolder) return;
    const el = $('#migration-body');
    if (!el) return;
    let res;
    try { res = await window.api.migration.scan(currentFolder); } catch (e) { return; }

    const statusEl = $('#status-migration');
    const hasConflict = (res.conflicts && res.conflicts.length) || (res.brokenDeps && res.brokenDeps.length);
    if (statusEl) {
      if (hasConflict) {
        statusEl.style.display = '';
        statusEl.style.color = 'var(--red)';
        statusEl.textContent = '⚠️ Migration conflict! (' + ((res.conflicts.length || 0) + (res.brokenDeps.length || 0)) + ')';
        statusEl.onclick = () => switchToPanel('migrations');
      } else {
        statusEl.style.display = 'none';
      }
    }

    let html = '<div class="mig-summary">' + res.migrations.length + ' migrations · ' + (res.conflicts.length || 0) + ' branch conflicts · ' + (res.brokenDeps.length || 0) + ' broken deps</div>';

    if (res.conflicts && res.conflicts.length) {
      html += '<div class="mig-section-title" style="color:var(--red)">Branch conflicts</div>';
      for (const c of res.conflicts) {
        html += '<div class="mig-item warn"><div><b>' + escapeHtml(c.app + '/' + c.number) + '</b></div>' +
          '<div style="font-size:11px">' + escapeHtml(c.name) + ' on branch <b>' + escapeHtml(c.branch) + '</b> vs ' + escapeHtml(c.existsOn || '?') + '</div>' +
          '<button class="mig-fix-btn" data-app="' + escapeHtml(c.app) + '" data-number="' + escapeHtml(c.number) + '" data-name="' + escapeHtml(c.name) + '">Auto-Fix</button></div>';
      }
    }
    if (res.brokenDeps && res.brokenDeps.length) {
      html += '<div class="mig-section-title" style="color:var(--yellow)">Broken dependencies</div>';
      for (const b of res.brokenDeps) {
        html += '<div class="mig-item"><div style="font-size:11px">' + escapeHtml(b.message) + '</div>' +
          '<div style="font-size:10px;color:var(--text-dim)">' + escapeHtml(b.file) + '</div></div>';
      }
    }
    html += '<div class="mig-section-title">Migrations by app</div>';
    const byApp = {};
    for (const m of res.migrations) { (byApp[m.app] = byApp[m.app] || []).push(m); }
    for (const app of Object.keys(byApp)) {
      html += '<div class="mig-app">' + escapeHtml(app) + '</div>';
      for (const m of byApp[app]) {
        html += '<div class="mig-item"><span class="mig-num">' + escapeHtml(m.number) + '</span> ' + escapeHtml(m.name) +
          '<div style="font-size:10px;color:var(--text-dim)">' + m.deps.length + ' deps</div></div>';
      }
    }
    el.innerHTML = html || '<div class="bug-empty"><p>No migrations found.</p></div>';
    el.querySelectorAll('.mig-fix-btn').forEach((btn) => {
      btn.addEventListener('click', () => nautFixMigration({ app: btn.dataset.app, number: btn.dataset.number, name: btn.dataset.name }, btn));
    });
  }

  async function nautFixMigration(target, btn) {
    if (!confirm('Auto-Fix will rename the conflicting migration and update dependents. Continue?')) return;
    btn.disabled = true;
    try {
      const res = await window.api.migration.fix({ root: currentFolder, target });
      if (res.success) {
        showToast('Migration fixed', 'success');
        await nautRefreshMigrations();
        refreshFileTree();
      } else {
        showToast('Fix failed: ' + res.error, 'error');
        btn.disabled = false;
      }
    } catch (e) {
      showToast('Fix error: ' + e.message, 'error');
      btn.disabled = false;
    }
  }

  function switchToPanel(panelId) {
    $$('.activity-icon[data-panel]').forEach((b) => b.classList.remove('active'));
    $$('.sidebar-panel').forEach((p) => p.classList.remove('active'));
    const icon = $('[data-panel="' + panelId + '"]');
    if (icon) icon.classList.add('active');
    const panel = $('#panel-' + panelId);
    if (panel) panel.classList.add('active');
  }

  // ── Celery Tasks ────────────────────────────────────────────────────────

  async function nautRefreshTasks() {
    if (!currentFolder) return;
    const el = $('#task-body');
    if (!el) return;
    let res;
    try { res = await window.api.celery.scan(currentFolder); } catch (e) { return; }
    if (!res.tasks.length) {
      el.innerHTML = '<div class="bug-empty"><p>No Celery tasks found (@shared_task / @app.task).</p></div>';
      return;
    }
    let html = '<div class="mig-summary">' + res.tasks.length + ' tasks</div>';
    for (const t of res.tasks) {
      html += '<div class="task-item"><div class="task-name">' + escapeHtml(t.name) + '</div>' +
        '<div style="font-size:10px;color:var(--text-dim)">' + escapeHtml(t.file.split(/[/\\]/).pop()) + ':' + t.line + '</div>' +
        '<div class="task-actions"><button class="task-run-btn" data-name="' + escapeHtml(t.name) + '" data-args="' + escapeHtml(JSON.stringify(t.args)) + '">Run</button></div></div>';
    }
    el.innerHTML = html;
    el.querySelectorAll('.task-run-btn').forEach((btn) => {
      btn.addEventListener('click', () => nautRunTask(btn.dataset.name, JSON.parse(btn.dataset.args)));
    });
  }

  async function nautRunTask(name, args) {
    const values = [];
    for (const a of args) {
      const v = prompt('Argument "' + a + '":', '');
      if (v === null) return;
      values.push(v);
    }
    const overlay = nautModal('Running ' + name, '<div class="mig-summary">Sending to Celery…</div><pre class="scrapbook-sql">' + escapeHtml(name) + '.delay(' + values.map((v) => JSON.stringify(v)).join(', ') + ')</pre>');
    try {
      const res = await window.api.celery.run({ root: currentFolder, task: name, args: values });
      if (overlay.parentNode) overlay.remove();
      if (res && res.ok) {
        nautModal('Task result', '<div class="scrapbook-value">' + escapeHtml(JSON.stringify(res.result, null, 2)) + '</div>');
      } else {
        nautModal('Task failed', '<pre class="scrapbook-error">' + escapeHtml((res && (res.error || res.stdout)) || 'No result') + '</pre>');
      }
    } catch (e) {
      if (overlay.parentNode) overlay.remove();
      showToast('Task error: ' + e.message, 'error');
    }
  }

  // ── Signals Tracer ──────────────────────────────────────────────────────

  async function nautRefreshSignals() {
    if (!currentFolder) return;
    const el = $('#signals-body');
    if (!el) return;
    let res;
    try { res = await window.api.signals.scan(currentFolder); } catch (e) { return; }

    for (const k of Object.keys(nautSignalLenses)) delete nautSignalLenses[k];
    for (const l of res.lenses || []) {
      const model = (res.models || []).find((m) => m.name === l.model);
      if (!model) continue;
      const path = nautNorm(model.filePath);
      (nautSignalLenses[path] = nautSignalLenses[path] || []).push({
        line: model.line, model: l.model, total: l.total, save: l.save, delete: l.delete, signals: l.signals,
      });
    }
    refreshCodeLenses();

    let html = '<div class="mig-summary">' + (res.signals.length || 0) + ' receivers · ' + (res.lenses.length || 0) + ' models with side-effects</div>';
    html += '<div class="mig-section-title">Signal receivers</div>';
    for (const s of (res.signals || []).slice(0, 200)) {
      html += '<div class="sig-item" data-file="' + escapeHtml(s.file) + '" data-line="' + s.line + '">' +
        '<span class="sig-sender">' + escapeHtml(s.sender || '?') + '</span> → <span class="sig-handler">' + escapeHtml(s.handler || '?') + '</span>' +
        ' <span class="sig-signal">' + escapeHtml(s.signal || '') + '</span>' +
        '<div style="font-size:10px;color:var(--text-dim)">' + escapeHtml(s.file.split(/[/\\]/).pop()) + ':' + s.line + '</div></div>';
    }
    el.innerHTML = html || '<div class="bug-empty"><p>No signals found.</p></div>';
    el.querySelectorAll('.sig-item').forEach((item) => {
      item.addEventListener('click', () => nautGoto(item.dataset.file, parseInt(item.dataset.line, 10)));
    });
  }

  // ── Dependencies ────────────────────────────────────────────────────────

  async function nautRefreshDeps() {
    if (!currentFolder) return;
    const el = $('#deps-body');
    if (!el) return;
    el.innerHTML = '<div class="mig-summary">Checking PyPI…</div>';
    let res;
    try { res = await window.api.deps.scan(currentFolder); } catch (e) {
      el.innerHTML = '<div class="bug-empty"><p>Dependency check failed: ' + escapeHtml(e.message) + '</p></div>';
      return;
    }
    if (!res.file) {
      el.innerHTML = '<div class="bug-empty"><p>No requirements.txt found.</p></div>';
      return;
    }
    if (!res.packages.length) {
      el.innerHTML = '<div class="bug-empty"><p>No parsable packages in requirements.txt.</p></div>';
      return;
    }
    const outdated = res.packages.filter((p) => p.outdated).length;
    const vuln = res.packages.filter((p) => p.vulns && p.vulns.length).length;
    let html = '<div class="mig-summary">' + res.packages.length + ' packages · ' + outdated + ' outdated · ' + vuln + ' vulnerable</div>';
    for (const p of res.packages) {
      const cls = (p.vulns && p.vulns.length) ? 'dep-vuln' : p.outdated ? 'dep-outdated' : '';
      html += '<div class="dep-item ' + cls + '"><div class="dep-name">' + escapeHtml(p.name) + '</div>' +
        '<div class="dep-versions">' + escapeHtml(p.current || 'any') + ' → ' + escapeHtml(p.latest || '?') + '</div>';
      if (p.vulns && p.vulns.length) {
        html += '<div class="dep-vulns">' + p.vulns.map((v) => '<span title="' + escapeHtml(v.summary) + '">' + escapeHtml(v.id) + '</span>').join(' ') + '</div>';
      }
      html += '</div>';
    }
    el.innerHTML = html;
  }

  // ── Security Scanner ────────────────────────────────────────────────────

  let nautSecurityFindings = [];

  async function nautRefreshSecurity() {
    if (!currentFolder) return;
    const el = $('#security-body');
    if (!el) return;
    el.innerHTML = '<div class="mig-summary">Scanning for vulnerabilities…</div>';
    let res;
    try { res = await window.api.security.scan(currentFolder); } catch (e) { return; }
    nautSecurityFindings = res.findings || [];

    const s = res.summary || { critical: 0, warning: 0, info: 0, total: 0 };
    const statusEl = $('#status-security');
    if (statusEl) {
      if (s.total > 0) {
        statusEl.style.display = '';
        statusEl.style.color = s.critical ? 'var(--red)' : s.warning ? 'var(--yellow)' : 'var(--green)';
        statusEl.textContent = '\uD83D\uDEE1 ' + s.critical + ' crit \u00B7 ' + s.warning + ' warn';
        statusEl.onclick = () => switchToPanel('security');
      } else {
        statusEl.style.display = 'none';
      }
    }

    if (!nautSecurityFindings.length) {
      el.innerHTML = '<div class="bug-empty"><p style="color:var(--green)">No vulnerabilities found.</p></div>';
    } else {
      let html = '<div class="mig-summary">' + s.total + ' findings \u00B7 ' + s.critical + ' critical \u00B7 ' + s.warning + ' warnings \u00B7 ' + s.info + ' info</div>';
      for (const f of nautSecurityFindings) {
        const sevCls = f.severity === 'critical' ? 'sec-critical' : f.severity === 'warning' ? 'sec-warning' : 'sec-info';
        const icon = f.severity === 'critical' ? '\u2716' : f.severity === 'warning' ? '\u26A0' : '\u2139';
        const shortFile = f.file ? f.file.replace(currentFolder, '').replace(/[/\\]/g, '/').replace(/^\//, '') : '';
        html += '<div class="sec-item ' + sevCls + '" data-file="' + escapeHtml(f.file) + '" data-line="' + f.line + '">' +
          '<div class="sec-head"><span class="sec-icon">' + icon + '</span> <b>' + escapeHtml(f.rule) + '</b></div>' +
          '<div class="sec-msg">' + escapeHtml(f.message) + '</div>' +
          '<div class="sec-file">' + escapeHtml(shortFile) + ':' + f.line + '</div></div>';
      }
      el.innerHTML = html;
      el.querySelectorAll('.sec-item').forEach((item) => {
        item.addEventListener('click', () => nautGotoSecurity(item.dataset.file, parseInt(item.dataset.line, 10)));
      });
    }
    nautSecurityProblems(nautSecurityFindings);
    nautApplySecurityMarkers();
  }

  function nautSecurityProblems(issues) {
    if (!problemsList) return;
    problemsList.querySelectorAll('.naut-security-item').forEach((n) => n.remove());
    if (!issues || !issues.length) return;
    const empty = problemsList.querySelector('.problems-empty');
    if (empty) empty.remove();
    for (const issue of issues) {
      const el = document.createElement('div');
      el.className = 'problem-item naut-security-item';
      const iconCls = issue.severity === 'critical' ? 'error' : issue.severity === 'warning' ? 'warning' : 'info';
      const iconChar = issue.severity === 'critical' ? '\u2716' : issue.severity === 'warning' ? '\u26A0' : '\u2139';
      const shortFile = issue.file ? issue.file.replace(currentFolder || '', '').replace(/^[/\\]/, '') : '';
      el.innerHTML =
        '<div class="problem-icon ' + iconCls + '">' + iconChar + '</div>' +
        '<span class="problem-msg"><span class="naut-sec-tag">Security:</span> ' + escapeHtml(issue.message) + '</span>' +
        '<span class="problem-file">' + escapeHtml(shortFile) + (issue.line ? ':' + issue.line : '') + '</span>';
      el.addEventListener('click', () => { if (issue.file) nautGotoSecurity(issue.file, issue.line); });
      problemsList.appendChild(el);
    }
  }

  function nautApplySecurityMarkers() {
    if (typeof monaco === 'undefined' || !window._monacoEditor) return;
    const model = window._monacoEditor.getModel();
    if (!model || !model.uri) return;
    const modelPath = nautNorm(model.uri.fsPath);
    const markers = nautSecurityFindings
      .filter((f) => f.file && nautNorm(f.file) === modelPath)
      .map((f) => ({
        severity: f.severity === 'critical' ? monaco.MarkerSeverity.Error : f.severity === 'warning' ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Hint,
        message: f.message,
        startLineNumber: f.line, startColumn: 1,
        endLineNumber: f.line, endColumn: 1000,
      }));
    monaco.editor.setModelMarkers(model, 'naut-security', markers);
  }

  function nautGotoSecurity(file, line) {
    nautGoto(file, line);
  }

  (function nautInitSecurityMarkers() {
    if (typeof monaco !== 'undefined' && window._monacoEditor) {
      window._monacoEditor.onDidChangeModel(() => nautApplySecurityMarkers());
      return;
    }
    setTimeout(nautInitSecurityMarkers, 700);
  })();

  // ── Test Runner ─────────────────────────────────────────────────────────

  const nautTests = { list: [] };
  const nautTestStatus = {};

  async function nautRefreshTests() {
    if (!currentFolder) return;
    const el = $('#tests-body');
    if (!el) return;
    let res;
    try { res = await window.api.tests.scan(currentFolder); } catch (e) { return; }
    nautTests.list = res.tests || [];
    nautRenderTests();
  }

  function nautRenderTests() {
    const el = $('#tests-body');
    if (!el) return;
    const list = nautTests.list || [];
    if (!list.length) {
      el.innerHTML = '<div class="bug-empty"><p>No tests found (test_*.py / *_test.py).</p></div>';
      return;
    }
    const byFile = {};
    for (const t of list) (byFile[t.rel] = byFile[t.rel] || []).push(t);
    let html = '<div class="mig-summary">' + list.length + ' tests</div>';
    for (const rel of Object.keys(byFile)) {
      html += '<div class="mig-app">' + escapeHtml(rel) +
        ' <button class="test-run-file" data-target="' + escapeHtml(rel) + '" title="Run this file">Run file</button></div>';
      for (const t of byFile[rel]) {
        const st = nautTestStatus[t.nodeId];
        const icon = st === 'passed'
          ? '<span class="test-ok">\u2713</span>'
          : st === 'failed' || st === 'error'
            ? '<span class="test-fail">\u2716</span>'
            : st === 'running'
              ? '<span class="test-run">\u2026</span>'
              : '<span class="test-idle">\u00B7</span>';
        html += '<div class="test-item" data-file="' + escapeHtml(t.file) + '" data-line="' + t.line + '">' +
          '<span class="test-icon">' + icon + '</span>' +
          '<span class="test-name">' + escapeHtml(t.className ? t.className + '.' + t.name : t.name) + '</span>' +
          '<span class="test-loc">:' + t.line + '</span>' +
          '<button class="test-run-btn" data-target="' + escapeHtml(t.nodeId) + '" title="Run test">Run</button></div>';
      }
    }
    el.innerHTML = html;
    el.querySelectorAll('.test-item').forEach((item) => {
      item.addEventListener('click', (e) => {
        if (e.target.classList.contains('test-run-btn')) return;
        nautGoto(item.dataset.file, parseInt(item.dataset.line, 10));
      });
    });
    el.querySelectorAll('.test-run-btn').forEach((btn) => {
      btn.addEventListener('click', () => nautRunTests(btn.dataset.target));
    });
    el.querySelectorAll('.test-run-file').forEach((btn) => {
      btn.addEventListener('click', () => nautRunTests(btn.dataset.target));
    });
  }

  async function nautRunTests(target) {
    if (!currentFolder) { showToast('Open a folder first', 'warning'); return; }
    const key = target || '';
    for (const t of nautTests.list || []) {
      if (!key || t.nodeId === key || key === t.rel) nautTestStatus[t.nodeId] = 'running';
    }
    nautRenderTests();
    const label = key || 'All tests';
    outputPrint(label + ' \u2192 running\u2026', 'out-info');
    let res;
    try {
      res = await window.api.tests.run({ root: currentFolder, target: key });
    } catch (e) {
      res = { passed: 0, failed: 0, errors: 1, error: e.message, output: e.message };
    }
    const failedIds = res.failedIds || [];
    for (const t of nautTests.list || []) {
      if (failedIds.includes(t.nodeId)) nautTestStatus[t.nodeId] = 'failed';
      else if (!key || t.nodeId === key || key === t.rel) nautTestStatus[t.nodeId] = 'passed';
    }
    nautRenderTests();

    const summary = (res.framework || 'test') + ': ' + res.passed + ' passed, ' + res.failed + ' failed, ' + res.errors + ' errors' + (res.skipped ? ', ' + res.skipped + ' skipped' : '');
    outputPrint(summary, (res.failed || res.errors) ? 'line-stderr' : 'out-success');
    if (res.output) {
      outputPrint('\u2500'.repeat(60), 'out-info');
      const lines = res.output.split('\n').filter((l) => /FAILED|ERROR|Traceback|^E\s|AssertionError|Error/.test(l));
      outputPrint(lines.slice(-40).join('\n'), 'line-stderr');
    }
    if (res.failed || res.errors) {
      const first = nautTests.list.find((t) => failedIds.includes(t.nodeId));
      if (first) nautGoto(first.file, first.line);
      showToast(summary, 'error');
    } else {
      showToast(summary, 'success');
    }
  }

  // ── Scrapbook (Django Notebook) ─────────────────────────────────────────

  let scrapbookCells = 0;
  function scrapbookAddCell(code) {
    const cells = $('#scrapbook-cells');
    if (!cells) return;
    const empty = cells.querySelector('.scrapbook-empty');
    if (empty) empty.remove();
    scrapbookCells++;
    const div = document.createElement('div');
    div.className = 'scrapbook-cell';
    div.innerHTML =
      '<div class="scrapbook-cell-toolbar"><span class="scrapbook-cell-id">[' + scrapbookCells + ']</span>' +
      '<button class="scrapbook-cell-run" title="Run (Ctrl+Enter)">Run</button>' +
      '<button class="scrapbook-cell-del" title="Delete cell">&times;</button></div>' +
      '<textarea class="scrapbook-cell-input" rows="2" spellcheck="false" placeholder="Django code… (models auto-imported, Ctrl+Enter)">' + escapeHtml(code || '') + '</textarea>' +
      '<div class="scrapbook-cell-output">' +
      '<div class="scrapbook-out-tabs"><span class="scrapbook-out-tab active" data-t="result">Result</span><span class="scrapbook-out-tab" data-t="sql">SQL</span></div>' +
      '<div class="scrapbook-out-body" data-t="result"><div class="scrapbook-out-empty">—</div></div>' +
      '<div class="scrapbook-out-body" data-t="sql" style="display:none"></div>' +
      '</div>';
    cells.appendChild(div);
    const ta = div.querySelector('.scrapbook-cell-input');
    div.querySelector('.scrapbook-cell-run').addEventListener('click', () => scrapbookRun(div));
    div.querySelector('.scrapbook-cell-del').addEventListener('click', () => div.remove());
    div.querySelectorAll('.scrapbook-out-tab').forEach((t) => {
      t.addEventListener('click', () => {
        div.querySelectorAll('.scrapbook-out-tab').forEach((x) => x.classList.toggle('active', x === t));
        div.querySelectorAll('.scrapbook-out-body').forEach((b) => { b.style.display = b.dataset.t === t.dataset.t ? '' : 'none'; });
      });
    });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); scrapbookRun(div); }
    });
    ta.focus();
    return div;
  }

  async function scrapbookRun(div) {
    if (!currentFolder) { showToast('Open a folder first', 'warning'); return; }
    const ta = div.querySelector('.scrapbook-cell-input');
    const runBtn = div.querySelector('.scrapbook-cell-run');
    const badge = $('#scrapbook-badge');
    if (badge) badge.textContent = '…';
    runBtn.disabled = true;
    runBtn.textContent = '…';
    let res;
    try {
      res = await window.api.shell.exec({ root: currentFolder, code: ta.value });
    } catch (e) {
      res = { ok: false, error: e.message };
    }
    runBtn.disabled = false;
    runBtn.textContent = 'Run';
    if (badge) badge.textContent = '';
    scrapbookRender(div, res);
  }

  function scrapbookRender(div, res) {
    const resultBody = div.querySelector('.scrapbook-out-body[data-t="result"]');
    const sqlBody = div.querySelector('.scrapbook-out-body[data-t="sql"]');
    let resultHtml = '';
    if (!res || !res.ok) {
      resultHtml = '<pre class="scrapbook-error">' + escapeHtml((res && (res.error || res.stdout)) || 'Shell unavailable') + '</pre>';
    } else {
      if (res.stdout) resultHtml += '<pre class="scrapbook-stdout">' + escapeHtml(res.stdout) + '</pre>';
      if (res.hasResult && res.result !== undefined) resultHtml += scrapbookRenderResult(res.result);
      else if (!res.stdout) resultHtml += '<div class="scrapbook-out-empty">No output</div>';
    }
    resultBody.innerHTML = resultHtml || '<div class="scrapbook-out-empty">—</div>';

    const queries = (res && res.queries) || [];
    let sqlHtml = '';
    if (queries.length) {
      sqlHtml = '<div class="scrapbook-sql-count">' + queries.length + ' queries · ' + queries.reduce((a, q) => a + (parseFloat(q.time) || 0), 0).toFixed(2) + 'ms</div>';
      sqlHtml += queries.map((q) => '<pre class="scrapbook-sql">' + escapeHtml(q.sql) + ' <span class="scrapbook-sql-time">' + (q.time || 0) + 'ms</span></pre>').join('');
    } else {
      sqlHtml = '<div class="scrapbook-out-empty">No SQL queries</div>';
    }
    sqlBody.innerHTML = sqlHtml;
  }

  function scrapbookRenderResult(v) {
    if (Array.isArray(v) && v.length) {
      const cols = Object.keys(v[0] || {});
      let html = '<table class="scrapbook-table"><thead><tr>' + cols.map((c) => '<th>' + escapeHtml(String(c)) + '</th>').join('') + '</tr></thead><tbody>';
      for (const row of v.slice(0, 20)) {
        html += '<tr>' + cols.map((c) => {
          const val = row[c];
          const s = val === null || val === undefined ? '' : String(val);
          return '<td>' + escapeHtml(s.length > 120 ? s.slice(0, 120) + '…' : s) + '</td>';
        }).join('') + '</tr>';
      }
      html += '</tbody></table>';
      if (v.length > 20) html += '<div class="scrapbook-out-empty">… ' + (v.length - 20) + ' more rows</div>';
      return html;
    }
    if (v && typeof v === 'object' && Array.isArray(v.rows)) return scrapbookRenderResult(v.rows);
    if (v && typeof v === 'object') {
      return '<pre class="scrapbook-json">' + escapeHtml(JSON.stringify(v, null, 2).slice(0, 8000)) + '</pre>';
    }
    return '<pre class="scrapbook-value">' + escapeHtml(String(v)) + '</pre>';
  }

  // ── Mock Data Generator ─────────────────────────────────────────────────

  async function nautMockData() {
    if (!currentFolder) { showToast('Open a folder first', 'warning'); return; }
    if (!scanData || scanData.error) { showToast('Open a Django project with models', 'warning'); return; }
    if (!groqApiKey) { showToast('Set a GROQ API key in Settings', 'warning'); return; }
    const amount = prompt('Rows to generate:', '20');
    if (amount === null) return;
    const overlay = nautModal('Generating mock data', '<div class="mig-summary">Groq is writing a seed script…</div>');
    try {
      const result = await window.api.mockdata.generate({
        apiKey: groqApiKey, model: nautModel(), scanData, amount: parseInt(amount, 10) || 20,
      });
      if (overlay.parentNode) overlay.remove();
      if (result.error) { showToast(result.error, 'error'); return; }
      const code = typeof result === 'string' ? result : (result.choices && result.choices[0].message.content) || '';
      if (!code) { showToast('AI returned empty script', 'error'); return; }
      const runOverlay = nautModal('Mock data script',
        '<pre class="scrapbook-sql" style="max-height:40vh;overflow:auto;white-space:pre-wrap">' + escapeHtml(code.slice(0, 12000)) + '</pre>' +
        '<div style="margin-top:8px;display:flex;gap:8px">' +
        '<button class="scrapbook-btn" id="mock-run">Run in Django shell</button>' +
        '<button class="scrapbook-btn" id="mock-save">Save to file</button></div>');
      runOverlay.querySelector('#mock-run').addEventListener('click', async () => {
        runOverlay.querySelector('#mock-run').textContent = 'Running…';
        const res = await window.api.shell.exec({ root: currentFolder, code });
        runOverlay.querySelector('#mock-run').textContent = 'Run in Django shell';
        nautModal('Seed result', res && res.ok
          ? '<pre class="scrapbook-json">' + escapeHtml(JSON.stringify(res.result, null, 2)) + '</pre>' + (res.stdout ? '<pre class="scrapbook-stdout">' + escapeHtml(res.stdout) + '</pre>' : '')
          : '<pre class="scrapbook-error">' + escapeHtml((res && res.error) || 'Failed') + '</pre>');
      });
      runOverlay.querySelector('#mock-save').addEventListener('click', async () => {
        const name = prompt('Save as:', 'scripts/seed.py');
        if (!name) return;
        await window.api.fs.mkfile(currentFolder + '/' + name);
        await window.api.fs.writefile({ filePath: currentFolder + '/' + name, content: code });
        await refreshFileTree();
        showToast('Saved: ' + name, 'success');
      });
    } catch (e) {
      if (overlay.parentNode) overlay.remove();
      showToast('Mock data error: ' + e.message, 'error');
    }
  }

  // ── Agent install / runserver ───────────────────────────────────────────

  async function nautInstallAgent() {
    if (!currentFolder) return;
    const info = await window.api.agent.path();
    executeCommand('pip install -e "' + info + '"');
    showToast('Installing DjangoNAUT agent…', 'success');
  }

  async function nautRunServer() {
    if (!currentFolder) return;
    const st = await window.api.telemetry.getState();
    const port = st.port || 0;
    executeCommand('python manage.py runserver_naut --naut-port ' + port);
    showToast('runserver_naut started in terminal (telemetry port ' + port + ')', 'success');
  }

  async function nautAfterFolderOpen() {
    if (!currentFolder) return;
    try {
      const st = await window.api.telemetry.getState();
      nautTelemetryPort = st.port || 0;
      const pl = $('#naut-port-label');
      if (pl) pl.textContent = 'Port: ' + (st.port || '—');
    } catch (e) {}
    nautRefreshMigrations();
    nautRefreshSignals();
    nautRefreshTasks();
    nautRefreshDeps();
    nautRefreshSecurity();
    nautRefreshTests();
    try {
      const info = await window.api.agent.check(currentFolder);
      const hint = $('#agent-status');
      if (hint) hint.textContent = info.installed ? 'Agent: installed' : (info.present ? 'Agent: needs install (pip install -e …)' : 'Agent: not found');
    } catch (e) {}
  }

  // ── Wire up ─────────────────────────────────────────────────────────────

  window.api.telemetry.onEvent((payload) => nautOnTelemetry(payload));

  $('#btn-migration-scan')?.addEventListener('click', nautRefreshMigrations);
  $('#btn-task-scan')?.addEventListener('click', nautRefreshTasks);
  $('#btn-signals-scan')?.addEventListener('click', nautRefreshSignals);
  $('#btn-deps-scan')?.addEventListener('click', nautRefreshDeps);
  $('#btn-security-scan')?.addEventListener('click', nautRefreshSecurity);
  $('#btn-test-scan')?.addEventListener('click', nautRefreshTests);
  $('#btn-test-run-all')?.addEventListener('click', () => nautRunTests(''));
  $('#btn-mock-data')?.addEventListener('click', nautMockData);
  $('#btn-naut-runserver')?.addEventListener('click', nautRunServer);
  $('#btn-naut-install')?.addEventListener('click', nautInstallAgent);
  $('#scrapbook-add-cell')?.addEventListener('click', () => scrapbookAddCell());
  $('#scrapbook-run-all')?.addEventListener('click', () => {
    document.querySelectorAll('.scrapbook-cell').forEach((c, i) => setTimeout(() => scrapbookRun(c), i * 400));
  });
  $('#scrapbook-clear')?.addEventListener('click', () => {
    $('#scrapbook-cells').innerHTML = '<div class="scrapbook-empty">Add a cell and run Django code (Ctrl+Enter). Models are auto-imported.</div>';
  });

  $('#panel-tab-scrapbook')?.addEventListener('click', () => {
    setTimeout(() => {
      const ta = document.querySelector('.scrapbook-cell:last-child .scrapbook-cell-input');
      if (ta) ta.focus();
    }, 100);
  });

  (function nautInitCodeLens() {
    if (typeof monaco !== 'undefined' && window._monacoEditor) {
      registerNautCommands();
      registerCodeLenses();
      return;
    }
    setTimeout(nautInitCodeLens, 700);
  })();
})();
