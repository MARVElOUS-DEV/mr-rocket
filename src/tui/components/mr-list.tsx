import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useEffect, useMemo, useState } from "react";
import { getStore } from "../store.js";
import { getGitLabService } from "../client.js";
import { TUIContext } from "../context.js";
import { openUrl } from "../../utils/open-url.js";
import { showToast } from "./toast.js";
import type { MergeRequest } from "../../models/gitlab.js";

export function MRList() {
  const store = getStore();
  const [mrs, setMrs] = useState<MergeRequest[]>(store.getState().loadedM || []);
  const [loading, setLoading] = useState(mrs.length === 0);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const selectedMr = useMemo(
    () => (mrs.length > 0 ? mrs[Math.min(selectedIndex, mrs.length - 1)] : undefined),
    [mrs, selectedIndex],
  );

  useEffect(() => {
    async function fetchMRs() {
      try {
        const gitlab = getGitLabService();
        const projectId = TUIContext.getInstance().getGitLabProjectId();
        const data = await gitlab.listMergeRequests(projectId, { state: "opened" });
        store.dispatch({ type: "SET_MR", mrs: data });
        setMrs(data);
      } catch (err: any) {
        store.dispatch({ type: "SET_ERROR", error: err.message });
      } finally {
        setLoading(false);
      }
    }

    if (mrs.length === 0) {
      fetchMRs();
    }
  }, [mrs.length, store]);

  useEffect(() => {
    if (mrs.length === 0) {
      setSelectedIndex(0);
      return;
    }
    setSelectedIndex((prev) => Math.min(prev, mrs.length - 1));
  }, [mrs.length]);

  useKeyboard((key) => {
    if (loading || mrs.length === 0) {
      return;
    }

    if (key.name === "down") {
      setSelectedIndex((prev) => (prev + 1) % mrs.length);
      return;
    }

    if (key.name === "up") {
      setSelectedIndex((prev) => (prev - 1 + mrs.length) % mrs.length);
      return;
    }

    if (key.name === "enter" || key.name === "return") {
      const url = selectedMr?.webUrl?.trim();
      if (!url) {
        showToast("No URL available for this merge request", "warning");
        return;
      }
      const result = openUrl(url);
      if (!result.ok) {
        showToast(`Failed to open URL: ${result.error ?? "unknown error"}`, "error");
        return;
      }
      showToast("Opened merge request in browser", "success", 1500);
    }
  });

  return (
    <box flexDirection="column" flexGrow={1}>
      <box paddingBottom={1} borderStyle="single" borderColor="blue">
        <text attributes={TextAttributes.BOLD}>Merge Requests</text>
      </box>

      {loading ? (
        <box padding={1}>
          <text attributes={TextAttributes.DIM}>Loading...</text>
        </box>
      ) : (
        <box flexDirection="column" gap={0} flexGrow={1}>
          {mrs.length === 0 ? (
            <text>No open merge requests found.</text>
          ) : (
            mrs.map((mr, index) => {
              const isSelected = index === selectedIndex;
              const selectedStyle = isSelected
                ? { fg: "white", bg: "#1f2d3d" }
                : undefined;
              const linkFg = isSelected ? "white" : "blue";
              return (
                <box
                  key={mr.iid}
                  flexDirection="row"
                  gap={2}
                  style={isSelected ? { backgroundColor: "#1f2d3d" } : undefined}
                >
                  <text
                    attributes={isSelected ? TextAttributes.BOLD : TextAttributes.DIM}
                    style={selectedStyle}
                  >
                    {isSelected ? ">" : " "}
                  </text>
                  <text
                    attributes={isSelected ? TextAttributes.BOLD : TextAttributes.DIM}
                    style={selectedStyle}
                  >
                    !{mr.iid}
                  </text>
                  <text flexGrow={1} style={selectedStyle}>
                    {mr.webUrl ? (
                      <a href={mr.webUrl}>
                        <u>
                          <span fg={linkFg} bg={isSelected ? "#1f2d3d" : undefined}>
                            {mr.title}
                          </span>
                        </u>
                      </a>
                    ) : (
                      mr.title
                    )}
                  </text>
                  <text
                    attributes={isSelected ? TextAttributes.BOLD : TextAttributes.DIM}
                    style={selectedStyle}
                  >
                    {mr.author.name}
                  </text>
                </box>
              );
            })
          )}
        </box>
      )}

      <box paddingTop={1}>
        <text attributes={TextAttributes.DIM}>Enter open · ↑/↓ move · Esc back</text>
      </box>
    </box>
  );
}
