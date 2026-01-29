import type { TextareaRenderable } from "@opentui/core";
import { TextAttributes } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ConfluenceSearchResult } from "../../types/confluence.js";
import { configManager } from "../../core/config-manager.js";
import { ValidationError, ValidationHelper } from "../../utils/validation.js";
import { getConfluenceService } from "../client.js";
import { getStore } from "../store.js";
import { singleLineKeyBindings } from "../../utils/textarea-helper";
import { openUrl } from "../../utils/open-url.js";
import { showToast } from "./toast.js";

type SearchState = "idle" | "loading" | "success" | "error";

function truncate(value: string, maxLen: number): string {
  if (maxLen <= 0) {
    return "";
  }
  if (value.length <= maxLen) {
    return value;
  }
  if (maxLen === 1) {
    return "…";
  }
  return `${value.slice(0, maxLen - 1)}…`;
}

function padEnd(value: string, length: number): string {
  if (value.length >= length) {
    return value;
  }
  return `${value}${" ".repeat(length - value.length)}`;
}

function padStart(value: string, length: number): string {
  if (value.length >= length) {
    return value;
  }
  return `${" ".repeat(length - value.length)}${value}`;
}

function formatShortDate(value?: string): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.trim().slice(0, 10);
  }
  return date.toISOString().slice(0, 10);
}

function clampInt(value: number, min: number, max: number): number {
  if (max < min) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

export function WikiSearch() {
  const store = getStore();
  const config = useMemo(() => configManager.getConfig(), []);
  const { width } = useTerminalDimensions();

  const queryRef = useRef<TextareaRenderable>(null);
  const spaceKeyRef = useRef<TextareaRenderable>(null);
  const limitRef = useRef<TextareaRenderable>(null);

  const [status, setStatus] = useState<SearchState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [results, setResults] = useState<ConfluenceSearchResult[]>([]);
  const [focusIndex, setFocusIndex] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const focusCount = 4;

  const selectedResult = useMemo(
    () =>
      results.length > 0
        ? results[Math.min(selectedIndex, results.length - 1)]
        : undefined,
    [results, selectedIndex],
  );

  useEffect(() => {
    if (results.length === 0) {
      setSelectedIndex(0);
      return;
    }
    setSelectedIndex((prev) => Math.min(prev, results.length - 1));
  }, [results.length]);

  const listLayout = useMemo(() => {
    const available = Math.max(24, width - 6);

    const minTitleWidth = 15;
    const minSpaceWidth = 10;
    const minUpdatedWidth = 10;

    if (available >= 70) {
      const contentWidth = available - 4;
      const spaceRatio = 0.2;
      const updatedRatio = 0.2;

      const maxSpaceWidth = contentWidth - minTitleWidth - minUpdatedWidth;
      const spaceWidth = clampInt(
        Math.round(contentWidth * spaceRatio),
        minSpaceWidth,
        maxSpaceWidth,
      );

      const maxUpdatedWidth = contentWidth - minTitleWidth - spaceWidth;
      const updatedWidth = clampInt(
        Math.round(contentWidth * updatedRatio),
        minUpdatedWidth,
        maxUpdatedWidth,
      );

      const titleWidth = contentWidth - spaceWidth - updatedWidth;
      return { mode: "full" as const, titleWidth, spaceWidth, updatedWidth };
    }

    if (available >= 44) {
      const contentWidth = available - 2;
      const updatedRatio = 0.25;
      const updatedWidth = clampInt(
        Math.round(contentWidth * updatedRatio),
        minUpdatedWidth,
        contentWidth - minTitleWidth,
      );
      const titleWidth = contentWidth - updatedWidth;
      return { mode: "compact" as const, titleWidth, updatedWidth };
    }
    return { mode: "title" as const, titleWidth: available };
  }, [width]);

  const headerRow = useMemo(() => {
    if (listLayout.mode === "full") {
      return (
        `${padEnd("Title", listLayout.titleWidth)}` +
        `  ${padEnd("Space", listLayout.spaceWidth)}` +
        `  ${padStart("Updated", listLayout.updatedWidth)}`
      );
    }
    if (listLayout.mode === "compact") {
      return (
        `${padEnd("Title", listLayout.titleWidth)}` +
        `  ${padStart("Updated", listLayout.updatedWidth)}`
      );
    }
    return "Title";
  }, [listLayout]);

  const selectOptions = useMemo(
    () =>
      results.map((result) => {
        const space = (result.scopeTitle || "").trim();
        const updated = (
          result.friendlyLastModified ||
          formatShortDate(result.lastModified) ||
          ""
        ).trim();

        let name: string;
        if (listLayout.mode === "full") {
          name =
            `${padEnd(truncate(result.title, listLayout.titleWidth), listLayout.titleWidth)}` +
            `  ${padEnd(truncate(space, listLayout.spaceWidth), listLayout.spaceWidth)}` +
            `  ${padEnd(truncate(updated, listLayout.updatedWidth), listLayout.updatedWidth)}`;
        } else if (listLayout.mode === "compact") {
          name =
            `${padEnd(truncate(result.title, listLayout.titleWidth), listLayout.titleWidth)}` +
            `  ${padEnd(truncate(updated, listLayout.updatedWidth), listLayout.updatedWidth)}`;
        } else {
          name = truncate(result.title, listLayout.titleWidth);
        }

        return { name, description: "", value: result.id };
      }),
    [listLayout, results],
  );

  const runSearch = async (): Promise<void> => {
    if (status === "loading") {
      return;
    }

    setStatus("loading");
    setMessage(null);

    try {
      const query = queryRef.current?.plainText?.trim() || "";
      const spaceKey =
        spaceKeyRef.current?.plainText?.trim() ||
        config.confluence.defaultSpaceKey ||
        "";
      const limit = limitRef.current?.plainText?.trim() || "10";

      if (!query) {
        throw new ValidationError("Search query required");
      }

      const parsedLimit = limit ? parseInt(limit, 10) : undefined;
      if (parsedLimit !== undefined) {
        if (isNaN(parsedLimit) || parsedLimit <= 0) {
          throw new ValidationError("Limit must be a positive number");
        }
      }

      ValidationHelper.validUrl(config.confluence.host);
      ValidationHelper.nonEmpty(config.confluence.token, "confluence token");
      if (config.confluence.token === "YOUR_CONFLUENCE_PAT_HERE") {
        throw new ValidationError(
          "Confluence token is not configured. Please edit ~/.mr-rocket/config.json",
        );
      }

      const confluence = getConfluenceService();
      const data = await confluence.searchPages(query, {
        limit: parsedLimit,
        spaceKey: spaceKey || undefined,
      });

      setResults(data);
      setSelectedIndex(0);
      setStatus("success");
      setMessage(`Found ${data.length} pages`);
      if (data.length > 0) {
        setFocusIndex(3);
      }
    } catch (error) {
      setStatus("error");
      if (error instanceof Error) {
        setMessage(error.message);
      } else {
        setMessage("Failed to search wiki");
      }
    }
  };

  const openSelected = (): void => {
    const url = selectedResult?.url?.trim();
    if (!url) {
      showToast("No URL available for this page", "warning");
      return;
    }
    const result = openUrl(url);
    if (!result.ok) {
      showToast(
        `Failed to open URL: ${result.error ?? "unknown error"}`,
        "error",
      );
      return;
    }
    showToast("Opened page in browser", "success", 1500);
  };

  useKeyboard((key) => {
    if (key.name === "escape") {
      store.dispatch({ type: "NAVIGATE", screen: "dashboard" });
    } else if (key.name === "tab") {
      const direction = key.shift ? -1 : 1;
      setFocusIndex(
        (current) => (current + direction + focusCount) % focusCount,
      );
    } else if (key.name === "enter" || key.name === "return") {
      if (focusIndex === 3) {
        openSelected();
        return;
      }
      void runSearch();
    }
  });

  return (
    <box flexDirection="column" flexGrow={1} gap={1}>
      <text attributes={TextAttributes.BOLD}>Wiki Search</text>
      <text attributes={TextAttributes.DIM}>
        Enter search/open · Tab move · Esc back width: {width}
      </text>

      {message ? (
        <text style={{ fg: status === "error" ? "red" : "green" }}>
          {message}
        </text>
      ) : null}

      <box flexDirection="column" gap={1}>
        <box flexDirection="column">
          <text attributes={TextAttributes.DIM}>Query</text>
          <box style={{ border: true, height: 3 }}>
            <textarea
              ref={queryRef}
              placeholder="Search Confluence"
              focused={focusIndex === 0}
              keyBindings={singleLineKeyBindings}
            />
          </box>
        </box>

        <box flexDirection="column">
          <text attributes={TextAttributes.DIM}>Space Key</text>
          <box style={{ border: true, height: 3 }}>
            <textarea
              ref={spaceKeyRef}
              placeholder="Optional"
              focused={focusIndex === 1}
              keyBindings={singleLineKeyBindings}
            />
          </box>
        </box>

        <box flexDirection="column">
          <text attributes={TextAttributes.DIM}>Limit</text>
          <box style={{ border: true, height: 3 }}>
            <textarea
              ref={limitRef}
              placeholder="10"
              focused={focusIndex === 2}
              keyBindings={singleLineKeyBindings}
            />
          </box>
        </box>
      </box>

      <box
        flexDirection="column"
        flexGrow={1}
        borderStyle="single"
        borderColor={focusIndex === 3 ? "cyan" : "blue"}
        paddingLeft={1}
        paddingRight={1}
        paddingTop={1}
        paddingBottom={1}
        gap={1}
      >
        <text attributes={TextAttributes.BOLD}>
          Results {results.length > 0 ? `(${results.length})` : ""}
        </text>

        {status === "loading" ? (
          <text attributes={TextAttributes.DIM}>Searching...</text>
        ) : results.length === 0 ? (
          <text attributes={TextAttributes.DIM}>
            {status === "success"
              ? "No results found."
              : "Enter a query to search."}
          </text>
        ) : (
          <>
            <text attributes={TextAttributes.DIM}>{headerRow}</text>
            <box flexGrow={1}>
              <select
                options={selectOptions}
                selectedIndex={selectedIndex}
                onChange={(index) => setSelectedIndex(index)}
                focused={focusIndex === 3}
                showScrollIndicator
                wrapSelection
                showDescription={false}
                style={{ flexGrow: 1, width: "100%" }}
              />
            </box>
          </>
        )}
      </box>

      <box paddingTop={1}>
        <text attributes={TextAttributes.DIM}>
          Enter open · ↑/↓ select · Tab focus · Esc back
        </text>
      </box>
    </box>
  );
}
