import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import { toast } from "sonner";

import type { QueryResultItem } from "~/components/query/useQueryExecution";
import { cn } from "~/lib/utils";

type ResultListProps = {
  results: QueryResultItem[];
  isRunning: boolean;
};

const ROW_HEIGHT = 32;
const OVERSCAN = 10;

function getValueClass(valueType: string): string {
  switch (valueType) {
    case "string":
      return "text-emerald-400";
    case "number":
      return "text-sky-400";
    case "boolean":
      return "text-fuchsia-400";
    case "null":
      return "text-muted-foreground italic";
    default:
      return "text-foreground";
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Unable to copy result";
}

export function ResultList({ results, isRunning }: ResultListProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) {
      return;
    }

    const observer = new ResizeObserver(() => {
      setViewportHeight(element.clientHeight);
    });

    setViewportHeight(element.clientHeight);
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, []);

  const totalHeight = results.length * ROW_HEIGHT;

  const { startIndex, endIndex } = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const visibleRows = Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN * 2;
    const end = Math.min(results.length, start + visibleRows);
    return { startIndex: start, endIndex: end };
  }, [results.length, scrollTop, viewportHeight]);

  const visibleResults = results.slice(startIndex, endIndex);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={viewportRef}
        className="min-h-0 flex-1 overflow-auto"
        onScroll={(event: UIEvent<HTMLDivElement>) => {
          setScrollTop(event.currentTarget.scrollTop);
        }}
      >
        <div style={{ height: totalHeight, position: "relative" }}>
          {visibleResults.map((item, localIndex) => {
            const absoluteIndex = startIndex + localIndex;
            return (
              <button
                key={`${item.index}-${absoluteIndex}`}
                type="button"
                className="absolute inset-x-0 flex h-8 items-center gap-2 border-b px-3 text-left font-mono text-xs hover:bg-accent"
                style={{ top: absoluteIndex * ROW_HEIGHT }}
                onClick={() => {
                  void navigator.clipboard
                    .writeText(item.value)
                    .then(() => {
                      toast.success("Result copied");
                    })
                    .catch((error) => {
                      toast.error(getErrorMessage(error));
                    });
                }}
              >
                <span className="w-14 shrink-0 text-[10px] text-muted-foreground">#{item.index}</span>
                <span className="w-14 shrink-0 text-[10px] uppercase text-muted-foreground">
                  {item.valueType}
                </span>
                <span className={cn("truncate", getValueClass(item.valueType))}>{item.value}</span>
              </button>
            );
          })}
        </div>
      </div>

      {isRunning ? (
        <div className="flex items-center gap-1 border-t px-3 py-2 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          Loading more results...
        </div>
      ) : null}
    </div>
  );
}
