const { app, BrowserWindow, ipcMain, webContents } = require("electron");
const fs = require("fs/promises");
const path = require("path");
const pty = require("node-pty");

const isDev = !app.isPackaged;
const WSL_PREFIXES = ["\\\\wsl.localhost\\", "\\\\wsl$\\"];
const terminalSessions = new Map();

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

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1560,
    height: 960,
    minWidth: 1100,
    minHeight: 680,
    backgroundColor: "#1e1e1e",
    autoHideMenuBar: true,
    title: "Xaihi IDE",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

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
