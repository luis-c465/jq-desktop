import { useCallback, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";

import * as tauriCommands from "~/services/tauri-commands";
import type { FileInfo, LoadProgress, TreeNodeInfo } from "~/types";

type ProgressUpdate = {
  progress: number;
  status: string;
};

const LARGE_FILE_WARNING_BYTES = 500 * 1024 * 1024;

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function useFileState() {
  const [fileInfo, setFileInfo] = useState<FileInfo | null>(null);
  const [rootNodes, setRootNodes] = useState<TreeNodeInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [loadStatus, setLoadStatus] = useState("Ready");
  const [error, setError] = useState<string | null>(null);

  const openFile = useCallback(async () => {
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "JSON Files", extensions: ["json"] }],
    });

    if (!selected) {
      return;
    }

    const path = Array.isArray(selected) ? selected[0] : selected;
    if (!path) {
      return;
    }

    try {
      const size = await tauriCommands.getFileSize(path);
      if (size > LARGE_FILE_WARNING_BYTES) {
        toast.warning(`Large file (${formatMegabytes(size)}). Loading may take a while.`, {
          duration: 3000,
        });
      }
    } catch {
      // Best-effort warning check.
    }

    let didReceiveChannelError = false;

    setError(null);
    setIsLoading(true);
    setLoadProgress(0);
    setLoadStatus("Reading file...");

    try {
      await tauriCommands.loadFile(path, (progressMessage: LoadProgress) => {
        switch (progressMessage.type) {
          case "Reading": {
            const progress =
              progressMessage.totalBytes > 0
                ? Math.round((progressMessage.bytesRead / progressMessage.totalBytes) * 100)
                : 0;
            setLoadProgress(progress);
            setLoadStatus(`Reading file... ${progress}%`);
            break;
          }
          case "Parsing": {
            setLoadProgress(100);
            setLoadStatus("Parsing JSON...");
            break;
          }
          case "Complete": {
            setRootNodes(progressMessage.rootNodes ?? []);
            setFileInfo({
              fileName: progressMessage.fileName,
              filePath: path,
              fileSize: progressMessage.fileSize,
              loaded: true,
            });
            setLoadProgress(100);
            setLoadStatus(`Loaded ${progressMessage.fileName}`);
            setError(null);
            break;
          }
          case "Error": {
            didReceiveChannelError = true;
            setError(progressMessage.message);
            setLoadStatus("Load failed");
            toast.error(progressMessage.message, { duration: 3000 });
            break;
          }
          default: {
            break;
          }
        }
      });
    } catch (error) {
      if (!didReceiveChannelError) {
        const message = error instanceof Error ? error.message : "Failed to load file";
        setError(message);
        setLoadStatus("Load failed");
        toast.error(message, { duration: 3000 });
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  const closeFile = useCallback(async () => {
    try {
      await tauriCommands.closeFile();
      setFileInfo(null);
      setRootNodes([]);
      setIsLoading(false);
      setLoadProgress(0);
      setLoadStatus("Ready");
      setError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to close file";
      setError(message);
      toast.error(message, { duration: 3000 });
    }
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
