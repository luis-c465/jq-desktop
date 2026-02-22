import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "~/components/ui/resizable";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Separator } from "~/components/ui/separator";
import { LoadingOverlay } from "~/components/LoadingOverlay";
import { JsonTreeViewer } from "~/components/json-tree/JsonTreeViewer";
import { QueryEditor } from "~/components/query/QueryEditor";
import {
  useQueryExecution,
  type QueryResultItem,
} from "~/components/query/useQueryExecution";
import { useFileState } from "~/hooks/useFileState";

import { StatusBar } from "./StatusBar";
import { Toolbar } from "./Toolbar";

type ResultsPanelProps = {
  hasFileLoaded: boolean;
  isRunning: boolean;
  error: string | null;
  results: QueryResultItem[];
};

function ResultsPanel({ hasFileLoaded, isRunning, error, results }: ResultsPanelProps) {
  const hasResults = results.length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b px-3 py-2 text-xs text-muted-foreground">Results</div>

      {!hasFileLoaded ? (
        <div className="p-4 text-sm text-muted-foreground">
          Open a JSON file, run a jq query, and streamed results will appear here.
        </div>
      ) : null}

      {hasFileLoaded && !hasResults && !isRunning && !error ? (
        <div className="p-4 text-sm text-muted-foreground">No results yet.</div>
      ) : null}

      {hasFileLoaded && isRunning && !hasResults ? (
        <div className="p-4 text-sm text-muted-foreground">Waiting for results...</div>
      ) : null}

      {error ? <div className="p-4 text-sm text-destructive">{error}</div> : null}

      {hasResults ? (
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-2 p-3 font-mono text-xs">
            {results.map((result) => (
              <div key={result.index} className="rounded border bg-card p-2">
                <div className="mb-1 text-[10px] uppercase text-muted-foreground">
                  #{result.index} {result.valueType}
                </div>
                <pre className="overflow-x-auto whitespace-pre-wrap break-all">{result.value}</pre>
              </div>
            ))}
          </div>
        </ScrollArea>
      ) : null}
    </div>
  );
}

export function AppShell() {
  const {
    fileInfo,
    rootNodes,
    isLoading,
    loadProgress,
    loadStatus,
    openFile,
    closeFile,
  } = useFileState();
  const hasFileLoaded = Boolean(fileInfo?.loaded);
  const queryExecution = useQueryExecution(hasFileLoaded);

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <Toolbar
        fileInfo={fileInfo}
        isLoading={isLoading}
        onOpenFile={() => {
          void openFile();
        }}
        onCloseFile={() => {
          void closeFile();
        }}
      />

      <div className="relative min-h-0 flex-1">
        <ResizablePanelGroup orientation="horizontal">
          <ResizablePanel defaultSize={50} minSize={20}>
            <JsonTreeViewer rootNodes={rootNodes} fileName={fileInfo?.fileName} />
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize={50} minSize={25}>
            <ResizablePanelGroup orientation="vertical">
              <ResizablePanel defaultSize={20} minSize={15}>
                <QueryEditor
                  hasFileLoaded={hasFileLoaded}
                  queryExecution={queryExecution}
                />
              </ResizablePanel>

              <ResizableHandle withHandle />

              <ResizablePanel defaultSize={80} minSize={25}>
                <ResultsPanel
                  hasFileLoaded={hasFileLoaded}
                  isRunning={queryExecution.isRunning}
                  error={queryExecution.error}
                  results={queryExecution.results}
                />
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>
        </ResizablePanelGroup>

        <LoadingOverlay isVisible={isLoading} progress={loadProgress} status={loadStatus} />
      </div>

      <Separator />
      <StatusBar fileInfo={fileInfo} loadStatus={loadStatus} />
    </div>
  );
}
