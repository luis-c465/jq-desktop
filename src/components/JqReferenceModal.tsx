import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";

type JqReferenceModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type Example = {
  filter: string;
  description: string;
};

type Section = {
  title: string;
  examples: Example[];
};

const sections: Section[] = [
  {
    title: "Identity and fields",
    examples: [
      { filter: ".", description: "Return the full input unchanged" },
      { filter: ".name", description: "Read a top-level field" },
      { filter: ".user.email", description: "Read a nested field" },
      { filter: ".items[0]", description: "Get the first array element" },
    ],
  },
  {
    title: "Working with arrays",
    examples: [
      { filter: ".items[]", description: "Iterate each array element" },
      { filter: "map(.id)", description: "Transform each item in an array" },
      { filter: "select(.active)", description: "Keep only values matching a condition" },
      { filter: ".users | sort_by(.name)", description: "Sort objects by a field" },
      { filter: "group_by(.type)", description: "Group sorted items by key" },
      { filter: "length", description: "Count elements in arrays" },
    ],
  },
  {
    title: "Working with objects",
    examples: [
      { filter: "{ id: .id, name: .name }", description: "Build a new object shape" },
      { filter: "keys", description: "List object keys" },
      { filter: "values", description: "Get all object values" },
      { filter: "has(\"email\")", description: "Check if a key exists" },
      { filter: "to_entries", description: "Convert object to key-value pairs" },
      { filter: "from_entries", description: "Convert key-value pairs back to object" },
    ],
  },
  {
    title: "Pipes and conditionals",
    examples: [
      { filter: ".users | map(.name)", description: "Pass results into the next filter" },
      { filter: ".nickname // .name", description: "Use fallback value when null or missing" },
      {
        filter: "if .active then \"enabled\" else \"disabled\" end",
        description: "Branch output with conditions",
      },
      { filter: "type", description: "Inspect the current value type" },
    ],
  },
  {
    title: "Useful conversions",
    examples: [
      { filter: "split(\",\")", description: "Split a string into an array" },
      { filter: "join(\", \")", description: "Join array items into a string" },
      { filter: "@uri", description: "Encode string as URL-safe text" },
      { filter: "@base64", description: "Encode string as base64" },
    ],
  },
];

export function JqReferenceModal({ open, onOpenChange }: JqReferenceModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>jq reference</DialogTitle>
          <DialogDescription>
            Learn the essentials quickly with practical filters and examples.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {sections.map((section) => (
            <section key={section.title} className="space-y-3">
              <h3 className="text-sm font-semibold">{section.title}</h3>
              <div className="space-y-2">
                {section.examples.map((example) => (
                  <div key={`${section.title}-${example.filter}`} className="rounded-md border px-3 py-2">
                    <p className="font-mono text-xs text-primary">{example.filter}</p>
                    <p className="text-sm text-muted-foreground">{example.description}</p>
                  </div>
                ))}
              </div>
            </section>
          ))}

          <p className="text-xs text-muted-foreground">
            Full language guide:{" "}
            <a
              href="https://jqlang.org/manual/"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              jqlang.org/manual
            </a>
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
