import { useEffect } from "react";
import { Toaster } from "sonner";

import { ErrorBoundary } from "~/components/ErrorBoundary";
import { AppShell } from "~/components/layout/AppShell";

function App() {
  useEffect(() => {
    document.documentElement.classList.add("dark");

    const disableContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };

    window.addEventListener("contextmenu", disableContextMenu);
    return () => {
      window.removeEventListener("contextmenu", disableContextMenu);
    };
  }, []);

  return (
    <ErrorBoundary>
      <AppShell />
      <Toaster richColors theme="dark" position="bottom-right" />
    </ErrorBoundary>
  );
}

export default App;
