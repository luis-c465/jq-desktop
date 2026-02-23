import * as tauriCommands from "~/services/tauri-commands";

export function hoverContentToMarkdown(content: tauriCommands.LspHoverContent): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : part.value ?? ""))
      .filter(Boolean)
      .join("\n\n");
  }

  return content.value ?? "";
}

export async function getHover(
  uri: string,
  line: number,
  character: number,
): Promise<string | null> {
  const result = await tauriCommands.lspHover(uri, line, character);

  if (!result) {
    return null;
  }

  const markdown = hoverContentToMarkdown(result.contents).trim();
  return markdown.length > 0 ? markdown : null;
}
