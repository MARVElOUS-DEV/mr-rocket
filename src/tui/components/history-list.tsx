import { TextAttributes } from "@opentui/core";
import { useEffect, useState } from "react";
import { getStore } from "../store.js";
import { historyManager } from "../../core/history-manager.js";
import type { HistoryEntry } from "../../models/history.js";

export function HistoryList() {
  const store = getStore();
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchHistory() {
      try {
        const data = await historyManager.query({ limit: 50 });
        setHistory(data);
      } catch (err: any) {
        store.dispatch({ type: "SET_ERROR", error: err.message });
      } finally {
        setLoading(false);
      }
    }

    fetchHistory();
  }, [store]);

  return (
    <box flexDirection="column" flexGrow={1}>
      <box paddingBottom={1} borderStyle="single" borderColor="yellow">
        <text attributes={TextAttributes.BOLD}>Command History</text>
      </box>

      {loading ? (
        <box padding={1}>
          <text attributes={TextAttributes.DIM}>Loading...</text>
        </box>
      ) : (
        <box flexDirection="column" gap={0} flexGrow={1}>
          {history.length === 0 ? (
            <text>No history found.</text>
          ) : (
            history.map((entry) => (
              <box key={entry.id} flexDirection="row" gap={2}>
                <text attributes={entry.status === "success" ? TextAttributes.DIM : TextAttributes.BOLD}>
                  {new Date(entry.timestampMs ?? entry.timestamp).toLocaleTimeString()}
                </text>
                <text flexGrow={1}>{entry.command}</text>
                <text attributes={entry.status === "success" ? TextAttributes.DIM : TextAttributes.BOLD}>
                  {entry.status}
                </text>
              </box>
            ))
          )}
        </box>
      )}

      <box paddingTop={1}>
        <text attributes={TextAttributes.DIM}>Esc back</text>
      </box>
    </box>
  );
}
