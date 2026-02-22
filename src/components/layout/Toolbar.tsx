import { FileJson, X } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import type { FileInfo } from "~/types";

type ToolbarProps = {
  fileInfo: FileInfo | null;
  isLoading: boolean;
  onOpenFile: () => void;
  onCloseFile: () => void;
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let size = bytes / 1024;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 100 ? 0 : 1)} ${units[unitIndex]}`;
}

export function Toolbar({
  fileInfo,
  isLoading,
  onOpenFile,
  onCloseFile,
}: ToolbarProps) {
  return (
    <header className="flex items-center gap-3 border-b px-4 py-2">
      <Button onClick={onOpenFile} disabled={isLoading}>
        <FileJson className="size-4" />
        Open File
      </Button>

      <div className="flex min-w-0 items-center gap-2 text-sm">
        <span className="truncate text-muted-foreground">
          {fileInfo?.fileName ?? "No file loaded"}
        </span>
        {fileInfo ? (
          <Badge variant="secondary">{formatFileSize(fileInfo.fileSize)}</Badge>
        ) : null}
      </div>

      <div className="ml-auto">
        <Button
          variant="ghost"
          size="sm"
          disabled={!fileInfo || isLoading}
          onClick={onCloseFile}
        >
          <X className="size-4" />
          Close
        </Button>
      </div>
    </header>
  );
}
