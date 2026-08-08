// DjangoNAUT — VS Code companion: open the current workspace folder in the
// DjangoNAUT desktop app (`djangonaut --open <folder>`).
const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

function expandEnv(p) {
  if (typeof p !== 'string' || !p) return p;
  return p.replace(/\$\{env:([^}]+)\}|\$([A-Za-z_][A-Za-z0-9_]*)|%([A-Za-z_][A-Za-z0-9_]*)%/g, (m, a, b, c) => process.env[a || b || c] || m);
}

function guessExecutable() {
  const cfg = vscode.workspace.getConfiguration('djangonaut');
  const custom = expandEnv(cfg.get('executablePath', ''));
  if (custom) return custom;

  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || '';
    const candidates = [
      path.join(local, 'Programs', 'djangonaut', 'djangonaut.exe'),
      path.join(local, 'Programs', 'DjangoNAUT', 'DjangoNAUT.exe'),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    return 'djangonaut';
  }
  if (process.platform === 'darwin') {
    const c = '/Applications/DjangoNAUT.app/Contents/MacOS/DjangoNAUT';
    return fs.existsSync(c) ? c : 'djangonaut';
  }
  return 'djangonaut';
}

async function pickExecutable() {
  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    openLabel: 'Select DjangoNAUT executable',
  });
  return picked && picked.length ? picked[0].fsPath : null;
}

async function openInDjangoNAUT() {
  const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  if (!folder) {
    vscode.window.showInformationMessage('DjangoNAUT: open a workspace folder first.');
    return;
  }

  let exe = guessExecutable();
  if (!fs.existsSync(exe) && path.isAbsolute(exe)) {
    const choice = await vscode.window.showQuickPick(
      ['Yes, pick the executable manually', 'No, cancel'],
      { placeHolder: 'DjangoNAUT executable not found (' + exe + '). Select it manually?' }
    );
    if (choice !== 'Yes, pick the executable manually') return;
    exe = await pickExecutable();
    if (!exe) return;
  }

  try {
    const child = spawn(exe, ['--open', folder.uri.fsPath], { detached: true, stdio: 'ignore' });
    child.unref();
    vscode.window.setStatusBarMessage('DjangoNAUT: opening ' + folder.name, 4000);
  } catch (err) {
    vscode.window.showErrorMessage('DjangoNAUT: failed to launch: ' + err.message);
  }
}

function activate(context) {
  context.subscriptions.push(vscode.commands.registerCommand('djangonaut.openProject', openInDjangoNAUT));
}

function deactivate() {}

module.exports = { activate, deactivate };
