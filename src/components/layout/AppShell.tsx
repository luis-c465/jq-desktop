import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "~/components/ui/resizable";
import { Separator } from "~/components/ui/separator";
import { LoadingOverlay } from "~/components/LoadingOverlay";
import { JsonTreeViewer } from "~/components/json-tree/JsonTreeViewer";
import { useFileState } from "~/hooks/useFileState";

import { StatusBar } from "./StatusBar";
import { Toolbar } from "./Toolbar";

function PlaceholderPanel({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b px-3 py-2 text-xs text-muted-foreground">{title}</div>
      <div className="p-4 text-sm text-muted-foreground">{description}</div>
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
                <PlaceholderPanel
                  title="Query Editor"
                  description="Type a jq expression to filter, transform, and inspect the loaded JSON file."
                />
              </ResizablePanel>

              <ResizableHandle withHandle />

              <ResizablePanel defaultSize={80} minSize={25}>
                <PlaceholderPanel
                  title="Results"
                  description="Query output will stream here as structured results or raw value previews."
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
