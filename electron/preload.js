const { contextBridge, ipcRenderer } = require("electron");

function createEventSubscription(channel, callback) {
  const listener = (_, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

contextBridge.exposeInMainWorld("xaihi", {
  appName: "Xaihi IDE",
  openSettingsWindow: () => ipcRenderer.invoke("window:open-settings"),
  wsl: {
    listDirectory: (dirPath) => ipcRenderer.invoke("wsl:list-directory", dirPath),
    readFile: (filePath) => ipcRenderer.invoke("wsl:read-file", filePath),
    writeFile: (payload) => ipcRenderer.invoke("wsl:write-file", payload),
    createFile: (payload) => ipcRenderer.invoke("wsl:create-file", payload),
    createDirectory: (payload) => ipcRenderer.invoke("wsl:create-directory", payload),
    copy: (payload) => ipcRenderer.invoke("wsl:copy", payload),
    rename: (payload) => ipcRenderer.invoke("wsl:rename", payload),
    delete: (payload) => ipcRenderer.invoke("wsl:delete", payload),
  },
  terminal: {
    start: (payload) => ipcRenderer.invoke("terminal:start", payload),
    write: (data) => ipcRenderer.invoke("terminal:write", data),
    resize: (payload) => ipcRenderer.invoke("terminal:resize", payload),
    stop: () => ipcRenderer.invoke("terminal:stop"),
    onData: (callback) => createEventSubscription("terminal:data", callback),
    onExit: (callback) => createEventSubscription("terminal:exit", callback),
    onError: (callback) => createEventSubscription("terminal:error", callback),
  },
});
