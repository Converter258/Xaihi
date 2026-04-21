const { app, BrowserWindow, ipcMain, webContents } = require("electron");
const fs = require("fs/promises");
const { constants: fsConstants } = require("fs");
const path = require("path");
const pty = require("node-pty");

const isDev = !app.isPackaged;
const WSL_PREFIXES = ["\\\\wsl.localhost\\", "\\\\wsl$\\"];
const terminalSessions = new Map();
const SETTINGS_WINDOW_HTML = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>设置</title>
    <style>
      :root {
        color-scheme: dark;
      }
      html,
      body {
        width: 100%;
        height: 100%;
        margin: 0;
        background: #1e1e1e;
      }
    </style>
  </head>
  <body></body>
</html>`;

let settingsWindow = null;

function normalizeWslPath(inputPath) {
  if (typeof inputPath !== "string" || inputPath.trim() === "") {
    throw new Error("路径不能为空。");
  }

  const normalizedPath = path.win32.normalize(inputPath.trim());
  const lowerPath = normalizedPath.toLowerCase();
  const isWslPath = WSL_PREFIXES.some((prefix) => lowerPath.startsWith(prefix));

  if (!isWslPath) {
    throw new Error("仅支持 WSL 路径，例如 \\\\wsl.localhost\\Ubuntu-22.04\\home。");
  }

  return normalizedPath;
}

function normalizeEntryName(inputName) {
  if (typeof inputName !== "string") {
    throw new Error("名称不能为空。");
  }

  const nextName = inputName.trim();
  if (!nextName) {
    throw new Error("名称不能为空。");
  }

  if (nextName === "." || nextName === "..") {
    throw new Error("名称不能为 . 或 ..");
  }

  if (nextName.includes("/") || nextName.includes("\\")) {
    throw new Error("名称不能包含路径分隔符。");
  }

  return nextName;
}

async function ensureDirectory(targetPath, message) {
  const stats = await fs.stat(targetPath);
  if (!stats.isDirectory()) {
    throw new Error(message);
  }
}

async function getEntryType(targetPath) {
  const stats = await fs.stat(targetPath);
  return stats.isDirectory() ? "directory" : "file";
}

function registerIpcHandlers() {
  ipcMain.handle("wsl:list-directory", async (_, dirPath) => {
    const targetPath = normalizeWslPath(dirPath);
    const entries = await fs.readdir(targetPath, { withFileTypes: true });

    const serializedEntries = await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.win32.join(targetPath, entry.name);
        const stats = await fs.stat(fullPath);

        return {
          name: entry.name,
          path: fullPath,
          type: entry.isDirectory() ? "directory" : "file",
          size: stats.size,
          mtimeMs: stats.mtimeMs,
        };
      }),
    );

    serializedEntries.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "directory" ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    return {
      path: targetPath,
      entries: serializedEntries,
    };
  });

  ipcMain.handle("wsl:read-file", async (_, filePath) => {
    const targetPath = normalizeWslPath(filePath);
    const stats = await fs.stat(targetPath);

    if (!stats.isFile()) {
      throw new Error("目标不是文件，无法读取。");
    }

    const content = await fs.readFile(targetPath, "utf8");
    return {
      path: targetPath,
      content,
    };
  });

  ipcMain.handle("wsl:write-file", async (_, payload) => {
    const targetPath = normalizeWslPath(payload?.path);
    const content = typeof payload?.content === "string" ? payload.content : "";
    const parentPath = path.win32.dirname(targetPath);
    const parentStats = await fs.stat(parentPath);

    if (!parentStats.isDirectory()) {
      throw new Error("父目录不存在，无法写入。");
    }

    let targetStats = null;
    try {
      targetStats = await fs.stat(targetPath);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }

    if (targetStats?.isDirectory()) {
      throw new Error("目标不是文件，无法写入。");
    }

    await fs.writeFile(targetPath, content, "utf8");
    return {
      path: targetPath,
      bytes: Buffer.byteLength(content, "utf8"),
    };
  });

  ipcMain.handle("wsl:create-file", async (_, payload) => {
    const dirPath = normalizeWslPath(payload?.dirPath);
    const name = normalizeEntryName(payload?.name);
    await ensureDirectory(dirPath, "目标目录不存在，无法创建文件。");

    const targetPath = path.win32.join(dirPath, name);
    await fs.writeFile(targetPath, "", { encoding: "utf8", flag: "wx" });

    return {
      path: targetPath,
      type: "file",
    };
  });

  ipcMain.handle("wsl:create-directory", async (_, payload) => {
    const dirPath = normalizeWslPath(payload?.dirPath);
    const name = normalizeEntryName(payload?.name);
    await ensureDirectory(dirPath, "目标目录不存在，无法创建文件夹。");

    const targetPath = path.win32.join(dirPath, name);
    await fs.mkdir(targetPath, { recursive: false });

    return {
      path: targetPath,
      type: "directory",
    };
  });

  ipcMain.handle("wsl:copy", async (_, payload) => {
    const sourcePath = normalizeWslPath(payload?.sourcePath);
    const targetDirPath = normalizeWslPath(payload?.targetDirPath);
    await ensureDirectory(targetDirPath, "目标目录不存在，无法粘贴。");

    const sourceType = await getEntryType(sourcePath);
    const targetPath = path.win32.join(targetDirPath, path.win32.basename(sourcePath));

    if (sourceType === "directory") {
      await fs.cp(sourcePath, targetPath, {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
    } else {
      await fs.copyFile(sourcePath, targetPath, fsConstants.COPYFILE_EXCL);
    }

    return {
      path: targetPath,
      type: sourceType,
    };
  });

  ipcMain.handle("wsl:rename", async (_, payload) => {
    const targetPath = normalizeWslPath(payload?.targetPath);
    const newName = normalizeEntryName(payload?.newName);
    const parentPath = path.win32.dirname(targetPath);
    await ensureDirectory(parentPath, "父目录不存在，无法重命名。");

    const nextPath = path.win32.join(parentPath, newName);
    if (nextPath === targetPath) {
      throw new Error("新名称与原名称相同。");
    }

    const targetType = await getEntryType(targetPath);
    await fs.rename(targetPath, nextPath);

    return {
      path: nextPath,
      type: targetType,
    };
  });

  ipcMain.handle("wsl:delete", async (_, payload) => {
    const targetPath = normalizeWslPath(payload?.targetPath);
    const targetType = await getEntryType(targetPath);

    if (targetType === "directory") {
      await fs.rm(targetPath, { recursive: true, force: false });
    } else {
      await fs.unlink(targetPath);
    }

    return {
      path: targetPath,
      type: targetType,
    };
  });

  ipcMain.handle("terminal:start", async (event, payload) => {
    const senderId = event.sender.id;
    const cols = Number.isInteger(payload?.cols) && payload.cols > 0 ? payload.cols : 80;
    const rows = Number.isInteger(payload?.rows) && payload.rows > 0 ? payload.rows : 24;

    stopTerminalSession(senderId);

    try {
      const ptyProcess = pty.spawn("wsl.exe", ["--cd", "~"], {
        name: "xterm-256color",
        cols,
        rows,
        cwd: process.cwd(),
        useConptyDll: true,
        env: {
          ...process.env,
          TERM: "xterm-256color",
          COLORTERM: "truecolor",
          FORCE_COLOR: "1",
        },
      });

      const dataDisposable = ptyProcess.onData((chunk) => {
        sendToRenderer(senderId, "terminal:data", chunk);
      });

      const exitDisposable = ptyProcess.onExit((exitEvent) => {
        sendToRenderer(senderId, "terminal:exit", {
          exitCode: exitEvent.exitCode,
          signal: exitEvent.signal,
        });
        stopTerminalSession(senderId);
      });

      terminalSessions.set(senderId, {
        ptyProcess,
        dataDisposable,
        exitDisposable,
      });

      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "终端启动失败。";
      sendToRenderer(senderId, "terminal:error", { message });
      throw new Error(message);
    }
  });

  ipcMain.handle("terminal:write", async (event, data) => {
    const session = terminalSessions.get(event.sender.id);
    if (!session) {
      throw new Error("终端会话不存在，请先启动终端。");
    }

    session.ptyProcess.write(typeof data === "string" ? data : "");
    return { ok: true };
  });

  ipcMain.handle("terminal:resize", async (event, payload) => {
    const session = terminalSessions.get(event.sender.id);
    if (!session) {
      return { ok: false };
    }

    const cols = Number.isInteger(payload?.cols) && payload.cols > 0 ? payload.cols : 80;
    const rows = Number.isInteger(payload?.rows) && payload.rows > 0 ? payload.rows : 24;
    session.ptyProcess.resize(cols, rows);

    return { ok: true };
  });

  ipcMain.handle("terminal:stop", async (event) => {
    stopTerminalSession(event.sender.id);
    return { ok: true };
  });

  ipcMain.handle("window:open-settings", async (event) => {
    const parentWindow = BrowserWindow.fromWebContents(event.sender);
    createSettingsWindow(parentWindow ?? undefined);
    return { ok: true };
  });

  ipcMain.handle("window:minimize", async (event) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender);
    if (!targetWindow) {
      throw new Error("未找到窗口实例，无法最小化。");
    }

    targetWindow.minimize();
    return { ok: true };
  });

  ipcMain.handle("window:close", async (event) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender);
    if (!targetWindow) {
      throw new Error("未找到窗口实例，无法关闭。");
    }

    targetWindow.close();
    return { ok: true };
  });

  ipcMain.handle("window:toggle-maximize", async (event) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender);
    if (!targetWindow) {
      throw new Error("未找到窗口实例，无法切换最大化。");
    }

    if (targetWindow.isMaximized()) {
      targetWindow.unmaximize();
    } else {
      targetWindow.maximize();
    }

    return {
      isMaximized: targetWindow.isMaximized(),
    };
  });

  ipcMain.handle("window:is-maximized", async (event) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender);
    if (!targetWindow) {
      return { isMaximized: false };
    }

    return {
      isMaximized: targetWindow.isMaximized(),
    };
  });
}

function sendToRenderer(webContentsId, channel, payload) {
  const target = webContents.fromId(webContentsId);
  if (target && !target.isDestroyed()) {
    target.send(channel, payload);
  }
}

function stopTerminalSession(webContentsId) {
  const session = terminalSessions.get(webContentsId);
  if (!session) {
    return;
  }

  session.dataDisposable?.dispose();
  session.exitDisposable?.dispose();
  try {
    session.ptyProcess.kill();
  } catch (error) {
    // Ignore kill errors during shutdown/reload.
  }
  terminalSessions.delete(webContentsId);
}

function createSettingsWindow(parentWindow) {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return settingsWindow;
  }

  settingsWindow = new BrowserWindow({
    width: 860,
    height: 620,
    minWidth: 560,
    minHeight: 420,
    backgroundColor: "#1e1e1e",
    title: "设置",
    autoHideMenuBar: true,
    show: false,
    parent: parentWindow,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  settingsWindow.once("ready-to-show", () => {
    settingsWindow?.show();
  });

  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });

  settingsWindow.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(SETTINGS_WINDOW_HTML)}`);
  return settingsWindow;
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1560,
    height: 960,
    minWidth: 1100,
    minHeight: 680,
    frame: false,
    backgroundColor: "#1e1e1e",
    autoHideMenuBar: true,
    title: "Xaihi IDE",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const emitMaximizeChanged = () => {
    if (mainWindow.isDestroyed()) {
      return;
    }

    mainWindow.webContents.send("window:maximize-changed", {
      isMaximized: mainWindow.isMaximized(),
    });
  };

  mainWindow.on("maximize", emitMaximizeChanged);
  mainWindow.on("unmaximize", emitMaximizeChanged);

  if (isDev) {
    mainWindow.loadURL("http://127.0.0.1:5173");
    mainWindow.webContents.openDevTools({ mode: "detach" });
    return;
  }

  mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
}

app.whenReady().then(() => {
  registerIpcHandlers();

  app.on("web-contents-created", (_, contents) => {
    contents.once("destroyed", () => {
      stopTerminalSession(contents.id);
    });
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  for (const id of terminalSessions.keys()) {
    stopTerminalSession(id);
  }

  if (process.platform !== "darwin") {
    app.quit();
  }
});
