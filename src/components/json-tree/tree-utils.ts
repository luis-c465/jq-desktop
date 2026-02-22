import type { TreeNodeInfo } from "~/types";

export const TREE_PAGE_SIZE = 500;

export type TreeNode = {
  id: string;
  name: string;
  children?: TreeNode[] | null;
  data: TreeNodeInfo;
  kind?: "node" | "load-more";
  parentId?: string;
  nextOffset?: number;
};

function createPreviewLabel(totalChildren: number, nextOffset: number): string {
  const shownCount = Math.max(0, nextOffset);
  return `Loaded ${shownCount} of ${totalChildren} items`;
}

export function treeNodeInfoToTreeNode(info: TreeNodeInfo): TreeNode {
  return {
    id: info.id,
    name: info.key,
    children: info.hasChildren ? null : undefined,
    data: info,
    kind: "node",
  };
}

export function batchConvert(infos: TreeNodeInfo[]): TreeNode[] {
  return infos.map(treeNodeInfoToTreeNode);
}

export function createLoadMoreNode(
  parentId: string,
  nextOffset: number,
  totalChildren: number,
): TreeNode {
  return {
    id: `${parentId}.__load_more__.${nextOffset}`,
    name: "Load more...",
    children: undefined,
    kind: "load-more",
    parentId,
    nextOffset,
    data: {
      id: `${parentId}.__load_more__.${nextOffset}`,
      key: "Load more...",
      valueType: "meta",
      preview: createPreviewLabel(totalChildren, nextOffset),
      childCount: null,
      hasChildren: false,
    },
  };
}

export function isLoadMoreNode(node: TreeNode): boolean {
  return node.kind === "load-more";
}
