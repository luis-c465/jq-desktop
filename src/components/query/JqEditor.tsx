import { autocompletion } from "@codemirror/autocomplete";
import { defaultKeymap } from "@codemirror/commands";
import { tags } from "@lezer/highlight";
import { keymap } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import {
  Compartment,
  EditorSelection,
  EditorState,
  type Extension,
} from "@codemirror/state";
import { EditorView, placeholder, tooltips } from "@codemirror/view";
import type { ViewUpdate } from "@codemirror/view";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";

import { cn } from "~/lib/utils";
import type { LspDiagnostic } from "~/services/tauri-commands";

import { jqLanguage } from "./jq-language";
import { jqCompletionSource, jqHoverTooltip, jqLintSource } from "./lsp-extensions";

const DOCUMENT_URI = "file:///query.jq";

const editorTheme = EditorView.theme({
  "&": {
    fontSize: "12px",
    color: "var(--foreground)",
    backgroundColor: "transparent",
  },
  ".cm-editor": {
    backgroundColor: "transparent",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
    minHeight: "96px",
  },
  ".cm-content": {
    padding: "8px 10px",
    caretColor: "var(--foreground)",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--foreground)",
  },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "color-mix(in oklch, var(--foreground) 20%, transparent)",
  },
  ".cm-gutters": {
    backgroundColor: "transparent",
    color: "var(--muted-foreground)",
    border: "none",
  },
  ".cm-focused": {
    outline: "none",
  },
  ".cm-tooltip-hover": {
    zIndex: "50",
    border: "none",
    borderRadius: "var(--radius-md)",
    backgroundColor: "var(--foreground)",
    color: "var(--background)",
    boxShadow: "0 10px 30px color-mix(in oklch, var(--foreground) 22%, transparent)",
  },
}, { dark: true });

const jqHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: "#ff7ab2" },
  { tag: tags.operator, color: "#9ddcff" },
  { tag: tags.string, color: "#a5d6ff" },
  { tag: tags.number, color: "#f5d547" },
  { tag: tags.standard(tags.variableName), color: "#82cfff" },
  { tag: tags.variableName, color: "#ffd580" },
  { tag: tags.comment, color: "#8b949e", fontStyle: "italic" },
]);

export type JqEditorHandle = {
  focus: () => void;
};

export type JqEditorProps = {
  value: string;
  onChange: (value: string) => void;
  onExecute: () => void;
  onCancel: () => void;
  disabled: boolean;
  isValid: boolean | null;
  onDiagnosticsChange?: (diagnostics: LspDiagnostic[]) => void;
  className?: string;
};

export const JqEditor = forwardRef<JqEditorHandle, JqEditorProps>(function JqEditor(
  {
    value,
    onChange,
    onExecute,
    onCancel,
    disabled,
    isValid,
    onDiagnosticsChange,
    className,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onExecuteRef = useRef(onExecute);
  const onCancelRef = useRef(onCancel);
  const onDiagnosticsChangeRef = useRef(onDiagnosticsChange);
  const editableCompartment = useRef(new Compartment()).current;

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onExecuteRef.current = onExecute;
  }, [onExecute]);

  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    onDiagnosticsChangeRef.current = onDiagnosticsChange;
  }, [onDiagnosticsChange]);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        editorRef.current?.focus();
      },
    }),
    [],
  );

  useEffect(() => {
    if (!containerRef.current || editorRef.current) {
      return;
    }

    const runOnModEnter = keymap.of([
      {
        key: "Mod-Enter",
        run: () => {
          onExecuteRef.current();
          return true;
        },
      },
      {
        key: "Escape",
        run: () => {
          onCancelRef.current();
          return true;
        },
      },
    ]);

    const handleDiagnostics = (diagnostics: LspDiagnostic[]) => {
      onDiagnosticsChangeRef.current?.(diagnostics);
    };

    const extensions: Extension[] = [
      jqLanguage(),
      syntaxHighlighting(jqHighlightStyle),
      editorTheme,
      runOnModEnter,
      keymap.of(defaultKeymap),
      placeholder("Type a jq expression... (e.g., .users[] | select(.age > 30))"),
      editableCompartment.of(EditorView.editable.of(!disabled)),
      tooltips({ parent: document.body }),
      autocompletion({
        activateOnTyping: true,
        override: [jqCompletionSource(DOCUMENT_URI)],
      }),
      jqHoverTooltip(DOCUMENT_URI),
      jqLintSource(DOCUMENT_URI, handleDiagnostics),
      EditorView.updateListener.of((update: ViewUpdate) => {
        if (update.docChanged) {
          onChangeRef.current(update.state.doc.toString());
        }
      }),
      EditorView.domEventHandlers({
        keydown: (event: KeyboardEvent) => {
          if (event.key === "Escape") {
            onCancelRef.current();
          }
        },
      }),
    ];

    const initialState = EditorState.create({
      doc: value,
      extensions,
    });

    editorRef.current = new EditorView({
      state: initialState,
      parent: containerRef.current,
    });

    return () => {
      editorRef.current?.destroy();
      editorRef.current = null;
    };
  }, [disabled, editableCompartment]);

  useEffect(() => {
    const view = editorRef.current;
    if (!view) {
      return;
    }

    const currentValue = view.state.doc.toString();
    if (value === currentValue) {
      return;
    }

    const selection = view.state.selection.main;
    const nextSelection = EditorSelection.single(
      Math.min(selection.anchor, value.length),
      Math.min(selection.head, value.length),
    );

    view.dispatch({
      changes: { from: 0, to: currentValue.length, insert: value },
      selection: nextSelection,
    });
  }, [value]);

  useEffect(() => {
    const view = editorRef.current;
    if (!view) {
      return;
    }

    view.dispatch({
      effects: editableCompartment.reconfigure(EditorView.editable.of(!disabled)),
    });
  }, [disabled, editableCompartment]);

  return (
    <div
      className={cn(
        "rounded-md border bg-transparent",
        disabled && "cursor-not-allowed opacity-70",
        isValid === true && "border-green-500",
        isValid === false && "border-destructive",
        className,
      )}
    >
      <div ref={containerRef} />
    </div>
  );
});
