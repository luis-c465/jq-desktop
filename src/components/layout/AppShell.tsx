import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "~/components/ui/resizable";
import { Separator } from "~/components/ui/separator";
import { LoadingOverlay } from "~/components/LoadingOverlay";
import { JsonTreeViewer } from "~/components/json-tree/JsonTreeViewer";
import { QueryEditor } from "~/components/query/QueryEditor";
import { useQueryExecution } from "~/components/query/useQueryExecution";
import { ResultViewer } from "~/components/results/ResultViewer";
import { useFileState } from "~/hooks/useFileState";

import { StatusBar } from "./StatusBar";
import { Toolbar } from "./Toolbar";

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
                <ResultViewer
                  isRunning={queryExecution.isRunning}
                  error={queryExecution.error}
                  results={queryExecution.results}
                  resultCount={queryExecution.resultCount}
                  elapsedMs={queryExecution.elapsedMs}
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
