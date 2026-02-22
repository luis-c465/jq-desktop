import { useEffect } from "react";
import { Toaster } from "sonner";

import { ErrorBoundary } from "~/components/ErrorBoundary";
import { AppShell } from "~/components/layout/AppShell";

function App() {
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  return (
    <ErrorBoundary>
      <AppShell />
      <Toaster richColors theme="dark" position="bottom-right" />
    </ErrorBoundary>
  );
}

export default App;
