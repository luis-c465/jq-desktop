import { LanguageSupport, StreamLanguage } from "@codemirror/language";

const KEYWORDS = new Set([
  "as",
  "break",
  "catch",
  "def",
  "elif",
  "else",
  "end",
  "false",
  "foreach",
  "if",
  "import",
  "include",
  "label",
  "module",
  "null",
  "or",
  "and",
  "not",
  "reduce",
  "then",
  "true",
  "try",
]);

const BUILTINS = new Set([
  "empty",
  "error",
  "halt",
  "halt_error",
  "inputs",
  "length",
  "keys",
  "keys_unsorted",
  "has",
  "in",
  "path",
  "delpaths",
  "getpath",
  "setpath",
  "map",
  "map_values",
  "select",
  "sort",
  "sort_by",
  "group_by",
  "min",
  "max",
  "min_by",
  "max_by",
  "unique",
  "unique_by",
  "add",
  "join",
  "flatten",
  "range",
  "reverse",
  "contains",
  "startswith",
  "endswith",
  "split",
  "explode",
  "implode",
  "now",
  "strftime",
  "strptime",
  "todate",
  "fromdate",
  "tojson",
  "fromjson",
  "tostring",
  "tonumber",
  "type",
]);

const FORMAT_STRINGS = /^(?:base64d?|html|csv|tsv|json|text|sh|uri)\b/;
const NUMBER_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?\b/;
const jqStreamLanguage = StreamLanguage.define({
  languageData: {
    commentTokens: { line: "#" },
  },
  token(stream) {
    if (stream.eatSpace()) {
      return null;
    }

    if (stream.peek() === "#") {
      stream.skipToEnd();
      return "comment";
    }

    if (stream.eat("\"")) {
      let escaped = false;
      while (!stream.eol()) {
        const ch = stream.next();
        if (ch === "\"" && !escaped) {
          break;
        }
        escaped = ch === "\\" && !escaped;
        if (ch !== "\\") {
          escaped = false;
        }
      }
      return "string";
    }

    if (stream.eat("@")) {
      if (stream.match(FORMAT_STRINGS)) {
        return "keyword";
      }
      stream.eatWhile(/[A-Za-z_\d-]/);
      return "operator";
    }

    if (stream.match(/^\$[A-Za-z_][\w-]*/)) {
      return "variableName";
    }

    if (stream.match(NUMBER_PATTERN)) {
      return "number";
    }

    if (
      stream.match("?//") ||
      stream.match("//") ||
      stream.match("..") ||
      stream.match("==") ||
      stream.match("!=") ||
      stream.match("<=") ||
      stream.match(">=")
    ) {
      return "operator";
    }

    if (stream.match(/^[|.?+\-*/%<>=!]/)) {
      return "operator";
    }

    if (stream.match(/^[()[\]{}:,;]/)) {
      return "bracket";
    }

    const wordStart = stream.pos;
    if (stream.eat(/[A-Za-z_]/)) {
      stream.eatWhile(/[\w-]/);
      const value = stream.string.slice(wordStart, stream.pos);
      if (KEYWORDS.has(value)) {
        return "keyword";
      }
      if (BUILTINS.has(value)) {
        return "builtin";
      }
      return "name";
    }

    stream.next();
    return null;
  },
});

export function jqLanguage(): LanguageSupport {
  return new LanguageSupport(jqStreamLanguage);
}
