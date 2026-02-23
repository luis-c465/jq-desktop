import { FileJson } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Tree, type NodeApi, type NodeRendererProps } from "react-arborist";

import { Button } from "~/components/ui/button";
import { useViewportSize } from "~/hooks/useViewportSize";
import type { TreeNodeInfo } from "~/types";

import { JsonTreeNode } from "./JsonTreeNode";
import { useTreeData } from "./useTreeData";
import type { TreeNode } from "./tree-utils";

type JsonTreeViewerProps = {
  rootNodes: TreeNodeInfo[] | null | undefined;
  fileName?: string;
  onOpenFile?: () => void;
};

export function JsonTreeViewer({ rootNodes, fileName, onOpenFile }: JsonTreeViewerProps) {
  const [containerElement, setContainerElement] = useState<HTMLDivElement | null>(null);
  const nodes = rootNodes ?? [];
  const hasData = nodes.length > 0;
  const { width, height } = useViewportSize(containerElement, hasData);
  const { treeData, loadingNodeIds, loadChildren, activateNode } = useTreeData(nodes);

  const renderNode = useMemo(
    () =>
      function RenderNode(props: NodeRendererProps<TreeNode>) {
        return <JsonTreeNode {...props} loadingNodeIds={loadingNodeIds} />;
      },
    [loadingNodeIds],
  );

  const onToggle = useCallback(
    (id: string) => {
      void loadChildren(id);
    },
    [loadChildren],
  );

  const onActivate = useCallback(
    (node: NodeApi<TreeNode>) => {
      void activateNode(node.id);
    },
    [activateNode],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2 text-xs text-muted-foreground">
        <span className="truncate">{fileName ?? "No file loaded"}</span>
        <span>{nodes.length} root nodes</span>
      </div>

      {!hasData ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-sm text-muted-foreground">
          <FileJson className="size-10" />
          <p>Open a JSON file to explore</p>
          {onOpenFile ? (
            <Button
              size="sm"
              onClick={onOpenFile}
              className="mt-2"
            >
              Open File
            </Button>
          ) : null}
        </div>
      ) : (
        <div ref={setContainerElement} className="flex-1 min-h-0 w-full">
          {width > 0 && height > 0 ? (
            <Tree<TreeNode>
              data={treeData}
              width={width}
              height={height}
              rowHeight={28}
              overscanCount={20}
              indent={20}
              disableDrag
              disableDrop
              openByDefault={false}
              onToggle={onToggle}
              onActivate={onActivate}
            >
              {renderNode}
            </Tree>
          ) : null}
        </div>
      )}
    </div>
  );
}
