"use client";

/**
 * components/projects/code-editor.tsx
 *
 * Sprint 10: Thin Monaco Editor wrapper.
 *
 * Loaded only on the client via Next.js dynamic import (ssr:false).
 * Uses @monaco-editor/react which loads Monaco via @monaco-editor/loader.
 * Workers are loaded by Monaco's own AMD runtime — no webpack/turbopack
 * worker configuration required.
 *
 * Features exposed:
 *  - Syntax highlighting (no workers needed)
 *  - Line numbers
 *  - Ctrl+S / Cmd+S → onSave callback (via stable ref)
 *  - Cursor position → onCursorChange callback
 *  - Read-only mode
 *  - Configurable word-wrap toggle
 */

import { useRef, useEffect } from "react";
import dynamic from "next/dynamic";
import type { OnMount, OnChange } from "@monaco-editor/react";

// ── Monaco loaded client-only ─────────────────────────────────────────────────

const MonacoEditorInternal = dynamic(
  () => import("@monaco-editor/react"),
  {
    ssr: false,
    loading: () => (
      <div className="flex-1 flex items-center justify-center bg-[#1e1e1e] text-[#858585] text-sm select-none">
        Loading editor…
      </div>
    ),
  }
);

// ── Props ─────────────────────────────────────────────────────────────────────

export interface CodeEditorProps {
  value:           string;
  language:        string;
  readOnly?:       boolean;
  wordWrap?:       boolean;
  onChange:        (value: string) => void;
  onSave:          () => void;
  onCursorChange?: (line: number, col: number) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CodeEditor({
  value,
  language,
  readOnly   = false,
  wordWrap   = true,
  onChange,
  onSave,
  onCursorChange,
}: CodeEditorProps) {
  // Use refs so the onMount callbacks see fresh values without re-subscribing
  const saveRef        = useRef(onSave);
  const cursorRef      = useRef(onCursorChange);

  useEffect(() => { saveRef.current   = onSave; },          [onSave]);
  useEffect(() => { cursorRef.current = onCursorChange; },  [onCursorChange]);

  const handleMount: OnMount = (editor, monaco) => {
    // ── Ctrl+S / Cmd+S ───────────────────────────────────────────────────
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
      () => saveRef.current(),
    );

    // ── Cursor position tracking ─────────────────────────────────────────
    editor.onDidChangeCursorPosition((e) => {
      cursorRef.current?.(e.position.lineNumber, e.position.column);
    });
  };

  const handleChange: OnChange = (val) => {
    if (val !== undefined) onChange(val);
  };

  return (
    <MonacoEditorInternal
      height="100%"
      language={language}
      value={value}
      onChange={handleChange}
      onMount={handleMount}
      theme="vs-dark"
      options={{
        minimap:               { enabled: false },
        fontSize:              13,
        fontFamily:            "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Consolas, monospace",
        fontLigatures:         true,
        wordWrap:              wordWrap ? "on" : "off",
        scrollBeyondLastLine:  false,
        automaticLayout:       true,
        tabSize:               2,
        readOnly,
        lineNumbers:           "on",
        folding:               true,
        contextmenu:           true,
        smoothScrolling:       true,
        cursorBlinking:        "smooth",
        renderLineHighlight:   "gutter",
        overviewRulerBorder:   false,
        padding:               { top: 8, bottom: 8 },
        fixedOverflowWidgets:  true,
      }}
    />
  );
}
