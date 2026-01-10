import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useMemo, useState } from "react";
import type { ConfluenceSearchResult } from "../../models/confluence.js";
import { configManager } from "../../core/config-manager.js";
import { ValidationError, ValidationHelper } from "../../utils/validation.js";
import { getConfluenceService } from "../client.js";
import { getStore } from "../store.js";

type SearchState = "idle" | "loading" | "success" | "error";

export function WikiSearch() {
  const store = getStore();
  const config = useMemo(() => configManager.getConfig(), []);

  const [query, setQuery] = useState("");
  const [spaceKey, setSpaceKey] = useState(config.confluence.defaultSpaceKey || "");
  const [limit, setLimit] = useState("10");
  const [status, setStatus] = useState<SearchState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [results, setResults] = useState<ConfluenceSearchResult[]>([]);
  const [focusIndex, setFocusIndex] = useState(0);

  const focusCount = 3;

  const runSearch = async (): Promise<void> => {
    if (status === "loading") {
      return;
    }

    setStatus("loading");
    setMessage(null);

    try {
      const trimmedQuery = query.trim();
      if (!trimmedQuery) {
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
        throw new ValidationError("Confluence token is not configured. Please edit ~/.mr-rocket/config.json");
      }

      const confluence = getConfluenceService();
      const data = await confluence.searchPages(trimmedQuery, {
        limit: parsedLimit,
        spaceKey: spaceKey || undefined,
      });

      setResults(data);
      setStatus("success");
      setMessage(`Found ${data.length} pages`);
    } catch (error) {
      setStatus("error");
      if (error instanceof Error) {
        setMessage(error.message);
      } else {
        setMessage("Failed to search wiki");
      }
    }
  };

  useKeyboard((key) => {
    if (key.name === "escape") {
      store.dispatch({ type: "NAVIGATE", screen: "dashboard" });
    } else if (key.name === "tab") {
      const direction = key.shift ? -1 : 1;
      setFocusIndex((current) => (current + direction + focusCount) % focusCount);
    } else if (key.name === "return") {
      void runSearch();
    }
  });

  return (
    <box flexDirection="column" flexGrow={1} gap={1}>
      <text attributes={TextAttributes.BOLD}>Wiki Search</text>
      <text attributes={TextAttributes.DIM}>Enter search · Tab move · Esc back</text>

      {message ? (
        <text style={{ fg: status === "error" ? "red" : "green" }}>{message}</text>
      ) : null}

      <box flexDirection="column" gap={1}>
        <box flexDirection="column">
          <text attributes={TextAttributes.DIM}>Query</text>
          <box style={{ border: true, height: 3 }}>
            <input
              value={query}
              onInput={setQuery}
              placeholder="Search Confluence"
              focused={focusIndex === 0}
            />
          </box>
        </box>

        <box flexDirection="column">
          <text attributes={TextAttributes.DIM}>Space Key</text>
          <box style={{ border: true, height: 3 }}>
            <input
              value={spaceKey}
              onInput={setSpaceKey}
              placeholder="Optional"
              focused={focusIndex === 1}
            />
          </box>
        </box>

        <box flexDirection="column">
          <text attributes={TextAttributes.DIM}>Limit</text>
          <box style={{ border: true, height: 3 }}>
            <input
              value={limit}
              onInput={setLimit}
              placeholder="10"
              focused={focusIndex === 2}
            />
          </box>
        </box>
      </box>

      <box flexDirection="column" flexGrow={1} paddingTop={1}>
        {status === "loading" ? (
          <text attributes={TextAttributes.DIM}>Searching...</text>
        ) : results.length === 0 ? (
          <text attributes={TextAttributes.DIM}>
            {status === "success" ? "No results found." : "Enter a query to search."}
          </text>
        ) : (
          results.map((result) => (
            <box key={result.id} flexDirection="column" paddingBottom={1}>
              <text>{result.title}</text>
              {result.url ? (
                <text attributes={TextAttributes.DIM}>{result.url}</text>
              ) : null}
              {result.excerpt ? (
                <text attributes={TextAttributes.DIM}>{result.excerpt}</text>
              ) : null}
            </box>
          ))
        )}
      </box>

      <box paddingTop={1}>
        <text attributes={TextAttributes.DIM}>Esc back</text>
      </box>
    </box>
  );
}
