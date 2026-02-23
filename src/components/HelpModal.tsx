import { Kbd } from "~/components/ui/kbd";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";

type HelpModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type Shortcut = {
  action: string;
  keys: string[];
};

const shortcuts: Shortcut[] = [
  { action: "Open JSON file", keys: ["Ctrl", "O"] },
  { action: "Close file", keys: ["Ctrl", "W"] },
  { action: "Run query", keys: ["Ctrl", "Enter"] },
  { action: "Cancel running query", keys: ["Esc"] },
  { action: "Open help", keys: ["F1"] },
];

const jqExamples = [
  { filter: ".", description: "Return the full input unchanged" },
  { filter: ".name", description: "Read a top-level field" },
  { filter: ".user.email", description: "Read a nested field" },
  { filter: ".items[0]", description: "Get the first array element" },
  { filter: ".items[]", description: "Iterate each array element" },
  { filter: "map(.id)", description: "Transform each array item" },
  { filter: "select(.active)", description: "Filter values by condition" },
  { filter: "{ id: .id, name: .name }", description: "Build a new object" },
  { filter: "length", description: "Count elements in arrays/objects/strings" },
  { filter: "keys", description: "List object keys" },
  { filter: "type", description: "Show the JSON value type" },
  { filter: ".users | sort_by(.name)", description: "Pipe results into next step" },
];

export function HelpModal({ open, onOpenChange }: HelpModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Help</DialogTitle>
          <DialogDescription>Keyboard shortcuts and jq quick reference.</DialogDescription>
        </DialogHeader>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Keyboard shortcuts</h3>
          <div className="space-y-2">
            {shortcuts.map((shortcut) => (
              <div
                key={shortcut.action}
                className="flex items-center justify-between rounded-md border px-3 py-2"
              >
                <span className="text-sm text-muted-foreground">{shortcut.action}</span>
                <span className="inline-flex items-center gap-1">
                  {shortcut.keys.map((key) => (
                    <Kbd key={`${shortcut.action}-${key}`}>{key}</Kbd>
                  ))}
                </span>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">On macOS, use Cmd instead of Ctrl.</p>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">jq basics</h3>
          <div className="space-y-2">
            {jqExamples.map((example) => (
              <div key={example.filter} className="rounded-md border px-3 py-2">
                <p className="font-mono text-xs text-primary">{example.filter}</p>
                <p className="text-sm text-muted-foreground">{example.description}</p>
              </div>
            ))}
          </div>
        </section>
      </DialogContent>
    </Dialog>
  );
}
