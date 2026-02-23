import { Copy } from "lucide-react";
import { toast } from "sonner";

import type { QueryResultItem } from "~/components/query/useQueryExecution";
import { copyToClipboard } from "~/services/tauri-commands";
import { Button } from "~/components/ui/button";
import { ScrollArea } from "~/components/ui/scroll-area";

type RawJsonViewProps = {
  results: QueryResultItem[];
};

const MAX_VISIBLE_LINES = 1000;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Unable to copy results";
}

export function RawJsonView({ results }: RawJsonViewProps) {
  const allOutput = results.map((result) => result.value).join("\n");
  const visibleOutput = results
    .slice(0, MAX_VISIBLE_LINES)
    .map((result) => result.value)
    .join("\n");
  const isTruncated = results.length > MAX_VISIBLE_LINES;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-end border-b px-3 py-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            void copyToClipboard(allOutput)
              .then(() => {
                toast.success("All results copied");
              })
              .catch((error) => {
                toast.error(getErrorMessage(error));
              });
          }}
        >
          <Copy className="size-3.5" />
          Copy
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <pre className="p-3 font-mono text-xs whitespace-pre">{visibleOutput}</pre>
      </ScrollArea>

      {isTruncated ? (
        <div className="border-t px-3 py-2 text-xs text-muted-foreground">
          Showing first {MAX_VISIBLE_LINES} results. Copy includes all results.
        </div>
      ) : null}
    </div>
  );
}
