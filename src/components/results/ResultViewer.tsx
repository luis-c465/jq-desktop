import { AlertCircle, Code2, Copy, List, Loader2, Search, TreePine } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import type { QueryResultItem } from "~/components/query/useQueryExecution";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

import { RawJsonView } from "./RawJsonView";
import { ResultList } from "./ResultList";
import { ResultTreeViewer } from "./ResultTreeViewer";

type ResultViewerProps = {
  results: QueryResultItem[];
  isRunning: boolean;
  resultCount: number;
  elapsedMs: number | null;
  error: string | null;
  resultTreeReady?: boolean;
};

type ViewMode = "list" | "raw" | "tree";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Unable to copy results";
}

export function ResultViewer({
  results,
  isRunning,
  resultCount,
  elapsedMs,
  error,
  resultTreeReady = false,
}: ResultViewerProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("list");

  const summaryText = useMemo(() => {
    if (isRunning && resultCount === 0) {
      return "Running query...";
    }

    if (elapsedMs !== null && resultCount > 0) {
      return `${resultCount} results in ${elapsedMs}ms`;
    }

    if (isRunning) {
      return `${resultCount} results so far`;
    }

    return `${resultCount} results`;
  }, [elapsedMs, isRunning, resultCount]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <div className="text-xs text-muted-foreground">{summaryText}</div>

        {isRunning ? <Loader2 className="size-3 animate-spin text-muted-foreground" /> : null}

        <div className="ml-auto flex items-center gap-1">
          <Button
            size="sm"
            variant={viewMode === "list" ? "secondary" : "ghost"}
            onClick={() => {
              setViewMode("list");
            }}
          >
            <List className="size-3.5" />
            List
          </Button>

          <Button
            size="sm"
            variant={viewMode === "raw" ? "secondary" : "ghost"}
            onClick={() => {
              setViewMode("raw");
            }}
          >
            <Code2 className="size-3.5" />
            Raw
          </Button>

          <Button
            size="sm"
            variant={viewMode === "tree" ? "secondary" : "ghost"}
            onClick={() => {
              setViewMode("tree");
            }}
          >
            <TreePine className="size-3.5" />
            Tree
          </Button>

          <Button
            size="sm"
            variant="ghost"
            disabled={results.length === 0}
            onClick={() => {
              const output = results.map((result) => result.value).join("\n");
              void navigator.clipboard
                .writeText(output)
                .then(() => {
                  toast.success("All results copied");
                })
                .catch((copyError) => {
                  toast.error(getErrorMessage(copyError));
                });
            }}
          >
            <Copy className="size-3.5" />
            Copy All
          </Button>
        </div>
      </div>

      {error ? (
        <div className="m-3 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0">
            <p className="text-xs font-medium">Query failed</p>
            <p className="font-mono text-xs break-all">{error}</p>
          </div>
        </div>
      ) : null}

      {!error && results.length === 0 && !isRunning ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 text-sm text-muted-foreground">
          <Search className="size-8" />
          <p>Run a jq query to see results</p>
        </div>
      ) : null}

      {!error && results.length > 0 ? (
        <div className="min-h-0 flex-1">
          <div className={cn("h-full min-h-0", viewMode !== "list" && "hidden")}>
            <ResultList results={results} isRunning={isRunning} />
          </div>

          <div className={cn("h-full min-h-0", viewMode !== "raw" && "hidden", "bg-card")}>
            <RawJsonView results={results} />
          </div>

          <div className={cn("h-full min-h-0", viewMode !== "tree" && "hidden")}>
            <ResultTreeViewer resultCount={resultCount} resultTreeReady={resultTreeReady} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
