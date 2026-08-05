const { contextBridge, ipcRenderer } = require('electron');

// ── IPC API ────────────────────────────────────────────────────────────

contextBridge.exposeInMainWorld('api', {
  dialog: {
    openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  },

  fs: {
    readdir: (dirPath) => ipcRenderer.invoke('fs:readdir', dirPath),
    readfile: (filePath) => ipcRenderer.invoke('fs:readfile', filePath),
    readfilebinary: (filePath) => ipcRenderer.invoke('fs:readfilebinary', filePath),
    writefile: (data) => ipcRenderer.invoke('fs:writefile', data),
    rename: (opts) => ipcRenderer.invoke('fs:rename', opts),
    delete: (targetPath) => ipcRenderer.invoke('fs:delete', targetPath),
    mkdir: (dirPath) => ipcRenderer.invoke('fs:mkdir', dirPath),
    mkfile: (filePath) => ipcRenderer.invoke('fs:mkfile', filePath),
    search: (opts) => ipcRenderer.invoke('fs:search', opts),
  },

  process: {
    spawn: (opts) => ipcRenderer.invoke('process:spawn', opts),
    kill: (pid) => ipcRenderer.send('process:kill', pid),
    onOutput: (callback) => {
      ipcRenderer.removeAllListeners('process:output');
      ipcRenderer.on('process:output', (_event, data) => callback(data));
    },
    onExit: (callback) => {
      ipcRenderer.removeAllListeners('process:exit');
      ipcRenderer.on('process:exit', (_event, data) => callback(data));
    },
  },

  system: {
    getHomedir: () => ipcRenderer.invoke('get:homedir'),
    getPlatform: () => ipcRenderer.invoke('get:platform'),
  },

  git: {
    status: (cwd) => ipcRenderer.invoke('git:status', cwd),
    branches: (cwd) => ipcRenderer.invoke('git:branches', cwd),
    switch: (opts) => ipcRenderer.invoke('git:switch', opts),
    log: (cwd) => ipcRenderer.invoke('git:log', cwd),
  },

  watcher: {
    start: (opts) => ipcRenderer.invoke('watch:start', opts),
    stop: (id) => ipcRenderer.invoke('watch:stop', id),
    onChange: (callback) => {
      ipcRenderer.removeAllListeners('watch:change');
      ipcRenderer.on('watch:change', (_event, data) => callback(data));
    },
  },

  django: {
    scan: (folder) => ipcRenderer.invoke('django:scan', folder),
    bughunt: (folder) => ipcRenderer.invoke('django:bughunt', folder),
    cmd: (opts) => ipcRenderer.invoke('django:cmd', opts),
  },

  ai: {
    analyze: (opts) => ipcRenderer.invoke('ai:analyze', opts),
    architect: (opts) => ipcRenderer.invoke('ai:architect', opts),
    memory: (opts) => ipcRenderer.invoke('ai:memory', opts),
    bughunt: (opts) => ipcRenderer.invoke('ai:bughunt', opts),
    gentests: (opts) => ipcRenderer.invoke('ai:gentests', opts),
  },

  docker: {
    containers: () => ipcRenderer.invoke('docker:containers'),
    images: () => ipcRenderer.invoke('docker:images'),
    start: (id) => ipcRenderer.invoke('docker:start', id),
    stop: (id) => ipcRenderer.invoke('docker:stop', id),
    remove: (id) => ipcRenderer.invoke('docker:remove', id),
    logs: (id) => ipcRenderer.invoke('docker:logs', id),
    build: (opts) => ipcRenderer.invoke('docker:build', opts),
    run: (opts) => ipcRenderer.invoke('docker:run', opts),
  },

  http: {
    request: (opts) => ipcRenderer.invoke('http:request', opts),
  },

  deploy: {
    check: (opts) => ipcRenderer.invoke('deploy:check', opts),
  },

  terminal: {
    getPort: () => ipcRenderer.invoke('terminal:getPort'),
  },

  telemetry: {
    getState: () => ipcRenderer.invoke('telemetry:getState'),
    onEvent: (callback) => {
      ipcRenderer.removeAllListeners('telemetry:event');
      ipcRenderer.on('telemetry:event', (_event, data) => callback(data));
    },
  },

  agent: {
    path: () => ipcRenderer.invoke('agent:path'),
    check: (root) => ipcRenderer.invoke('agent:check', root),
  },

  migration: {
    scan: (root) => ipcRenderer.invoke('migration:scan', root),
    fix: (opts) => ipcRenderer.invoke('migration:fix', opts),
  },

  signals: {
    scan: (root) => ipcRenderer.invoke('signals:scan', root),
  },

  celery: {
    scan: (root) => ipcRenderer.invoke('celery:scan', root),
    run: (opts) => ipcRenderer.invoke('celery:run', opts),
  },

  shell: {
    exec: (opts) => ipcRenderer.invoke('shell:exec', opts),
    ping: (root) => ipcRenderer.invoke('shell:ping', root),
    close: (root) => ipcRenderer.invoke('shell:close', root),
  },

  deps: {
    scan: (root) => ipcRenderer.invoke('deps:scan', root),
  },

  security: {
    scan: (root) => ipcRenderer.invoke('security:scan', root),
  },

  tests: {
    scan: (root) => ipcRenderer.invoke('test:scan', root),
    run: (opts) => ipcRenderer.invoke('test:run', opts),
  },

  mockdata: {
    generate: (opts) => ipcRenderer.invoke('ai:mockdata', opts),
  },
});
