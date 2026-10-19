(async () => {
  const VAULT = '../campaign-vault';
  const { remote } = require('electron');
  const electron = remote.require('electron');

  // 把主进程的文件夹选择器替换掉，避免弹原生对话框；starter 的「打开」会直接打开正式 vault。
  const dlg = electron.dialog;
  dlg.showOpenDialog = async () => ({ canceled: false, filePaths: [VAULT] });
  try {
    electron.dialog.showOpenDialogSync = () => [VAULT];
  } catch {
    /* 不同版本签名 */
  }

  const buttons = [...document.querySelectorAll('button')];
  const target =
    buttons.find((b) => b.innerText.trim() === '打开') ??
    buttons.find((b) => /open/i.test(b.innerText)) ??
    buttons[2];
  const label = target?.innerText?.trim();
  target?.click();
  await new Promise((r) => setTimeout(r, 5000));

  return {
    clicked: label,
    bodyStillStarter: document.body.innerText.includes('打开本地仓库') || /Open folder as vault/i.test(document.body.innerText),
  };
})()
