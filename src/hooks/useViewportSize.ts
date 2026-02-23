import { useEffect, useState } from "react";

export type ViewportSize = {
  width: number;
  height: number;
};

export function useViewportSize(
  container: HTMLDivElement | null,
  enabled: boolean,
): ViewportSize {
  const [size, setSize] = useState<ViewportSize>({ width: 0, height: 0 });

  useEffect(() => {
    if (!enabled) {
      setSize({ width: 0, height: 0 });
      return;
    }

    if (!container) {
      setSize({ width: 0, height: 0 });
      return;
    }

    const update = () => {
      const { width, height } = container.getBoundingClientRect();
      setSize({ width, height });
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, [container, enabled]);

  return size;
}
