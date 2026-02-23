import { autocompletion } from "@codemirror/autocomplete";
import { defaultKeymap } from "@codemirror/commands";
import { keymap } from "@codemirror/view";
import {
  Compartment,
  EditorSelection,
  EditorState,
  type Extension,
} from "@codemirror/state";
import { EditorView, placeholder } from "@codemirror/view";
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
  },
  ".cm-scroller": {
    fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
    minHeight: "96px",
  },
  ".cm-content": {
    padding: "8px 10px",
  },
  ".cm-focused": {
    outline: "none",
  },
});

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
  const editableCompartment = useRef(new Compartment()).current;

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
          onExecute();
          return true;
        },
      },
      {
        key: "Escape",
        run: () => {
          onCancel();
          return true;
        },
      },
    ]);

    const extensions: Extension[] = [
      jqLanguage(),
      editorTheme,
      keymap.of(defaultKeymap),
      runOnModEnter,
      placeholder("Type a jq expression... (e.g., .users[] | select(.age > 30))"),
      editableCompartment.of(EditorView.editable.of(!disabled)),
      autocompletion({
        activateOnTyping: true,
        override: [jqCompletionSource(DOCUMENT_URI)],
      }),
      jqHoverTooltip(DOCUMENT_URI),
      jqLintSource(DOCUMENT_URI, onDiagnosticsChange),
      EditorView.updateListener.of((update: ViewUpdate) => {
        if (update.docChanged) {
          onChange(update.state.doc.toString());
        }
      }),
      EditorView.domEventHandlers({
        keydown: (event: KeyboardEvent) => {
          if (event.key === "Escape") {
            onCancel();
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
  }, [disabled, editableCompartment, onCancel, onChange, onDiagnosticsChange, onExecute]);

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
