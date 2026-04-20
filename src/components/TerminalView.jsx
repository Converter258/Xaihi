import { useEffect, useRef } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

function TerminalView() {
  const terminalElementRef = useRef(null);

  useEffect(() => {
    if (!terminalElementRef.current) {
      return undefined;
    }

    const terminal = new Terminal({
      fontFamily: '"Cascadia Mono", "Consolas", monospace',
      fontSize: 13,
      lineHeight: 1.25,
      cursorBlink: true,
      scrollback: 2000,
      theme: {
        background: "#181818",
        foreground: "#d4d4d4",
        cursor: "#d4d4d4",
        selectionBackground: "#264f78",
      },
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(terminalElementRef.current);
    const sendResize = async () => {
      fitAddon.fit();
      if (!window.xaihi?.terminal) {
        return;
      }

      try {
        await window.xaihi.terminal.resize({
          cols: terminal.cols,
          rows: terminal.rows,
        });
      } catch (error) {
        // Ignore occasional resize race conditions during mount/unmount.
      }
    };

    terminal.writeln("正在连接 WSL 终端...");
    const terminalApi = window.xaihi?.terminal;
    if (!terminalApi) {
      terminal.writeln("\r\n[错误] 未找到终端 IPC，请通过 Electron 启动应用。");
      return () => {
        terminal.dispose();
      };
    }

    const onResize = () => {
      void sendResize();
    };
    window.addEventListener("resize", onResize);

    const resizeObserver = new ResizeObserver(() => {
      void sendResize();
    });
    resizeObserver.observe(terminalElementRef.current);

    const unsubscribeData = terminalApi.onData((chunk) => {
      terminal.write(chunk);
    });
    const unsubscribeExit = terminalApi.onExit((payload) => {
      terminal.write(`\r\n\r\n[WSL 已退出] code=${payload?.exitCode ?? "unknown"}\r\n`);
    });
    const unsubscribeError = terminalApi.onError((payload) => {
      terminal.write(`\r\n\r\n[终端错误] ${payload?.message ?? "未知错误"}\r\n`);
    });

    const inputDisposable = terminal.onData((data) => {
      void terminalApi.write(data).catch((error) => {
        const message = error instanceof Error ? error.message : "发送输入失败。";
        terminal.write(`\r\n[错误] ${message}\r\n`);
      });
    });

    void terminalApi
      .start({
        cols: terminal.cols,
        rows: terminal.rows,
      })
      .then(() => sendResize())
      .catch((error) => {
        const message = error instanceof Error ? error.message : "启动终端失败。";
        terminal.write(`\r\n[错误] ${message}\r\n`);
      });

    return () => {
      window.removeEventListener("resize", onResize);
      resizeObserver.disconnect();
      inputDisposable.dispose();
      unsubscribeData();
      unsubscribeExit();
      unsubscribeError();
      void terminalApi.stop().catch(() => {});
      terminal.dispose();
    };
  }, []);

  return <div ref={terminalElementRef} className="h-full w-full rounded border border-vscode-border" />;
}

export default TerminalView;
