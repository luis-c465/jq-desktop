import type {
  Completion,
  CompletionContext,
  CompletionSource,
} from "@codemirror/autocomplete";
import { hoverTooltip, type Tooltip, type EditorView } from "@codemirror/view";
import { linter, type Diagnostic } from "@codemirror/lint";
import type { Extension, Text } from "@codemirror/state";

import * as lspService from "~/services/lsp-service";
import * as tauriCommands from "~/services/tauri-commands";

const HOVER_CONTAINER_CLASS = "max-w-sm p-3 text-xs text-inherit";
const HOVER_PARAGRAPH_CLASS = "mb-2 last:mb-0 whitespace-pre-wrap leading-relaxed";
const HOVER_CODE_BLOCK_CLASS =
  "mb-2 last:mb-0 overflow-x-auto rounded-md bg-background/15 px-3 py-2 font-mono text-[11px] leading-relaxed";

function getOffsetFromPosition(
  document: Text,
  position: tauriCommands.LspPosition,
): number {
  const lineNumber = Math.min(Math.max(position.line + 1, 1), document.lines);
  const line = document.line(lineNumber);
  return line.from + Math.min(Math.max(position.character, 0), line.length);
}

function mapSeverity(
  severity: number | undefined,
): Diagnostic["severity"] {
  switch (severity) {
    case 1:
      return "error";
    case 2:
      return "warning";
    case 3:
    case 4:
      return "info";
    default:
      return "error";
  }
}

const LSP_KIND_TO_TYPE: Record<number, Completion["type"]> = {
  3: "function",
  6: "variable",
};

function stripSnippetPlaceholders(value: string): string {
  return value
    .replace(/\$\{\d+:([^}]+)\}/g, "$1")
    .replace(/\$\{\d+\}/g, "")
    .replace(/\$\d+/g, "");
}

function getDocumentationText(
  documentation: tauriCommands.LspCompletionItem["documentation"],
): string | null {
  if (!documentation) {
    return null;
  }

  if (typeof documentation === "string") {
    return documentation;
  }

  return documentation.value ?? null;
}

function appendMarkdownFragment(container: HTMLElement, block: string): void {
  const trimmed = block.trim();
  if (!trimmed) {
    return;
  }

  const codeFenceMatch = /^```(?:\w+)?\n([\s\S]*?)\n```$/m.exec(trimmed);
  if (codeFenceMatch) {
    const pre = document.createElement("pre");
    pre.className = HOVER_CODE_BLOCK_CLASS;
    const code = document.createElement("code");
    code.textContent = codeFenceMatch[1] ?? "";
    pre.append(code);
    container.append(pre);
    return;
  }

  const paragraph = document.createElement("p");
  paragraph.className = "whitespace-pre-wrap";
  paragraph.textContent = trimmed;
  container.append(paragraph);
}

function documentationToInfo(markdown: string | null): Completion["info"] {
  if (!markdown) {
    return undefined;
  }

  return () => {
    const container = document.createElement("div");
    container.className = "max-w-xs p-2 space-y-2 text-xs text-inherit";

    markdown
      .split(/\n\n+/)
      .forEach((block) => {
        appendMarkdownFragment(container, block);
      });

    return container;
  };
}

function markdownToDom(markdown: string): HTMLElement {
  const container = document.createElement("div");
  container.className = HOVER_CONTAINER_CLASS;

  const lines = markdown.split(/\r?\n/);
  let inCodeBlock = false;
  let textBuffer: string[] = [];
  let codeBuffer: string[] = [];

  const flushText = () => {
    if (textBuffer.length === 0) {
      return;
    }

    const paragraph = document.createElement("p");
    paragraph.className = HOVER_PARAGRAPH_CLASS;
    paragraph.textContent = textBuffer.join("\n").trim();
    container.appendChild(paragraph);
    textBuffer = [];
  };

  const flushCode = () => {
    if (codeBuffer.length === 0) {
      return;
    }

    const pre = document.createElement("pre");
    pre.className = HOVER_CODE_BLOCK_CLASS;
    const code = document.createElement("code");
    code.textContent = codeBuffer.join("\n");
    pre.appendChild(code);
    container.appendChild(pre);
    codeBuffer = [];
  };

  for (const line of lines) {
    if (line.trimStart().startsWith("```")) {
      if (inCodeBlock) {
        flushCode();
      } else {
        flushText();
      }

      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(line);
    } else {
      textBuffer.push(line);
    }
  }

  if (inCodeBlock) {
    flushCode();
  } else {
    flushText();
  }

  return container;
}

function getHoverRange(view: EditorView, pos: number): { from: number; to: number } {
  const doc = view.state.doc;
  const content = doc.toString();
  const charMatcher = /[\w$@-]/;

  let from = pos;
  let to = pos;

  while (from > 0 && charMatcher.test(content[from - 1] ?? "")) {
    from -= 1;
  }

  while (to < content.length && charMatcher.test(content[to] ?? "")) {
    to += 1;
  }

  return { from, to };
}

export function jqHoverTooltip(documentUri: string): Extension {
  return hoverTooltip(async (view: EditorView, pos: number): Promise<Tooltip | null> => {
    const line = view.state.doc.lineAt(pos);
    const lineNumber = line.number - 1;
    const character = pos - line.from;
    const markdown = await lspService.getHover(documentUri, lineNumber, character);

    if (!markdown) {
      return null;
    }

    const { from, to } = getHoverRange(view, pos);

    return {
      pos: from,
      end: to,
      above: true,
      create() {
        const dom = markdownToDom(markdown);
        return { dom };
      },
    };
  });
}

export function jqCompletionSource(documentUri: string): CompletionSource {
  return async (context: CompletionContext) => {
    const word = context.matchBefore(/[\w$@-]*/);

    if (!context.explicit && (!word || word.from === word.to)) {
      return null;
    }

    const line = context.state.doc.lineAt(context.pos);
    const lineNumber = line.number - 1;
    const character = context.pos - line.from;

    let items: tauriCommands.LspCompletionItem[] = [];
    try {
      items = await tauriCommands.lspComplete(documentUri, lineNumber, character);
    } catch {
      return null;
    }

    const options: Completion[] = items.map((item) => {
      const lspInsertText = item.insertText ?? item.label;
      const insertText =
        item.insertTextFormat === 2 ? stripSnippetPlaceholders(lspInsertText) : lspInsertText;

      return {
        label: item.label,
        detail: item.detail ?? undefined,
        apply: insertText,
        type: item.kind ? LSP_KIND_TO_TYPE[item.kind] : undefined,
        info: documentationToInfo(getDocumentationText(item.documentation)),
      };
    });

    return {
      from: word ? word.from : context.pos,
      options,
      validFor: /[\w$@-]*/,
    };
  };
}

export function jqLintSource(
  documentUri: string,
  onDiagnosticsChange?: (diagnostics: tauriCommands.LspDiagnostic[]) => void,
) {
  return linter(
    async (view: { state: { doc: Text } }) => {
      const text = view.state.doc.toString();

      if (!text.trim()) {
        onDiagnosticsChange?.([]);
        return [];
      }

      try {
        const diagnostics = await tauriCommands.lspDidChange(documentUri, text);
        onDiagnosticsChange?.(diagnostics);

        return diagnostics.map((diagnostic): Diagnostic => {
          const from = getOffsetFromPosition(view.state.doc, diagnostic.range.start);
          const to = Math.max(from, getOffsetFromPosition(view.state.doc, diagnostic.range.end));

          return {
            from,
            to,
            message: diagnostic.message,
            severity: mapSeverity(diagnostic.severity),
            source: diagnostic.source,
          };
        });
      } catch {
        onDiagnosticsChange?.([]);
        return [];
      }
    },
    { delay: 300 },
  );
}
