import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { expandNode } from "~/services/tauri-commands";
import type { TreeNodeInfo } from "~/types";

import {
  batchConvert,
  createLoadMoreNode,
  isLoadMoreNode,
  TREE_PAGE_SIZE,
  type TreeNode,
} from "./tree-utils";

function findNode(nodes: TreeNode[], id: string): TreeNode | null {
  for (const node of nodes) {
    if (node.id === id) {
      return node;
    }

    if (!node.children || node.children.length === 0) {
      continue;
    }

    const found = findNode(node.children, id);
    if (found) {
      return found;
    }
  }

  return null;
}

function updateNode(
  nodes: TreeNode[],
  targetId: string,
  updater: (node: TreeNode) => TreeNode,
): TreeNode[] {
  let changed = false;

  const next = nodes.map((node) => {
    if (node.id === targetId) {
      changed = true;
      return updater(node);
    }

    if (!node.children || node.children.length === 0) {
      return node;
    }

    const updatedChildren = updateNode(node.children, targetId, updater);
    if (updatedChildren !== node.children) {
      changed = true;
      return { ...node, children: updatedChildren };
    }

    return node;
  });

  return changed ? next : nodes;
}

type UseTreeDataResult = {
  treeData: TreeNode[];
  loadingNodeIds: Set<string>;
  loadChildren: (nodeId: string) => Promise<void>;
  activateNode: (nodeId: string) => Promise<void>;
};

export function useTreeData(rootNodes: TreeNodeInfo[]): UseTreeDataResult {
  const [treeData, setTreeData] = useState<TreeNode[]>(() => batchConvert(rootNodes));
  const [loadingNodeIds, setLoadingNodeIds] = useState<Set<string>>(() => new Set());
  const treeDataRef = useRef(treeData);
  const loadingNodeIdsRef = useRef(loadingNodeIds);

  useEffect(() => {
    const nextTreeData = batchConvert(rootNodes);
    treeDataRef.current = nextTreeData;
    loadingNodeIdsRef.current = new Set();
    setTreeData(nextTreeData);
    setLoadingNodeIds(new Set());
  }, [rootNodes]);

  const loadChildrenBatch = useCallback(
    async (nodeId: string, offset: number, append: boolean) => {
      if (loadingNodeIdsRef.current.has(nodeId)) {
        return;
      }

      setLoadingNodeIds((prev) => {
        const next = new Set(prev);
        next.add(nodeId);
        loadingNodeIdsRef.current = next;
        return next;
      });

      try {
        const result = await expandNode(nodeId, offset, TREE_PAGE_SIZE);
        const loadedChildren = batchConvert(result.children);
        const withPagination = result.hasMore
          ? [...loadedChildren, createLoadMoreNode(nodeId, result.offset + loadedChildren.length, result.totalChildren)]
          : loadedChildren;

        setTreeData((prev) => {
          const nextTree = updateNode(prev, nodeId, (node) => {
            if (!append || !Array.isArray(node.children)) {
              return { ...node, children: withPagination, childrenLoaded: true };
            }

            const existing = node.children.filter((child) => !isLoadMoreNode(child));
            return { ...node, children: [...existing, ...withPagination], childrenLoaded: true };
          });
          treeDataRef.current = nextTree;
          return nextTree;
        });
      } finally {
        setLoadingNodeIds((prev) => {
          const next = new Set(prev);
          next.delete(nodeId);
          loadingNodeIdsRef.current = next;
          return next;
        });
      }
    },
    [],
  );

  const loadChildren = useCallback(
    async (nodeId: string) => {
      const node = findNode(treeDataRef.current, nodeId);
      if (!node || isLoadMoreNode(node)) {
        return;
      }

      if (node.childrenLoaded) {
        return;
      }

      await loadChildrenBatch(nodeId, 0, false);
    },
    [loadChildrenBatch],
  );

  const activateNode = useCallback(
    async (nodeId: string) => {
      const node = findNode(treeDataRef.current, nodeId);
      if (!node) {
        return;
      }

      if (isLoadMoreNode(node) && node.parentId !== undefined && node.nextOffset !== undefined) {
        await loadChildrenBatch(node.parentId, node.nextOffset, true);
      }
    },
    [loadChildrenBatch],
  );

  return useMemo(
    () => ({ treeData, loadingNodeIds, loadChildren, activateNode }),
    [activateNode, loadChildren, loadingNodeIds, treeData],
  );
}
