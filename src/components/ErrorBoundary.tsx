import { AlertTriangle, RefreshCcw } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

import { Button } from "~/components/ui/button";

type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
  errorMessage: string;
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      errorMessage: "",
    };
  }

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error.message,
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("Unhandled render error:", error, errorInfo);
  }

  public render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="flex h-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-lg rounded-xl border bg-card p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2 text-destructive">
            <AlertTriangle className="size-5" />
            <h1 className="text-base font-semibold">Something went wrong</h1>
          </div>
          <p className="mb-4 text-sm text-muted-foreground">
            jq-desktop hit an unexpected error while rendering.
          </p>
          <pre className="mb-5 overflow-auto rounded-md border bg-muted/30 p-3 font-mono text-xs text-destructive">
            {this.state.errorMessage || "Unknown render error"}
          </pre>
          <Button
            onClick={() => {
              window.location.reload();
            }}
          >
            <RefreshCcw className="size-4" />
            Reload
          </Button>
        </div>
      </div>
    );
  }
}
