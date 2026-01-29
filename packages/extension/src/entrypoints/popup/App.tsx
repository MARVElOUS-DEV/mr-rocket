import { useState, useEffect } from "react";

interface Status {
  enabled: boolean;
  domains: string[];
  lastSync: string | null;
  connected: boolean;
}

export function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [domainsText, setDomainsText] = useState("");

  useEffect(() => {
    chrome.runtime.sendMessage({ type: "GET_STATUS" }, (response: Status) => {
      console.log("[popup/App] GET_STATUS response:", response, "lastError:", chrome.runtime.lastError);
      if (chrome.runtime.lastError) {
        console.error("[popup/App] Error:", chrome.runtime.lastError.message);
        return;
      }
      setStatus(response);
      setDomainsText((response.domains ?? []).join(", "));
    });
  }, []);

  const handleSync = () => {
    chrome.runtime.sendMessage({ type: "FORCE_SYNC" }, () => {
      chrome.runtime.sendMessage({ type: "GET_STATUS" }, setStatus);
    });
  };

  const handleSave = () => {
    const raw = domainsText;
    const domains = raw
      .split(/[\s,]+/)
      .map((d) => d.trim())
      .filter((d) => d.length > 0)
      .map((d) => {
        try {
          const url = d.includes("://") ? new URL(d) : new URL(`https://${d}`);
          return url.hostname.trim().toLowerCase();
        } catch {
          return d.trim().replace(/^\./, "").split("/")[0]?.toLowerCase() ?? "";
        }
      })
      .filter((d) => d.length > 0);

    const uniqueDomains = Array.from(new Set(domains));

    chrome.runtime.sendMessage(
      {
        type: "UPDATE_CONFIG",
        config: { cdpDomains: uniqueDomains },
      },
      () => {
        setDomainsText(uniqueDomains.join(", "));
        chrome.runtime.sendMessage({ type: "GET_STATUS" }, setStatus);
      }
    );
  };

  const handleToggle = () => {
    chrome.runtime.sendMessage(
      {
        type: "UPDATE_CONFIG",
        config: { enabled: !status?.enabled },
      },
      () => {
        chrome.runtime.sendMessage({ type: "GET_STATUS" }, setStatus);
      }
    );
  };

  if (!status) return <div className="loading">Loading...</div>;

  return (
    <div className="container">
      <h1>🚀 MR-Rocket Auth</h1>

      <div className="status-section">
        <div className="status-row">
          <span>Status:</span>
          <span className={`badge ${status.connected ? "success" : "warning"}`}>
            {status.connected ? "Connected" : "Standby"}
          </span>
        </div>
        <div className="status-row">
          <span>Enabled:</span>
          <span className={`badge ${status.enabled ? "success" : "error"}`}>
            {status.enabled ? "Yes" : "No"}
          </span>
        </div>
        <div className="status-row">
          <span>Domains:</span>
          <span className="text-muted">
            {(status.domains ?? []).length > 0 ? (status.domains ?? []).join(", ") : "(none)"}
          </span>
        </div>
        {status.lastSync && (
          <div className="status-row">
            <span>Last Sync:</span>
            <span className="text-muted">
              {new Date(status.lastSync).toLocaleTimeString()}
            </span>
          </div>
        )}
      </div>

      <div className="config-section">
        <label>
          CDP Domains (comma or space separated):
          <input
            type="text"
            value={domainsText}
            onChange={(e) => setDomainsText(e.target.value)}
            placeholder="cdp-a.example.com, cdp-b.example.com"
          />
        </label>
      </div>

      <div className="actions">
        <button onClick={handleSync} className="btn primary">
          Sync Now
        </button>
        <button onClick={handleToggle} className="btn">
          {status.enabled ? "Disable" : "Enable"}
        </button>
        <button onClick={handleSave} className="btn">
          Save
        </button>
      </div>

      <div className="help-text">
        <p>
          Configure one or more CDP domains above, then log into them in your browser.
          Cookies will sync automatically.
        </p>
      </div>
    </div>
  );
}
