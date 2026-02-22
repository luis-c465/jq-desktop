import { Badge } from "~/components/ui/badge";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "~/components/ui/resizable";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Separator } from "~/components/ui/separator";
import { useFileState } from "~/hooks/useFileState";

import { StatusBar } from "./StatusBar";
import { Toolbar } from "./Toolbar";

function PlaceholderPanel({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Badge variant="outline">{title}</Badge>
      </div>
      <ScrollArea className="h-full">
        <div className="p-4 text-sm text-muted-foreground">{description}</div>
      </ScrollArea>
    </div>
  );
}

export function AppShell() {
  const { fileInfo, rootNodes, isLoading, loadStatus, openFile, closeFile } = useFileState();

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

      <div className="min-h-0 flex-1">
        <ResizablePanelGroup orientation="horizontal">
          <ResizablePanel defaultSize={50} minSize={20}>
            <PlaceholderPanel
              title="JSON Tree"
              description={
                rootNodes.length > 0
                  ? `Loaded root nodes: ${rootNodes.length}`
                  : "Open a file to inspect and lazily browse JSON nodes."
              }
            />
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
      </div>

      <Separator />
      <StatusBar fileInfo={fileInfo} loadStatus={isLoading ? "Loading..." : loadStatus} />
    </div>
  );
}
