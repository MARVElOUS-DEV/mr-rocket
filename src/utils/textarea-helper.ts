import type { TextareaAction } from "@opentui/core";

// Disable newline in textarea to make it single-line
export const singleLineKeyBindings = [
  { name: "return", action: "submit" as TextareaAction },
  { name: "linefeed", action: "submit" as TextareaAction },
];
