import { useEffect, useRef } from "react";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

function getWorker(_, label) {
  if (label === "json") {
    return new jsonWorker();
  }
  if (label === "css" || label === "scss" || label === "less") {
    return new cssWorker();
  }
  if (label === "html" || label === "handlebars" || label === "razor") {
    return new htmlWorker();
  }
  if (label === "typescript" || label === "javascript") {
    return new tsWorker();
  }
  return new editorWorker();
}

if (!self.MonacoEnvironment) {
  self.MonacoEnvironment = { getWorker };
}

function MonacoEditor({ value, language, onChange }) {
  const containerRef = useRef(null);
  const editorRef = useRef(null);
  const modelRef = useRef(null);
  const changeDisposableRef = useRef(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!containerRef.current) {
      return undefined;
    }

    modelRef.current = monaco.editor.createModel(value ?? "", language ?? "plaintext");
    editorRef.current = monaco.editor.create(containerRef.current, {
      model: modelRef.current,
      theme: "vs-dark",
      automaticLayout: true,
      fontSize: 14,
      lineHeight: 22,
      minimap: { enabled: false },
      smoothScrolling: true,
      scrollBeyondLastLine: false,
      fontFamily: '"Cascadia Code", "Fira Code", monospace',
      padding: { top: 12 },
    });

    changeDisposableRef.current = editorRef.current.onDidChangeModelContent(() => {
      if (typeof onChangeRef.current === "function") {
        onChangeRef.current(editorRef.current?.getValue() ?? "");
      }
    });

    return () => {
      changeDisposableRef.current?.dispose();
      editorRef.current?.dispose();
      modelRef.current?.dispose();
    };
  }, []);

  useEffect(() => {
    if (!modelRef.current) {
      return;
    }

    const nextValue = value ?? "";
    if (modelRef.current.getValue() !== nextValue) {
      modelRef.current.setValue(nextValue);
    }
  }, [value]);

  useEffect(() => {
    if (!modelRef.current) {
      return;
    }
    monaco.editor.setModelLanguage(modelRef.current, language ?? "plaintext");
  }, [language]);

  return <div ref={containerRef} className="h-full w-full" />;
}

export default MonacoEditor;
