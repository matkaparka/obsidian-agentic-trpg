(async () => {
  const VAULT = 'vault';
  const { remote } = require('electron');
  const electron = remote.require('electron');

  // Patch the main process' folder picker so the starter's "Open folder as vault"
  // resolves to our test vault without a native dialog.
  let patched = false;
  const dlg = electron.dialog;
  dlg.showOpenDialog = async () => ({ canceled: false, filePaths: [VAULT] });
  try {
    electron.dialog.showOpenDialogSync = () => [VAULT];
  } catch { /* older/newer signature */ }
  patched = true;

  const buttons = [...document.querySelectorAll('button')];
  const target = buttons.find((b) => b.innerText.trim() === '打开') ?? buttons[2];
  const label = target?.innerText?.trim();
  target?.click();
  await new Promise((r) => setTimeout(r, 4000));

  return {
    patched,
    clicked: label,
    openFiles: electron.dialog.showOpenDialogFnPatched ?? 'n/a',
    bodyStillStarter: document.body.innerText.includes('打开本地仓库'),
  };
})()
