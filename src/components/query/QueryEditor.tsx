import { Loader2, Play, Square } from "lucide-react";
import type { ChangeEvent, KeyboardEvent, RefObject } from "react";

import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";

import type { UseQueryExecutionReturn } from "./useQueryExecution";

type QueryEditorProps = {
  hasFileLoaded: boolean;
  queryExecution: UseQueryExecutionReturn;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
};

function getStatusText(
  hasFileLoaded: boolean,
  isRunning: boolean,
  error: string | null,
  resultCount: number,
  elapsedMs: number | null,
): string {
  if (!hasFileLoaded) {
    return "Open a JSON file to run queries";
  }

  if (isRunning) {
    return "Running...";
  }

  if (error) {
    return error;
  }

  if (resultCount > 0 && elapsedMs !== null) {
    return `${resultCount} results in ${elapsedMs}ms`;
  }

  return "Press Ctrl+Enter to run";
}

export function QueryEditor({
  hasFileLoaded,
  queryExecution,
  textareaRef,
}: QueryEditorProps) {
  const {
    query,
    isValid,
    validationError,
    isRunning,
    resultCount,
    elapsedMs,
    error,
    setQuery,
    executeQuery,
    cancelExecution,
  } = queryExecution;

  const runDisabled = !hasFileLoaded || !query.trim() || isValid === false || isRunning;
  const statusText = getStatusText(hasFileLoaded, isRunning, error, resultCount, elapsedMs);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b px-3 py-2 text-xs text-muted-foreground">Query Editor</div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
        <Textarea
          ref={textareaRef}
          value={query}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
            setQuery(event.target.value);
          }}
          onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              void executeQuery();
            }

            if (event.key === "Escape" && isRunning) {
              event.preventDefault();
              void cancelExecution();
            }
          }}
          rows={4}
          disabled={!hasFileLoaded}
          className={cn(
            "font-mono text-xs",
            !hasFileLoaded && "cursor-not-allowed opacity-70",
            isValid === true &&
              "border-green-500 focus-visible:border-green-500 focus-visible:ring-green-500/30",
            isValid === false &&
              "border-destructive focus-visible:border-destructive focus-visible:ring-destructive/30",
          )}
          placeholder={
            hasFileLoaded
              ? "Type a jq expression... (e.g., .users[] | select(.age > 30))"
              : "Load a file first"
          }
        />

        {validationError ? (
          <p className="font-mono text-xs text-destructive">{validationError}</p>
        ) : null}

        <div className="flex items-center gap-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  onClick={() => {
                    void executeQuery();
                  }}
                  disabled={runDisabled}
                >
                  <Play className="size-3.5" />
                  Run
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Execute query (Ctrl+Enter)</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {isRunning ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                void cancelExecution();
              }}
            >
              <Square className="size-3.5" />
              Cancel
            </Button>
          ) : null}

          <div
            className={cn(
              "ml-auto flex items-center gap-1 text-xs text-muted-foreground",
              error && "text-destructive",
            )}
          >
            {isRunning ? <Loader2 className="size-3 animate-spin" /> : null}
            <span>{statusText}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
