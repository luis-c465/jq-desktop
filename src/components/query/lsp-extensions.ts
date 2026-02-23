import type {
  Completion,
  CompletionContext,
  CompletionSource,
} from "@codemirror/autocomplete";

import * as tauriCommands from "~/services/tauri-commands";

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

function documentationToInfo(markdown: string | null): Completion["info"] {
  if (!markdown) {
    return undefined;
  }

  return () => {
    const container = document.createElement("div");
    container.className = "max-w-xs whitespace-pre-wrap text-xs";
    container.textContent = markdown;
    return container;
  };
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

    const items = await tauriCommands.lspComplete(documentUri, lineNumber, character);
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
