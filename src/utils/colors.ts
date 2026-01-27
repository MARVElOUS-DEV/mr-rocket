export const colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
  magenta: "\x1b[35m",
} as const;

export type Color = keyof typeof colors;

export function colorize(text: string, color: Color): string {
  return `${colors[color]}${text}${colors.reset}`;
}

export function success(text: string): string {
  return colorize(`✓ ${text}`, "green");
}

export function error(text: string): string {
  return colorize(`✗ ${text}`, "red");
}

export function warning(text: string): string {
  return colorize(`⚠ ${text}`, "yellow");
}

export function info(text: string): string {
  return colorize(`ℹ ${text}`, "blue");
}
