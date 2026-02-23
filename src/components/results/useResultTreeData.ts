import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { expandResultNode } from "~/services/tauri-commands";

import {
  batchConvert,
  createLoadMoreNode,
  isLoadMoreNode,
  TREE_PAGE_SIZE,
  type TreeNode,
} from "../json-tree/tree-utils";

const RESULT_TREE_ROOT_PATH = "$result";

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

type UseResultTreeDataReturn = {
  treeData: TreeNode[];
  loadingNodeIds: Set<string>;
  loadChildren: (nodeId: string) => Promise<void>;
  activateNode: (nodeId: string) => Promise<void>;
};

export function useResultTreeData(
  resultCount: number,
  resultTreeReady: boolean,
): UseResultTreeDataReturn {
  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  const [loadingNodeIds, setLoadingNodeIds] = useState<Set<string>>(() => new Set());
  const treeDataRef = useRef(treeData);
  const loadingNodeIdsRef = useRef(loadingNodeIds);
  const runIdRef = useRef(0);

  useEffect(() => {
    runIdRef.current += 1;
    const currentRunId = runIdRef.current;

    if (!resultTreeReady || resultCount === 0) {
      treeDataRef.current = [];
      loadingNodeIdsRef.current = new Set();
      setTreeData([]);
      setLoadingNodeIds(new Set());
      return;
    }

    setLoadingNodeIds((prev) => {
      const next = new Set(prev);
      next.add(RESULT_TREE_ROOT_PATH);
      loadingNodeIdsRef.current = next;
      return next;
    });

    void (async () => {
      try {
        const result = await expandResultNode(RESULT_TREE_ROOT_PATH, 0, TREE_PAGE_SIZE);
        if (runIdRef.current !== currentRunId) {
          return;
        }

        const rootNodes = batchConvert(result.children);
        const withPagination = result.hasMore
          ? [
              ...rootNodes,
              createLoadMoreNode(
                RESULT_TREE_ROOT_PATH,
                result.offset + rootNodes.length,
                result.totalChildren,
              ),
            ]
          : rootNodes;

        treeDataRef.current = withPagination;
        setTreeData(withPagination);
      } finally {
        if (runIdRef.current !== currentRunId) {
          return;
        }

        setLoadingNodeIds((prev) => {
          const next = new Set(prev);
          next.delete(RESULT_TREE_ROOT_PATH);
          loadingNodeIdsRef.current = next;
          return next;
        });
      }
    })();
  }, [resultCount, resultTreeReady]);

  const loadChildrenBatch = useCallback(
    async (nodeId: string, offset: number, append: boolean) => {
      if (!resultTreeReady || loadingNodeIdsRef.current.has(nodeId)) {
        return;
      }

      const currentRunId = runIdRef.current;

      setLoadingNodeIds((prev) => {
        const next = new Set(prev);
        next.add(nodeId);
        loadingNodeIdsRef.current = next;
        return next;
      });

      try {
        const result = await expandResultNode(nodeId, offset, TREE_PAGE_SIZE);
        if (runIdRef.current !== currentRunId) {
          return;
        }

        const loadedChildren = batchConvert(result.children);
        const withPagination = result.hasMore
          ? [
              ...loadedChildren,
              createLoadMoreNode(nodeId, result.offset + loadedChildren.length, result.totalChildren),
            ]
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
        if (runIdRef.current !== currentRunId) {
          return;
        }

        setLoadingNodeIds((prev) => {
          const next = new Set(prev);
          next.delete(nodeId);
          loadingNodeIdsRef.current = next;
          return next;
        });
      }
    },
    [resultTreeReady],
  );

  const loadChildren = useCallback(
    async (nodeId: string) => {
      if (!resultTreeReady) {
        return;
      }

      const node = findNode(treeDataRef.current, nodeId);
      if (!node || isLoadMoreNode(node)) {
        return;
      }

      if (node.childrenLoaded) {
        return;
      }

      await loadChildrenBatch(nodeId, 0, false);
    },
    [loadChildrenBatch, resultTreeReady],
  );

  const activateNode = useCallback(
    async (nodeId: string) => {
      if (!resultTreeReady) {
        return;
      }

      const node = findNode(treeDataRef.current, nodeId);
      if (!node) {
        return;
      }

      if (isLoadMoreNode(node) && node.parentId !== undefined && node.nextOffset !== undefined) {
        await loadChildrenBatch(node.parentId, node.nextOffset, true);
      }
    },
    [loadChildrenBatch, resultTreeReady],
  );

  return useMemo(
    () => ({ treeData, loadingNodeIds, loadChildren, activateNode }),
    [activateNode, loadChildren, loadingNodeIds, treeData],
  );
}
