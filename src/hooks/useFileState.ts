import { useCallback, useState } from "react";

import type { FileInfo, TreeNodeInfo } from "~/types";

type ProgressUpdate = {
  progress: number;
  status: string;
};

export function useFileState() {
  const [fileInfo, setFileInfo] = useState<FileInfo | null>(null);
  const [rootNodes, setRootNodes] = useState<TreeNodeInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [loadStatus, setLoadStatus] = useState("Ready");
  const [error, setError] = useState<string | null>(null);

  const openFile = useCallback(async () => {
    setError(null);
  }, []);

  const closeFile = useCallback(async () => {
    setFileInfo(null);
    setRootNodes([]);
    setIsLoading(false);
    setLoadProgress(0);
    setLoadStatus("Ready");
    setError(null);
  }, []);

  const setProgress = useCallback(({ progress, status }: ProgressUpdate) => {
    setLoadProgress(progress);
    setLoadStatus(status);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    fileInfo,
    rootNodes,
    isLoading,
    loadProgress,
    loadStatus,
    error,
    openFile,
    closeFile,
    setProgress,
    setError,
    clearError,
    setFileInfo,
    setRootNodes,
    setIsLoading,
  };
}
