import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MonacoEditor from "./components/MonacoEditor";
import TerminalView from "./components/TerminalView";

const defaultRootPath = "\\\\wsl.localhost\\Ubuntu-22.04\\home";
const emptyFileHint = "// 请在左侧文件树中选择一个文件。";
const TERMINAL_WIDTH_STORAGE_KEY = "xaihi.terminal.width";
const TERMINAL_MIN_WIDTH = 280;
const TERMINAL_MAX_RATIO = 0.5;
const TERMINAL_DEFAULT_WIDTH = 360;
const TERMINAL_COLLAPSED_WIDTH = 48;

const extensionLanguageMap = {
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  json: "json",
  css: "css",
  scss: "scss",
  less: "less",
  html: "html",
  md: "markdown",
  py: "python",
  java: "java",
  c: "c",
  cpp: "cpp",
  cs: "csharp",
  go: "go",
  rs: "rust",
  php: "php",
  sh: "shell",
  yml: "yaml",
  yaml: "yaml",
};

function getBaseName(targetPath) {
  const segments = targetPath.split(/[/\\]+/).filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : targetPath;
}

function normalizePathForCompare(targetPath) {
  return targetPath.replace(/\//g, "\\").replace(/\\+$/g, "").toLowerCase();
}

function isSameOrChildPath(targetPath, basePath) {
  const normalizedTarget = normalizePathForCompare(targetPath);
  const normalizedBase = normalizePathForCompare(basePath);
  return (
    normalizedTarget === normalizedBase || normalizedTarget.startsWith(`${normalizedBase}\\`)
  );
}

function replacePathPrefix(targetPath, sourcePrefix, nextPrefix) {
  if (!targetPath || !sourcePrefix) {
    return targetPath;
  }

  const normalizedTarget = normalizePathForCompare(targetPath);
  const normalizedSource = normalizePathForCompare(sourcePrefix);
  if (normalizedTarget === normalizedSource) {
    return nextPrefix;
  }

  const prefixWithSeparator = `${normalizedSource}\\`;
  if (!normalizedTarget.startsWith(prefixWithSeparator)) {
    return targetPath;
  }

  const suffix = targetPath.slice(sourcePrefix.length);
  return `${nextPrefix}${suffix}`;
}

function findTreeNodeByPath(node, targetPath) {
  if (!node) {
    return null;
  }

  if (node.path === targetPath) {
    return node;
  }

  for (const child of node.children ?? []) {
    const match = findTreeNodeByPath(child, targetPath);
    if (match) {
      return match;
    }
  }

  return null;
}

function getParentDirectoryPath(targetPath) {
  const separatorsPattern = /[/\\]+/g;
  const normalizedPath = targetPath.replace(separatorsPattern, "\\");
  const lastSeparatorIndex = normalizedPath.lastIndexOf("\\");
  if (lastSeparatorIndex <= 1) {
    return normalizedPath;
  }
  return normalizedPath.slice(0, lastSeparatorIndex);
}

function validateEntryName(inputValue) {
  const nextName = inputValue.trim();
  if (!nextName) {
    return "名称不能为空。";
  }

  if (nextName === "." || nextName === "..") {
    return "名称不能为 . 或 ..";
  }

  if (nextName.includes("/") || nextName.includes("\\")) {
    return "名称不能包含路径分隔符。";
  }

  return "";
}

function getContextTargetDirectoryPath(node, rootPath) {
  if (!node) {
    return rootPath ?? "";
  }

  if (node.type === "directory") {
    return node.path;
  }

  return getParentDirectoryPath(node.path);
}

function inferLanguageByPath(filePath) {
  if (!filePath) {
    return "plaintext";
  }

  const extension = filePath.split(".").pop()?.toLowerCase() ?? "";
  return extensionLanguageMap[extension] ?? "plaintext";
}

function clampTerminalWidth(width, viewportWidth = window.innerWidth) {
  const maxWidth = Math.max(TERMINAL_MIN_WIDTH, Math.floor(viewportWidth * TERMINAL_MAX_RATIO));
  return Math.min(Math.max(width, TERMINAL_MIN_WIDTH), maxWidth);
}

function getInitialTerminalWidth() {
  if (typeof window === "undefined") {
    return TERMINAL_DEFAULT_WIDTH;
  }

  const savedWidth = Number.parseInt(localStorage.getItem(TERMINAL_WIDTH_STORAGE_KEY) ?? "", 10);
  if (Number.isNaN(savedWidth)) {
    return clampTerminalWidth(TERMINAL_DEFAULT_WIDTH);
  }

  return clampTerminalWidth(savedWidth);
}

function createTreeNode(entry) {
  const isDirectory = entry.type === "directory";
  return {
    name: entry.name,
    path: entry.path,
    type: isDirectory ? "directory" : "file",
    isExpanded: false,
    isLoaded: false,
    isLoading: false,
    error: null,
    children: [],
  };
}

function updateTreeNode(node, targetPath, updater) {
  if (!node) {
    return node;
  }

  if (node.path === targetPath) {
    return updater(node);
  }

  if (!node.children || node.children.length === 0) {
    return node;
  }

  let changed = false;
  const nextChildren = node.children.map((child) => {
    const nextChild = updateTreeNode(child, targetPath, updater);
    if (nextChild !== child) {
      changed = true;
    }
    return nextChild;
  });

  return changed ? { ...node, children: nextChildren } : node;
}

function ExplorerNode({
  node,
  depth,
  activeFilePath,
  onToggleDirectory,
  onOpenFile,
  onContextMenuNode,
}) {
  const isDirectory = node.type === "directory";
  const isActiveFile = !isDirectory && activeFilePath === node.path;
  const icon = isDirectory ? (node.isExpanded ? "▾" : "▸") : "•";

  return (
    <div>
      <button
        type="button"
        className={`flex h-7 w-full items-center gap-2 rounded px-2 text-left text-[13px] transition ${
          isActiveFile ? "bg-vscode-accent text-white" : "text-vscode-text hover:bg-vscode-hover"
        }`}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
        onClick={() => (isDirectory ? onToggleDirectory(node) : onOpenFile(node))}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onContextMenuNode(event, node);
        }}
      >
        <span className={`w-3 ${isActiveFile ? "text-white" : "text-vscode-muted"}`}>{icon}</span>
        <span className="truncate">{node.name}</span>
        {node.isLoading && <span className="ml-auto text-[11px] text-vscode-muted">加载中</span>}
      </button>

      {isDirectory && node.error && (
        <div
          className="truncate px-2 text-[11px] text-red-400"
          style={{ paddingLeft: `${depth * 14 + 26}px` }}
          title={node.error}
        >
          {node.error}
        </div>
      )}

      {isDirectory &&
        node.isExpanded &&
        node.children.map((child) => (
          <ExplorerNode
            key={child.path}
            node={child}
            depth={depth + 1}
            activeFilePath={activeFilePath}
            onToggleDirectory={onToggleDirectory}
            onOpenFile={onOpenFile}
            onContextMenuNode={onContextMenuNode}
          />
        ))}
    </div>
  );
}

function App() {
  const [isExplorerCollapsed, setExplorerCollapsed] = useState(false);
  const [isTerminalCollapsed, setTerminalCollapsed] = useState(false);
  const [rootInputPath, setRootInputPath] = useState(defaultRootPath);
  const [rootNode, setRootNode] = useState(null);
  const [activeFilePath, setActiveFilePath] = useState("");
  const [editorValue, setEditorValue] = useState(emptyFileHint);
  const [lastSavedValue, setLastSavedValue] = useState(emptyFileHint);
  const [isFileLoading, setFileLoading] = useState(false);
  const [isSaving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [isStatusBarCollapsed, setStatusBarCollapsed] = useState(true);
  const [terminalWidth, setTerminalWidth] = useState(() => getInitialTerminalWidth());
  const [isResizing, setResizing] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const [clipboardEntry, setClipboardEntry] = useState(null);
  const terminalWidthRef = useRef(terminalWidth);

  const apiReady = Boolean(window.xaihi?.wsl);
  const activeLanguage = useMemo(() => inferLanguageByPath(activeFilePath), [activeFilePath]);
  const activeFileName = useMemo(
    () => (activeFilePath ? getBaseName(activeFilePath) : "未打开文件"),
    [activeFilePath],
  );
  const isDirty = Boolean(activeFilePath) && editorValue !== lastSavedValue;
  const hasStatusError = statusMessage.trim().length > 0;

  const updateNodeByPath = useCallback((targetPath, updater) => {
    setRootNode((prev) => updateTreeNode(prev, targetPath, updater));
  }, []);

  const listDirectory = useCallback(async (targetPath) => {
    if (!window.xaihi?.wsl) {
      throw new Error("IPC 未就绪，请使用 Electron 启动应用。");
    }

    const result = await window.xaihi.wsl.listDirectory(targetPath);
    return result.entries.map((entry) => createTreeNode(entry));
  }, []);

  const loadRootDirectory = useCallback(
    async (targetPath) => {
      const normalizedPath = targetPath.trim();
      if (!normalizedPath) {
        setStatusMessage("请输入有效的 WSL 路径。");
        return;
      }

      const nextRootNode = {
        name: getBaseName(normalizedPath),
        path: normalizedPath,
        type: "directory",
        isExpanded: true,
        isLoaded: false,
        isLoading: true,
        error: null,
        children: [],
      };

      setRootNode(nextRootNode);
      setActiveFilePath("");
      setEditorValue(emptyFileHint);
      setLastSavedValue(emptyFileHint);
      setStatusMessage("");

      try {
        const children = await listDirectory(normalizedPath);
        setRootNode({
          ...nextRootNode,
          isLoading: false,
          isLoaded: true,
          children,
        });
        setStatusMessage("");
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "目录加载失败。";
        setRootNode({
          ...nextRootNode,
          isLoading: false,
          error: errorMessage,
        });
        setStatusMessage(`加载失败：${errorMessage}`);
      }
    },
    [listDirectory],
  );

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const openContextMenu = useCallback((event, node, scope) => {
    if (!rootNode?.path) {
      return;
    }

    const targetDirPath = getContextTargetDirectoryPath(node, rootNode.path);
    const menuWidth = 184;
    const menuHeight = 240;
    const x = Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth));
    const y = Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight));

    setContextMenu({
      x,
      y,
      scope,
      node: node ?? null,
      targetDirPath,
    });
  }, [rootNode]);

  const refreshDirectoryNode = useCallback(
    async (targetPath) => {
      if (!targetPath || !rootNode?.path) {
        return;
      }

      try {
        const children = await listDirectory(targetPath);
        const targetNode = findTreeNodeByPath(rootNode, targetPath);

        if (!targetNode) {
          await loadRootDirectory(rootNode.path);
          return;
        }

        setRootNode((previous) => {
          if (!previous) {
            return previous;
          }

          if (previous.path === targetPath) {
            return {
              ...previous,
              isLoaded: true,
              isLoading: false,
              isExpanded: true,
              error: null,
              children,
            };
          }

          return updateTreeNode(previous, targetPath, (current) => ({
            ...current,
            isLoaded: true,
            isLoading: false,
            isExpanded: true,
            error: null,
            children,
          }));
        });
        setStatusMessage("");
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "目录刷新失败。";
        setStatusMessage(`刷新目录失败：${errorMessage}`);
      }
    },
    [listDirectory, loadRootDirectory, rootNode],
  );

  const handleToggleDirectory = useCallback(
    async (node) => {
      if (node.isExpanded) {
        updateNodeByPath(node.path, (current) => ({ ...current, isExpanded: false }));
        return;
      }

      updateNodeByPath(node.path, (current) => ({ ...current, isExpanded: true }));
      if (node.isLoaded || node.isLoading) {
        return;
      }

      updateNodeByPath(node.path, (current) => ({ ...current, isLoading: true, error: null }));
      try {
        const children = await listDirectory(node.path);
        updateNodeByPath(node.path, (current) => ({
          ...current,
          isLoading: false,
          isLoaded: true,
          isExpanded: true,
          children,
        }));
        setStatusMessage("");
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "目录读取失败。";
        updateNodeByPath(node.path, (current) => ({
          ...current,
          isLoading: false,
          error: errorMessage,
        }));
        setStatusMessage(`读取目录失败：${errorMessage}`);
      }
    },
    [listDirectory, updateNodeByPath],
  );

  const handleOpenFile = useCallback(
    async (node) => {
      if (!window.xaihi?.wsl) {
        setStatusMessage("IPC 未就绪，请使用 Electron 启动应用。");
        return;
      }

      setFileLoading(true);
      try {
        const result = await window.xaihi.wsl.readFile(node.path);
        setActiveFilePath(result.path);
        setEditorValue(result.content);
        setLastSavedValue(result.content);
        setStatusMessage("");
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "文件读取失败。";
        setStatusMessage(`读取失败：${errorMessage}`);
      } finally {
        setFileLoading(false);
      }
    },
    [],
  );

  const handleSaveFile = useCallback(async () => {
    if (!window.xaihi?.wsl || !activeFilePath) {
      return;
    }

    setSaving(true);
    try {
      await window.xaihi.wsl.writeFile({
        path: activeFilePath,
        content: editorValue,
      });
      setLastSavedValue(editorValue);
      setStatusMessage("");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "保存失败。";
      setStatusMessage(`保存失败：${errorMessage}`);
    } finally {
      setSaving(false);
    }
  }, [activeFilePath, editorValue]);

  const clearActiveFileState = useCallback(() => {
    setActiveFilePath("");
    setEditorValue(emptyFileHint);
    setLastSavedValue(emptyFileHint);
  }, []);

  const getCrudApi = useCallback(() => {
    const api = window.xaihi?.wsl;
    if (
      !api?.createFile ||
      !api?.createDirectory ||
      !api?.copy ||
      !api?.rename ||
      !api?.delete
    ) {
      throw new Error("Explorer CRUD IPC 未就绪，请通过 Electron 启动应用。");
    }
    return api;
  }, []);

  const handleExplorerNodeContextMenu = useCallback(
    (event, node) => {
      openContextMenu(event, node, "node");
    },
    [openContextMenu],
  );

  const handleExplorerBlankContextMenu = useCallback(
    (event) => {
      event.preventDefault();
      openContextMenu(event, null, "blank");
    },
    [openContextMenu],
  );

  const handleCreateEntry = useCallback(
    async (entryType, targetDirPath) => {
      const defaultName = entryType === "file" ? "untitled.txt" : "新建文件夹";
      const dialogTitle = entryType === "file" ? "请输入新文件名称：" : "请输入新文件夹名称：";
      const inputValue = window.prompt(dialogTitle, defaultName);
      if (inputValue === null) {
        return;
      }

      const nameError = validateEntryName(inputValue);
      if (nameError) {
        setStatusMessage(nameError);
        return;
      }

      const api = getCrudApi();
      if (entryType === "file") {
        await api.createFile({
          dirPath: targetDirPath,
          name: inputValue.trim(),
        });
      } else {
        await api.createDirectory({
          dirPath: targetDirPath,
          name: inputValue.trim(),
        });
      }

      await refreshDirectoryNode(targetDirPath);
      setStatusMessage("");
    },
    [getCrudApi, refreshDirectoryNode],
  );

  const handlePasteEntry = useCallback(
    async (targetDirPath) => {
      if (!clipboardEntry) {
        setStatusMessage("剪贴板为空，无法粘贴。");
        return;
      }

      const api = getCrudApi();
      await api.copy({
        sourcePath: clipboardEntry.path,
        targetDirPath,
      });

      await refreshDirectoryNode(targetDirPath);
      setStatusMessage("");
    },
    [clipboardEntry, getCrudApi, refreshDirectoryNode],
  );

  const handleRenameEntry = useCallback(
    async (node) => {
      const inputValue = window.prompt("请输入新名称：", node.name);
      if (inputValue === null) {
        return;
      }

      const nameError = validateEntryName(inputValue);
      if (nameError) {
        setStatusMessage(nameError);
        return;
      }

      const nextName = inputValue.trim();
      if (!window.confirm(`确认将 ${node.name} 重命名为 ${nextName} 吗？`)) {
        return;
      }

      const api = getCrudApi();
      const result = await api.rename({
        targetPath: node.path,
        newName: nextName,
      });

      if (rootNode?.path === node.path) {
        setRootInputPath(result.path);
        await loadRootDirectory(result.path);
      } else {
        await refreshDirectoryNode(getParentDirectoryPath(node.path));
      }

      setActiveFilePath((previousPath) => {
        if (!previousPath) {
          return previousPath;
        }

        if (node.type === "file") {
          return previousPath === node.path ? result.path : previousPath;
        }

        return isSameOrChildPath(previousPath, node.path)
          ? replacePathPrefix(previousPath, node.path, result.path)
          : previousPath;
      });
      setStatusMessage("");
    },
    [getCrudApi, loadRootDirectory, refreshDirectoryNode, rootNode],
  );

  const handleDeleteEntry = useCallback(
    async (node) => {
      const targetLabel = node.type === "directory" ? "文件夹" : "文件";
      if (!window.confirm(`确认删除${targetLabel} ${node.name} 吗？此操作不可恢复。`)) {
        return;
      }

      const api = getCrudApi();
      await api.delete({
        targetPath: node.path,
      });

      if (activeFilePath && isSameOrChildPath(activeFilePath, node.path)) {
        clearActiveFileState();
      }

      setClipboardEntry((previous) => {
        if (!previous) {
          return previous;
        }
        return isSameOrChildPath(previous.path, node.path) ? null : previous;
      });

      if (rootNode?.path === node.path) {
        setRootNode(null);
      } else {
        await refreshDirectoryNode(getParentDirectoryPath(node.path));
      }

      setStatusMessage("");
    },
    [activeFilePath, clearActiveFileState, getCrudApi, refreshDirectoryNode, rootNode],
  );

  const contextMenuItems = useMemo(() => {
    if (!contextMenu) {
      return [];
    }

    const node = contextMenu.node;
    if (contextMenu.scope === "blank") {
      return [
        { key: "new-file", label: "新建文件", disabled: false },
        { key: "new-folder", label: "新建文件夹", disabled: false },
        { key: "paste", label: "粘贴", disabled: !clipboardEntry },
      ];
    }

    if (!node) {
      return [];
    }

    if (node.type === "file") {
      return [
        { key: "copy", label: "复制", disabled: false },
        { key: "rename", label: "重命名", disabled: false },
        { key: "delete", label: "删除", disabled: false },
      ];
    }

    return [
      { key: "new-file", label: "新建文件", disabled: false },
      { key: "new-folder", label: "新建文件夹", disabled: false },
      { key: "copy", label: "复制", disabled: false },
      { key: "paste", label: "粘贴", disabled: !clipboardEntry },
      { key: "rename", label: "重命名", disabled: false },
      { key: "delete", label: "删除", disabled: false },
    ];
  }, [clipboardEntry, contextMenu]);

  const handleContextMenuAction = useCallback(
    async (actionKey) => {
      if (!contextMenu) {
        return;
      }

      const menuSnapshot = contextMenu;
      closeContextMenu();

      try {
        if (actionKey === "new-file") {
          await handleCreateEntry("file", menuSnapshot.targetDirPath);
          return;
        }

        if (actionKey === "new-folder") {
          await handleCreateEntry("directory", menuSnapshot.targetDirPath);
          return;
        }

        if (actionKey === "copy" && menuSnapshot.node) {
          setClipboardEntry({
            path: menuSnapshot.node.path,
            type: menuSnapshot.node.type,
            name: menuSnapshot.node.name,
          });
          setStatusMessage("");
          return;
        }

        if (actionKey === "paste") {
          await handlePasteEntry(menuSnapshot.targetDirPath);
          return;
        }

        if (actionKey === "rename" && menuSnapshot.node) {
          await handleRenameEntry(menuSnapshot.node);
          return;
        }

        if (actionKey === "delete" && menuSnapshot.node) {
          await handleDeleteEntry(menuSnapshot.node);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Explorer 操作失败。";
        setStatusMessage(errorMessage);
      }
    },
    [
      closeContextMenu,
      contextMenu,
      handleCreateEntry,
      handleDeleteEntry,
      handlePasteEntry,
      handleRenameEntry,
    ],
  );

  const handleResizerMouseDown = useCallback(
    (event) => {
      if (isTerminalCollapsed) {
        return;
      }

      event.preventDefault();
      setResizing(true);
    },
    [isTerminalCollapsed],
  );

  const handleOpenSettingsWindow = useCallback(async () => {
    if (!window.xaihi?.openSettingsWindow) {
      setStatusMessage("设置窗口 IPC 未就绪，请通过 Electron 启动应用。");
      return;
    }

    try {
      await window.xaihi.openSettingsWindow();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "打开设置窗口失败。";
      setStatusMessage(`打开设置失败：${errorMessage}`);
    }
  }, []);

  useEffect(() => {
    if (!apiReady) {
      setStatusMessage("当前环境未注入 IPC，请通过 Electron 启动应用。");
      return;
    }
    setStatusMessage("");
    void loadRootDirectory(defaultRootPath);
  }, [apiReady, loadRootDirectory]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void handleSaveFile();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleSaveFile]);

  useEffect(() => {
    terminalWidthRef.current = terminalWidth;
  }, [terminalWidth]);

  useEffect(() => {
    const onWindowResize = () => {
      setTerminalWidth((previous) => clampTerminalWidth(previous));
    };

    window.addEventListener("resize", onWindowResize);
    return () => window.removeEventListener("resize", onWindowResize);
  }, []);

  useEffect(() => {
    if (!isResizing) {
      return undefined;
    }

    const onMouseMove = (event) => {
      const nextWidth = clampTerminalWidth(window.innerWidth - event.clientX);
      setTerminalWidth(nextWidth);
    };

    const onMouseUp = () => {
      setResizing(false);
      localStorage.setItem(TERMINAL_WIDTH_STORAGE_KEY, String(terminalWidthRef.current));
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [isResizing]);

  useEffect(() => {
    if (!contextMenu) {
      return undefined;
    }

    const onMouseDown = (event) => {
      if (event.target instanceof Element && event.target.closest("[data-explorer-context-menu='true']")) {
        return;
      }
      closeContextMenu();
    };

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        closeContextMenu();
      }
    };

    const closeOnViewportChange = () => {
      closeContextMenu();
    };

    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", closeOnViewportChange);
    window.addEventListener("scroll", closeOnViewportChange, true);

    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", closeOnViewportChange);
      window.removeEventListener("scroll", closeOnViewportChange, true);
    };
  }, [closeContextMenu, contextMenu]);

  useEffect(() => {
    if (isExplorerCollapsed) {
      closeContextMenu();
    }
  }, [closeContextMenu, isExplorerCollapsed]);

  return (
    <div className="relative flex h-screen w-screen flex-col bg-vscode-bg text-vscode-text">
      <header className="flex h-10 items-center justify-between border-b border-vscode-border bg-[#2d2d2d] px-4 text-xs uppercase tracking-wide text-vscode-muted">
        <button
          type="button"
          className="h-7 rounded px-3 text-[11px] font-medium normal-case text-vscode-text hover:bg-vscode-hover"
          onClick={() => void handleOpenSettingsWindow()}
        >
          Options
        </button>
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-sm border border-vscode-border bg-[#3a3a3a]" />
          <span className="h-3 w-3 rounded-sm border border-vscode-border bg-[#3a3a3a]" />
          <span className="h-3 w-3 rounded-sm border border-vscode-border bg-[#3a3a3a]" />
        </div>
      </header>

      <main className="flex min-h-0 flex-1">
        <section
          className={`${
            isExplorerCollapsed ? "w-12" : "w-72"
          } flex shrink-0 flex-col border-r border-vscode-border bg-vscode-sidebar transition-all duration-200`}
        >
          <div className="flex h-10 items-center justify-between border-b border-vscode-border px-3 text-xs uppercase tracking-wider text-vscode-muted">
            {!isExplorerCollapsed && <span>Explorer</span>}
            <button
              type="button"
              className="rounded p-1 text-sm hover:bg-vscode-hover"
              onClick={() => setExplorerCollapsed((value) => !value)}
            >
              {isExplorerCollapsed ? "»" : "«"}
            </button>
          </div>
          {!isExplorerCollapsed && (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="border-b border-vscode-border p-2">
                <input
                  className="mb-2 h-8 w-full rounded border border-vscode-border bg-vscode-bg px-2 text-xs text-vscode-text outline-none focus:border-vscode-accent"
                  value={rootInputPath}
                  onChange={(event) => setRootInputPath(event.target.value)}
                  placeholder="输入 WSL 路径"
                />
                <button
                  type="button"
                  className="h-8 w-full rounded bg-vscode-accent text-xs font-medium text-white hover:brightness-110"
                  onClick={() => void loadRootDirectory(rootInputPath)}
                >
                  加载目录
                </button>
              </div>

              <div
                className="min-h-0 flex-1 overflow-auto px-2 py-2"
                onContextMenu={handleExplorerBlankContextMenu}
              >
                {rootNode ? (
                  <ExplorerNode
                    node={rootNode}
                    depth={0}
                    activeFilePath={activeFilePath}
                    onToggleDirectory={handleToggleDirectory}
                    onOpenFile={handleOpenFile}
                    onContextMenuNode={handleExplorerNodeContextMenu}
                  />
                ) : (
                  <div className="px-2 text-xs text-vscode-muted">暂无目录</div>
                )}
              </div>
            </div>
          )}
        </section>

        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-10 items-center justify-between border-b border-vscode-border bg-[#2a2d2e] px-3 text-[13px]">
            <div className="flex items-center gap-2">
              <span className="rounded bg-vscode-bg px-3 py-1 text-vscode-text">
                {activeFileName}
                {isDirty ? " *" : ""}
              </span>
              {isFileLoading && <span className="text-xs text-vscode-muted">读取中...</span>}
            </div>
            <button
              type="button"
              className={`h-7 rounded px-3 text-xs font-medium text-white ${
                isDirty && !isSaving ? "bg-vscode-accent hover:brightness-110" : "bg-[#4b4b4b]"
              }`}
              onClick={() => void handleSaveFile()}
              disabled={!isDirty || isSaving}
            >
              {isSaving ? "保存中..." : "保存"}
            </button>
          </div>
          <div className="min-h-0 flex-1">
            <MonacoEditor value={editorValue} language={activeLanguage} onChange={setEditorValue} />
          </div>
        </section>

        <div
          className={`w-1 shrink-0 border-l border-r border-vscode-border transition-colors ${
            isTerminalCollapsed
              ? "cursor-default bg-vscode-border/40"
              : "cursor-col-resize bg-vscode-border/60 hover:bg-vscode-accent"
          } ${isResizing ? "bg-vscode-accent" : ""}`}
          onMouseDown={handleResizerMouseDown}
        />

        <section
          className="flex shrink-0 flex-col border-l border-vscode-border bg-vscode-panel transition-[width] duration-150"
          style={{
            width: isTerminalCollapsed ? TERMINAL_COLLAPSED_WIDTH : terminalWidth,
          }}
        >
          <div className="flex h-10 items-center justify-between border-b border-vscode-border px-3 text-xs uppercase tracking-wider text-vscode-muted">
            {!isTerminalCollapsed && <span>Terminal</span>}
            <button
              type="button"
              className="rounded p-1 text-sm hover:bg-vscode-hover"
              onClick={() => setTerminalCollapsed((value) => !value)}
            >
              {isTerminalCollapsed ? "«" : "»"}
            </button>
          </div>
          <div
            className="min-h-0 flex-1 p-2"
            style={{ display: isTerminalCollapsed ? "none" : "block" }}
          >
            <TerminalView visible={!isTerminalCollapsed} panelWidth={terminalWidth} />
          </div>
        </section>
      </main>

      {contextMenu && (
        <div
          data-explorer-context-menu="true"
          className="fixed z-40 min-w-[176px] overflow-hidden rounded border border-vscode-border bg-[#252526] py-1 shadow-2xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onContextMenu={(event) => event.preventDefault()}
        >
          {contextMenuItems.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`flex h-8 w-full items-center px-3 text-left text-xs ${
                item.disabled
                  ? "cursor-not-allowed text-vscode-muted/60"
                  : "text-vscode-text hover:bg-vscode-hover"
              }`}
              disabled={item.disabled}
              onClick={() => void handleContextMenuAction(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}

      {!isStatusBarCollapsed && (
        <footer className="flex h-7 items-center border-t border-vscode-border bg-vscode-panel px-3 text-xs text-vscode-muted">
          {statusMessage || "无状态消息"}
        </footer>
      )}

      <button
        type="button"
        className={`absolute bottom-2 right-3 z-20 h-7 rounded border px-2 text-[11px] uppercase tracking-wide transition ${
          hasStatusError && isStatusBarCollapsed
            ? "border-red-500 bg-red-600/20 text-red-200 hover:bg-red-600/30"
            : "border-vscode-border bg-[#2d2d2d] text-vscode-muted hover:bg-vscode-hover"
        }`}
        onClick={() => setStatusBarCollapsed((value) => !value)}
      >
        {isStatusBarCollapsed ? "状态栏 ▴" : "状态栏 ▾"}
      </button>
    </div>
  );
}

export default App;
