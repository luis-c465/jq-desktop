import { Loader2, Play, Square } from "lucide-react";
import type { RefObject } from "react";

import { JqEditor, type JqEditorHandle } from "~/components/query/JqEditor";
import { Button } from "~/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";

import type { UseQueryExecutionReturn } from "./useQueryExecution";

type QueryEditorProps = {
  hasFileLoaded: boolean;
  queryExecution: UseQueryExecutionReturn;
  editorRef?: RefObject<JqEditorHandle | null>;
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
  editorRef,
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
    setDiagnostics,
    executeQuery,
    cancelExecution,
  } = queryExecution;

  const runDisabled = !hasFileLoaded || !query.trim() || isValid === false || isRunning;
  const statusText = getStatusText(hasFileLoaded, isRunning, error, resultCount, elapsedMs);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b px-3 py-2 text-xs text-muted-foreground">Query Editor</div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
        <JqEditor
          ref={editorRef}
          value={query}
          onChange={(nextQuery) => {
            setQuery(nextQuery);
          }}
          onExecute={() => {
            void executeQuery();
          }}
          onCancel={() => {
            if (!isRunning) {
              return;
            }

            void cancelExecution();
          }}
          onDiagnosticsChange={setDiagnostics}
          disabled={!hasFileLoaded}
          isValid={isValid}
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
