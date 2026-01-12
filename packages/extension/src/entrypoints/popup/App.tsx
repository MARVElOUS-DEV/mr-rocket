import { useState, useEffect } from "react";

interface Status {
  enabled: boolean;
  domain: string;
  lastSync: string | null;
  connected: boolean;
}

export function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [domain, setDomain] = useState("");

  useEffect(() => {
    chrome.runtime.sendMessage({ type: "GET_STATUS" }, (response: Status) => {
      setStatus(response);
      setDomain(response.domain);
    });
  }, []);

  const handleSync = () => {
    chrome.runtime.sendMessage({ type: "FORCE_SYNC" }, () => {
      chrome.runtime.sendMessage({ type: "GET_STATUS" }, setStatus);
    });
  };

  const handleSave = () => {
    let cleanDomain = domain.trim();
    try {
      if (cleanDomain.includes("://")) {
        cleanDomain = new URL(cleanDomain).hostname;
      }
    } catch (e) {
      // If URL parsing fails, stick with trimmed domain
    }

    chrome.runtime.sendMessage(
      {
        type: "UPDATE_CONFIG",
        config: { cdpDomain: cleanDomain },
      },
      () => {
        setDomain(cleanDomain);
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
          CDP Domain:
          <input
            type="text"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="your-cdp-domain.com"
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
          Configure the CDP domain above, then log into CDP in your browser.
          Cookies will sync automatically.
        </p>
      </div>
    </div>
  );
}
