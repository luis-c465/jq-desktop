import { Code2, Copy, List, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import type { QueryResultItem } from "~/components/query/useQueryExecution";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

import { RawJsonView } from "./RawJsonView";
import { ResultList } from "./ResultList";

type ResultViewerProps = {
  results: QueryResultItem[];
  isRunning: boolean;
  resultCount: number;
  elapsedMs: number | null;
  error: string | null;
};

type ViewMode = "list" | "raw";

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
        <div className="m-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 font-mono text-xs text-destructive">
          {error}
        </div>
      ) : null}

      {!error && results.length === 0 && !isRunning ? (
        <div className="flex min-h-0 flex-1 items-center justify-center px-4 text-sm text-muted-foreground">
          Run a jq query to see results
        </div>
      ) : null}

      {!error && results.length > 0 ? (
        <div className={cn("min-h-0 flex-1", viewMode === "raw" && "bg-card")}>
          {viewMode === "list" ? (
            <ResultList results={results} isRunning={isRunning} />
          ) : (
            <RawJsonView results={results} />
          )}
        </div>
      ) : null}
    </div>
  );
}
