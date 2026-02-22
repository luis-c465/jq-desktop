import { useEffect } from "react";
import { Toaster } from "sonner";

import { AppShell } from "~/components/layout/AppShell";

function App() {
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  return (
    <>
      <AppShell />
      <Toaster richColors theme="dark" position="bottom-right" />
    </>
  );
}

export default App;
