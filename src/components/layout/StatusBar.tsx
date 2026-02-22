import type { FileInfo } from "~/types";

type StatusBarProps = {
  fileInfo: FileInfo | null;
  loadStatus: string;
};

export function StatusBar({ fileInfo, loadStatus }: StatusBarProps) {
  return (
    <footer className="flex items-center gap-4 border-t px-4 py-1 text-xs text-muted-foreground">
      <span className="truncate">{fileInfo?.filePath ?? "Ready"}</span>
      <span className="ml-auto">{loadStatus}</span>
    </footer>
  );
}
