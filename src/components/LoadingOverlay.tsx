type LoadingOverlayProps = {
  isVisible: boolean;
  progress: number;
  status: string;
};

function clampProgress(progress: number): number {
  return Math.max(0, Math.min(100, progress));
}

export function LoadingOverlay({ isVisible, progress, status }: LoadingOverlayProps) {
  if (!isVisible) {
    return null;
  }

  const normalizedProgress = clampProgress(progress);

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-lg border bg-card p-4 shadow-xl">
        <p className="mb-2 text-sm font-medium">Loading JSON file</p>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-primary transition-[width] duration-200 ease-out"
            style={{ width: `${normalizedProgress}%` }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
          <span>{status}</span>
          <span>{normalizedProgress}%</span>
        </div>
      </div>
    </div>
  );
}
