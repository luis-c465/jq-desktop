import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";

import { HelpModal } from "~/components/HelpModal";
import { JqReferenceModal } from "~/components/JqReferenceModal";
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
    openFilePath,
    closeFile,
  } = useFileState();
  const hasFileLoaded = Boolean(fileInfo?.loaded);
  const queryExecution = useQueryExecution(hasFileLoaded);
  const queryEditorRef = useRef<JqEditorHandle | null>(null);
  const lastOpenedPathRef = useRef<string | null>(null);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isJqReferenceOpen, setIsJqReferenceOpen] = useState(false);

  const openIncomingFile = useCallback(
    (path: string) => {
      if (!path.toLowerCase().endsWith(".json")) {
        return;
      }

      if (lastOpenedPathRef.current === path) {
        return;
      }

      lastOpenedPathRef.current = path;
      void openFilePath(path);
    },
    [openFilePath],
  );

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

  useEffect(() => {
    let isDisposed = false;

    const setupFileOpenListeners = async () => {
      const unlistenOpenFile = await listen<string>("open-file", (event) => {
        openIncomingFile(event.payload);
      });

      const unlistenDragDrop = await listen<unknown>("tauri://drag-drop", (event) => {
        const payload = event.payload;
        const paths = Array.isArray(payload)
          ? payload
          : payload && typeof payload === "object" && "paths" in payload
            ? (payload.paths as string[])
            : [];

        const firstPath = paths[0];
        if (firstPath) {
          openIncomingFile(firstPath);
        }
      });

      const initialPath = await tauriCommands.getInitialFile();
      if (!isDisposed && initialPath) {
        openIncomingFile(initialPath);
      }

      return () => {
        unlistenOpenFile();
        unlistenDragDrop();
      };
    };

    let teardown: (() => void) | undefined;

    void setupFileOpenListeners()
      .then((dispose) => {
        if (isDisposed) {
          dispose();
          return;
        }
        teardown = dispose;
      })
      .catch((error) => {
        console.error("Failed to setup file open listeners", error);
      });

    return () => {
      isDisposed = true;
      teardown?.();
    };
  }, [openIncomingFile]);

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
    onOpenHelp: () => {
      setIsHelpOpen(true);
    },
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
        onOpenJqReference={() => setIsJqReferenceOpen(true)}
        onOpenHelp={() => setIsHelpOpen(true)}
        onCloseFile={handleCloseFile}
      />
      <JqReferenceModal open={isJqReferenceOpen} onOpenChange={setIsJqReferenceOpen} />
      <HelpModal open={isHelpOpen} onOpenChange={setIsHelpOpen} />

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
              <ResizablePanel defaultSize={30} minSize={15}>
                <QueryEditor
                  hasFileLoaded={hasFileLoaded}
                  queryExecution={queryExecution}
                  editorRef={queryEditorRef}
                />
              </ResizablePanel>

              <ResizableHandle withHandle />

              <ResizablePanel defaultSize={70} minSize={25}>
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
