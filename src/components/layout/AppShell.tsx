import { useCallback, useEffect, useRef } from "react";

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "~/components/ui/resizable";
import { Separator } from "~/components/ui/separator";
import { LoadingOverlay } from "~/components/LoadingOverlay";
import { JsonTreeViewer } from "~/components/json-tree/JsonTreeViewer";
import type { JqEditorHandle } from "~/components/query/JqEditor";
import { QueryEditor } from "~/components/query/QueryEditor";
import { useQueryExecution } from "~/components/query/useQueryExecution";
import { ResultViewer } from "~/components/results/ResultViewer";
import { useFileState } from "~/hooks/useFileState";
import { useKeyboardShortcuts } from "~/hooks/useKeyboardShortcuts";
import * as tauriCommands from "~/services/tauri-commands";

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
  const queryEditorRef = useRef<JqEditorHandle | null>(null);

  useEffect(() => {
    void tauriCommands.lspInitialize().catch((error) => {
      console.error("Failed to initialize jq-lsp", error);
    });

    return () => {
      void tauriCommands.lspShutdown().catch((error) => {
        console.error("Failed to shutdown jq-lsp", error);
      });
    };
  }, []);

  const handleOpenFile = useCallback(() => {
    void openFile();
  }, [openFile]);

  const handleCloseFile = useCallback(() => {
    void (async () => {
      if (queryExecution.isRunning) {
        await queryExecution.cancelExecution();
      }
      queryExecution.reset();
      await closeFile();
    })();
  }, [closeFile, queryExecution]);

  useKeyboardShortcuts({
    onOpenFile: handleOpenFile,
    onCloseFile: handleCloseFile,
    onExecuteQuery: () => {
      void queryExecution.executeQuery();
    },
    onCancelQuery: () => {
      void queryExecution.cancelExecution();
    },
    focusQueryEditor: () => {
      queryEditorRef.current?.focus();
    },
    isQueryRunning: queryExecution.isRunning,
  });

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <Toolbar
        fileInfo={fileInfo}
        isLoading={isLoading}
        onOpenFile={handleOpenFile}
        onCloseFile={handleCloseFile}
      />

      <div className="relative min-h-0 flex-1">
        <ResizablePanelGroup orientation="horizontal">
          <ResizablePanel defaultSize={50} minSize={20}>
            <JsonTreeViewer
              rootNodes={rootNodes}
              fileName={fileInfo?.fileName}
              onOpenFile={handleOpenFile}
            />
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize={50} minSize={25}>
            <ResizablePanelGroup orientation="vertical">
              <ResizablePanel defaultSize={20} minSize={15}>
                <QueryEditor
                  hasFileLoaded={hasFileLoaded}
                  queryExecution={queryExecution}
                  editorRef={queryEditorRef}
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
                  resultTreeReady={queryExecution.resultTreeReady}
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
