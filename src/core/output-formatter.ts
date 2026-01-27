import type { CommandOutput, TableOutput } from "../types/command-output.js";
import { success, error, warning, info } from "../utils/colors.js";

export class OutputFormatter {
  format(output: CommandOutput, jsonMode: boolean): string {
    if (jsonMode) {
      return JSON.stringify(
        {
          success: output.success,
          message: output.message,
          data: output.data,
          error: output.error?.message,
          meta: output.meta,
        },
        null,
        2
      );
    }

    if (output.success) {
      let result = "";
      if (output.message) {
        result += success(output.message) + "\n";
      }

      if (output.data) {
        result += this.formatData(output.data);
      }

      return result;
    } else {
      return error(output.error?.message || "Command failed");
    }
  }

  private formatData(data: unknown): string {
    if (!data) return "";

    if (Array.isArray(data)) {
      if (data.length === 0) {
        return info("No results found");
      }

      const firstItem = data[0];
      if (typeof firstItem === "object" && firstItem !== null) {
        return this.formatTable(data as Array<Record<string, unknown>>);
      }

      return data.map((item) => JSON.stringify(item, null, 2)).join("\n");
    }

    if (typeof data === "object" && data !== null) {
      if ("headers" in data && "rows" in data) {
        return this.formatTableOutput(data as TableOutput);
      }

      return JSON.stringify(data, null, 2);
    }

    return String(data);
  }

  private formatTable(items: Array<Record<string, unknown>>): string {
    if (items.length === 0) return "";

    const firstItem = items[0];
    if (!firstItem) {
      return "";
    }

    const headers = Object.keys(firstItem);
    const rows = items.map((item) => headers.map((h) => String(item[h] ?? "")));

    const colWidths = headers.map((h, i) =>
      Math.max(h.length, ...rows.map((r) => r[i]?.length ?? 0))
    );

    const separator = "+" + colWidths.map((w) => "-".repeat(w + 2)).join("+") + "+";
    const headerRow =
      "|" +
      headers
        .map((h, i) => {
          const width = colWidths[i] ?? h.length;
          return ` ${h.padEnd(width)} `;
        })
        .join("|") +
      "|";

    let result = separator + "\n";
    result += headerRow + "\n";
    result += separator + "\n";

    for (const row of rows) {
      result +=
        "|" +
        row
          .map((cell, i) => {
            const width = colWidths[i] ?? cell.length;
            return ` ${cell.padEnd(width)} `;
          })
          .join("|") +
        "|\n";
      result += separator + "\n";
    }

    return result;
  }

  private formatTableOutput(table: TableOutput): string {
    const { headers, rows, summary } = table;

    if (rows.length === 0) {
      return info("No results found");
    }

    const colWidths = headers.map((h, i) =>
      Math.max(h.length, ...rows.map((r) => r[i]?.length ?? 0))
    );

    const separator = "+" + colWidths.map((w) => "-".repeat(w + 2)).join("+") + "+";
    const headerRow =
      "|" +
      headers
        .map((h, i) => {
          const width = colWidths[i] ?? h.length;
          return ` ${h.padEnd(width)} `;
        })
        .join("|") +
      "|";

    let result = separator + "\n";
    result += headerRow + "\n";
    result += separator + "\n";

    for (const row of rows) {
      result +=
        "|" +
        row
          .map((cell, i) => {
            const width = colWidths[i] ?? cell.length;
            return ` ${cell.padEnd(width)} `;
          })
          .join("|") +
        "|\n";
      result += separator + "\n";
    }

    if (summary) {
      result += summary + "\n";
    }

    return result;
  }
}

export const outputFormatter = new OutputFormatter();
