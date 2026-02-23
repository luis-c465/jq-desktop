import { ChevronDown, ChevronRight, Copy, CopyCheck, Loader2 } from "lucide-react";
import type { MouseEvent } from "react";
import type { NodeRendererProps } from "react-arborist";
import { toast } from "sonner";

import { cn } from "~/lib/utils";
import { getNodeValue } from "~/services/tauri-commands";

import { isLoadMoreNode, type TreeNode } from "./tree-utils";

type JsonTreeNodeProps = NodeRendererProps<TreeNode> & {
  loadingNodeIds: Set<string>;
  getValueFn?: (path: string) => Promise<string>;
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

export function JsonTreeNode({
  node,
  style,
  dragHandle,
  loadingNodeIds,
  getValueFn,
}: JsonTreeNodeProps) {
  const isLoadMore = isLoadMoreNode(node.data);
  const isLoading = loadingNodeIds.has(node.id);

  if (isLoadMore) {
    return (
      <div style={style} ref={dragHandle} className="px-1">
        <button
          type="button"
          className="mx-2 flex h-7 w-full items-center rounded px-2 text-left text-xs font-medium text-primary hover:bg-accent/60"
          onClick={(event: MouseEvent<HTMLButtonElement>) => {
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
          "group flex h-7 items-center rounded px-2 font-mono text-xs",
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
            onClick={(event: MouseEvent<HTMLButtonElement>) => {
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

        <div className="ml-auto hidden items-center gap-1 group-hover:flex">
          <button
            type="button"
            className="inline-flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent"
            title="Copy JSON path"
            onClick={(event: MouseEvent<HTMLButtonElement>) => {
              event.stopPropagation();
              void navigator.clipboard
                .writeText(node.data.data.id)
                .then(() => {
                  toast.success("Path copied to clipboard", { duration: 3000 });
                })
                .catch(() => {
                  toast.error("Unable to copy path", { duration: 3000 });
                });
            }}
          >
            <Copy className="size-3" />
          </button>

          <button
            type="button"
            className="inline-flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent"
            title="Copy value"
            onClick={(event: MouseEvent<HTMLButtonElement>) => {
              event.stopPropagation();
              void (getValueFn ?? getNodeValue)(node.data.data.id)
                .then((value) => navigator.clipboard.writeText(value))
                .then(() => {
                  toast.success("Value copied to clipboard", { duration: 3000 });
                })
                .catch((error: unknown) => {
                  const message =
                    error instanceof Error && error.message
                      ? error.message
                      : "Unable to copy value";
                  toast.error(message, { duration: 3000 });
                });
            }}
          >
            <CopyCheck className="size-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
