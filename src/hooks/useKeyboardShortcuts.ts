import { useEffect } from "react";

type ShortcutHandlers = {
  onOpenFile: () => void;
  onOpenHelp: () => void;
  onCloseFile: () => void;
  onExecuteQuery: () => void;
  onCancelQuery: () => void;
  focusQueryEditor: () => void;
  isQueryRunning: boolean;
};

export function useKeyboardShortcuts({
  onOpenFile,
  onOpenHelp,
  onCloseFile,
  onExecuteQuery,
  onCancelQuery,
  focusQueryEditor,
  isQueryRunning,
}: ShortcutHandlers) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isMetaOrCtrl = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();

      if (isMetaOrCtrl && key === "o") {
        event.preventDefault();
        onOpenFile();
        return;
      }

      if (event.key === "F1") {
        event.preventDefault();
        onOpenHelp();
        return;
      }

      if (isMetaOrCtrl && key === "w") {
        event.preventDefault();
        onCloseFile();
        return;
      }

      if (isMetaOrCtrl && key === "enter") {
        const target = event.target;
        if (target instanceof HTMLTextAreaElement) {
          return;
        }

        if (target instanceof HTMLElement && target.closest(".cm-editor")) {
          return;
        }

        event.preventDefault();
        focusQueryEditor();
        onExecuteQuery();
        return;
      }

      if (event.key === "Escape" && isQueryRunning) {
        event.preventDefault();
        onCancelQuery();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    focusQueryEditor,
    isQueryRunning,
    onCancelQuery,
    onCloseFile,
    onExecuteQuery,
    onOpenFile,
    onOpenHelp,
  ]);
}
