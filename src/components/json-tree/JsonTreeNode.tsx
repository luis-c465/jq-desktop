import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import type { NodeRendererProps } from "react-arborist";

import { cn } from "~/lib/utils";

import { isLoadMoreNode, type TreeNode } from "./tree-utils";

type JsonTreeNodeProps = NodeRendererProps<TreeNode> & {
  loadingNodeIds: Set<string>;
};

function valuePreviewClass(valueType: string): string {
  switch (valueType) {
    case "string":
      return "text-emerald-400";
    case "number":
      return "text-sky-400";
    case "boolean":
      return "text-violet-400";
    case "null":
      return "text-zinc-400 italic";
    case "array":
    case "object":
      return "text-amber-400";
    default:
      return "text-muted-foreground";
  }
}

export function JsonTreeNode({ node, style, dragHandle, loadingNodeIds }: JsonTreeNodeProps) {
  const isLoadMore = isLoadMoreNode(node.data);
  const isLoading = loadingNodeIds.has(node.id);

  if (isLoadMore) {
    return (
      <div style={style} ref={dragHandle} className="px-1">
        <button
          type="button"
          className="mx-2 flex h-7 w-full items-center rounded px-2 text-left text-xs font-medium text-primary hover:bg-accent/60"
          onClick={(event) => {
            event.stopPropagation();
            node.activate();
          }}
        >
          {node.data.name}
          <span className="ml-2 text-[11px] text-muted-foreground">{node.data.data.preview}</span>
        </button>
      </div>
    );
  }

  return (
    <div style={style} ref={dragHandle} className="px-1">
      <div
        className={cn(
          "flex h-7 items-center rounded px-2 font-mono text-xs",
          node.isSelected ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
        )}
      >
        {node.isLeaf ? (
          <span className="mr-1 inline-flex size-4 shrink-0" />
        ) : isLoading ? (
          <span className="mr-1 inline-flex size-4 shrink-0 items-center justify-center">
            <Loader2 className="size-3 animate-spin text-muted-foreground" />
          </span>
        ) : (
          <button
            type="button"
            aria-label={node.isOpen ? "Collapse node" : "Expand node"}
            className="mr-1 inline-flex size-4 shrink-0 items-center justify-center rounded-sm hover:bg-accent"
            onClick={(event) => {
              event.stopPropagation();
              node.toggle();
            }}
          >
            {node.isOpen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          </button>
        )}

        <span className="truncate text-foreground">{node.data.name}</span>
        <span className="mx-1 text-muted-foreground">:</span>
        <span className={cn("truncate", valuePreviewClass(node.data.data.valueType))}>
          {node.data.data.preview}
        </span>
      </div>
    </div>
  );
}
