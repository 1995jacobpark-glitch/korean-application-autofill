const { app, BrowserWindow, dialog, shell } = require("electron");
const { execFile } = require("child_process");
const path = require("path");

let mainWindow = null;
let localServer = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

function execCommand(command, args) {
  return new Promise((resolve) => {
    execFile(command, args, { windowsHide: true, timeout: 20000 }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        command: [command, ...args].join(" "),
        output: `${stdout || ""}${stderr || ""}`.trim(),
        error,
      });
    });
  });
}

async function checkPrerequisites() {
  if (process.platform !== "win32") {
    return {
      ok: false,
      detail: "HWP automation works only on Windows with Hancom HWP installed.",
    };
  }

  const result = await execCommand("reg", ["query", "HKCR\\HWPFrame.HwpObject\\CLSID"]);
  if (result.ok) {
    return { ok: true, detail: result.output || result.command };
  }

  return {
    ok: false,
    detail: result.output || result.error?.message || "HWP COM registry check failed.",
  };
}

async function startLocalServer() {
  const dataRoot = path.join(app.getPath("userData"), "workspace");
  process.env.HWP_AUTOFILL_DATA_DIR = dataRoot;
  process.env.HOST = "127.0.0.1";

  const { startServer } = require("../server");
  const result = await startServer(0, "127.0.0.1");
  localServer = result.server;
  return result.url;
}

async function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1040,
    minHeight: 720,
    title: "HWP 지원서 자동작성",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    shell.openExternal(targetUrl);
    return { action: "deny" };
  });

  await mainWindow.loadURL(url);
}

async function boot() {
  try {
    const url = await startLocalServer();
    await createWindow(url);

    const prerequisites = await checkPrerequisites();
    if (!prerequisites.ok) {
      await dialog.showMessageBox(mainWindow, {
        type: "warning",
        title: "한글(HWP) 설치 필요",
        message: "HWP 파일을 자동으로 작성하려면 Windows용 한글(HWP)이 필요합니다.",
        detail:
          "Python과 pywin32는 설치파일에 포함되어 있습니다.\n\n" +
          "다만 원본 HWP 양식을 열고 저장하는 기능은 한글 프로그램의 자동화 엔진을 사용하므로, 이 PC에 한글(HWP)이 설치되어 있어야 합니다.\n\n" +
          prerequisites.detail,
        buttons: ["확인"],
      });
    }
  } catch (error) {
    await dialog.showMessageBox({
      type: "error",
      title: "앱 실행 실패",
      message: "HWP 지원서 자동작성 앱을 시작하지 못했습니다.",
      detail: error?.stack || error?.message || String(error),
      buttons: ["확인"],
    });
    app.quit();
  }
}

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.whenReady().then(boot);

app.on("before-quit", () => {
  if (localServer) {
    localServer.close();
    localServer = null;
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    const url = await startLocalServer();
    await createWindow(url);
  }
});
