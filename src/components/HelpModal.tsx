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

export function HelpModal({ open, onOpenChange }: HelpModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Help</DialogTitle>
          <DialogDescription>Keyboard shortcuts for moving faster.</DialogDescription>
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
      </DialogContent>
    </Dialog>
  );
}
