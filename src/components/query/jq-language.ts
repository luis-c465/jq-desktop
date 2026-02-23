import { javascript } from "@codemirror/lang-javascript";
import type { LanguageSupport } from "@codemirror/language";

export function jqLanguage(): LanguageSupport {
  return javascript();
}
