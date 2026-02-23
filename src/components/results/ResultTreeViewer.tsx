import { Loader2 } from "lucide-react";
import { useCallback, useMemo, useRef } from "react";
import { Tree, type NodeApi, type NodeRendererProps } from "react-arborist";

import { JsonTreeNode } from "~/components/json-tree/JsonTreeNode";
import type { TreeNode } from "~/components/json-tree/tree-utils";
import { useViewportSize } from "~/hooks/useViewportSize";
import { getResultNodeValue } from "~/services/tauri-commands";

import { useResultTreeData } from "./useResultTreeData";

const RESULT_TREE_ROOT_PATH = "$result";

type ResultTreeViewerProps = {
  resultCount: number;
  resultTreeReady: boolean;
};

export function ResultTreeViewer({ resultCount, resultTreeReady }: ResultTreeViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { treeData, loadingNodeIds, loadChildren, activateNode } = useResultTreeData(
    resultCount,
    resultTreeReady,
  );
  const hasData = resultTreeReady && resultCount > 0;
  const { width, height } = useViewportSize(containerRef, hasData);
  const isInitialLoading = hasData && treeData.length === 0 && loadingNodeIds.has(RESULT_TREE_ROOT_PATH);

  const renderNode = useMemo(
    () =>
      function RenderNode(props: NodeRendererProps<TreeNode>) {
        return (
          <JsonTreeNode
            {...props}
            loadingNodeIds={loadingNodeIds}
            getValueFn={getResultNodeValue}
          />
        );
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

  if (!hasData) {
    return null;
  }

  if (isInitialLoading) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex-1 min-h-0 w-full">
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
  );
}
