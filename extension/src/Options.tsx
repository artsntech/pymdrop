import { useEffect, useState } from "react";
import {
  DEFAULT_SETTINGS,
  baseHref,
  normalizeBaseUrl,
  normalizeDomain,
  type ProxySettings,
} from "./shared";

const card: React.CSSProperties = {
  background: "#ffffff",
  padding: "20px",
  borderRadius: "8px",
  boxShadow: "0 2px 4px rgba(0,0,0,0.05)",
  marginBottom: "20px",
};

const cardTitle: React.CSSProperties = {
  margin: "0 0 16px 0",
  fontSize: "16px",
  color: "#212529",
};

const label: React.CSSProperties = {
  display: "block",
  fontSize: "13px",
  color: "#495057",
  marginBottom: "6px",
  fontWeight: 500,
};

const textInput: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "8px 10px",
  fontSize: "14px",
  border: "1px solid #ced4da",
  borderRadius: "4px",
};

type ServerStatus = "checking" | "online" | "offline";

const STATUS_COLOR: Record<ServerStatus, string> = {
  checking: "#adb5bd",
  online: "#198754",
  offline: "#dc3545",
};

const STATUS_LABEL: Record<ServerStatus, string> = {
  checking: "Checking...",
  online: "Online",
  offline: "Offline",
};

export default function Options() {
  const [settings, setSettings] = useState<ProxySettings>(DEFAULT_SETTINGS);
  const [urlDraft, setUrlDraft] = useState<string>(DEFAULT_SETTINGS.gcpUrl);
  const [tokenDraft, setTokenDraft] = useState<string>(DEFAULT_SETTINGS.token);
  const [whitelistDraft, setWhitelistDraft] = useState<string>("");
  const [serverStatus, setServerStatus] = useState<ServerStatus>("checking");

  useEffect(() => {
    chrome.storage.local.get("settings", (result) => {
      if (result.settings) {
        const loaded: ProxySettings = { ...DEFAULT_SETTINGS, ...result.settings };
        setSettings(loaded);
        setUrlDraft(loaded.gcpUrl);
        setTokenDraft(loaded.token);
      }
    });

    const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes.settings) {
        setSettings({ ...DEFAULT_SETTINGS, ...changes.settings.newValue });
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => chrome.storage.onChanged.removeListener(handleStorageChange);
  }, []);

  useEffect(() => {
    const base = normalizeBaseUrl(settings.gcpUrl);
    if (!base) {
      setServerStatus("offline");
      return undefined;
    }

    setServerStatus("checking");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);

    fetch(`${baseHref(base)}/healthz`, { signal: controller.signal })
      .then((response) => setServerStatus(response.ok ? "online" : "offline"))
      .catch(() => {
        if (!controller.signal.aborted) setServerStatus("offline");
      })
      .finally(() => clearTimeout(timer));

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [settings.gcpUrl]);

  const updateSetting = <K extends keyof ProxySettings>(key: K, value: ProxySettings[K]) => {
    const updated = { ...settings, [key]: value };
    setSettings(updated);
    chrome.storage.local.set({ settings: updated });
  };

  const commitUrl = () => {
    const base = normalizeBaseUrl(urlDraft);
    if (!base) {
      setUrlDraft(settings.gcpUrl);
      return;
    }
    const clean = baseHref(base);
    setUrlDraft(clean);
    if (clean !== settings.gcpUrl) updateSetting("gcpUrl", clean);
  };

  const commitToken = () => {
    if (tokenDraft !== settings.token) updateSetting("token", tokenDraft);
  };

  const addToWhitelist = () => {
    const domain = normalizeDomain(whitelistDraft);
    if (!domain) {
      setWhitelistDraft("");
      return;
    }
    if (settings.whitelist.includes(domain)) {
      setWhitelistDraft("");
      return;
    }
    updateSetting("whitelist", [...settings.whitelist, domain]);
    setWhitelistDraft("");
  };

  const removeFromWhitelist = (domain: string) => {
    updateSetting(
      "whitelist",
      settings.whitelist.filter((d) => d !== domain),
    );
  };

  return (
    <div
      style={{
        maxWidth: "720px",
        margin: "0 auto",
        padding: "32px 24px",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        color: "#212529",
      }}
    >
      <header style={{ marginBottom: "32px" }}>
        <h1 style={{ margin: 0, fontSize: "24px", fontWeight: 700 }}>PymDrop</h1>
        <p style={{ margin: "6px 0 0 0", fontSize: "14px", color: "#6c757d" }}>
          Server configuration and allowed sites
        </p>
      </header>

      <div style={card}>
        <h2 style={cardTitle}>Server</h2>

        <div style={{ marginBottom: "16px" }}>
          <label style={label}>Server URL</label>
          <input
            type="text"
            value={urlDraft}
            placeholder="https://your-service.run.app"
            onChange={(e) => setUrlDraft(e.target.value)}
            onBlur={commitUrl}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            style={textInput}
          />
          <p
            style={{
              margin: "6px 0 0 0",
              fontSize: "12px",
              color: "#6c757d",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <span
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                background: STATUS_COLOR[serverStatus],
                display: "inline-block",
              }}
            />
            {STATUS_LABEL[serverStatus]}
          </p>
        </div>

        <div>
          <label style={label}>Token (optional)</label>
          <input
            type="password"
            value={tokenDraft}
            placeholder="If the server requires authentication"
            onChange={(e) => setTokenDraft(e.target.value)}
            onBlur={commitToken}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            style={textInput}
          />
        </div>
      </div>

      <div style={card}>
        <h2 style={cardTitle}>Floating Button</h2>

        <p style={{ margin: "0 0 16px 0", fontSize: "13px", color: "#6c757d" }}>
          The button appears in the corner of the page and allows you to add or remove the current site from the whitelist with one click. When disabled, manage the whitelist from the extension icon or this page.
        </p>

        <label
          style={{
            display: "flex",
            alignItems: "center",
            cursor: "pointer",
            fontSize: "14px",
            marginBottom: "16px",
          }}
        >
          <input
            type="checkbox"
            checked={settings.showFloatingButton}
            onChange={(e) => updateSetting("showFloatingButton", e.target.checked)}
            style={{ marginRight: "10px" }}
          />
          Show button on websites
        </label>

        {settings.showFloatingButton && (
          <div>
            <label style={label}>Position</label>
            <div style={{ display: "flex", gap: "16px", fontSize: "14px" }}>
              <label style={{ display: "flex", alignItems: "center", cursor: "pointer" }}>
                <input
                  type="radio"
                  name="floatingButtonPositionOptions"
                  checked={settings.floatingButtonPosition === "right"}
                  onChange={() => updateSetting("floatingButtonPosition", "right")}
                  style={{ marginRight: "8px" }}
                />
                Bottom right
              </label>
              <label style={{ display: "flex", alignItems: "center", cursor: "pointer" }}>
                <input
                  type="radio"
                  name="floatingButtonPositionOptions"
                  checked={settings.floatingButtonPosition === "left"}
                  onChange={() => updateSetting("floatingButtonPosition", "left")}
                  style={{ marginRight: "8px" }}
                />
                Bottom left
              </label>
            </div>
          </div>
        )}
      </div>

      <div style={card}>
        <h2 style={cardTitle}>Allowed Sites (Whitelist)</h2>

        <p style={{ margin: "0 0 16px 0", fontSize: "13px", color: "#6c757d" }}>
          On these domains, PymDrop does not act: images load from the original source and blocks are ignored. Useful for sites that break with the proxy.
        </p>

        <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
          <input
            type="text"
            value={whitelistDraft}
            placeholder="ex.: sapo.pt"
            onChange={(e) => setWhitelistDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addToWhitelist()}
            style={{ ...textInput, flex: 1 }}
          />
          <button
            onClick={addToWhitelist}
            style={{
              padding: "8px 16px",
              fontSize: "14px",
              border: "1px solid #0d6efd",
              background: "#0d6efd",
              color: "#ffffff",
              borderRadius: "4px",
              cursor: "pointer",
              fontWeight: 500,
            }}
          >
            Add
          </button>
        </div>

        {settings.whitelist.length === 0 ? (
          <p
            style={{
              margin: 0,
              fontSize: "13px",
              color: "#6c757d",
              fontStyle: "italic",
              padding: "12px",
              background: "#f8f9fa",
              borderRadius: "4px",
            }}
          >
            No sites in the whitelist.
          </p>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
              gap: "8px",
            }}
          >
            {settings.whitelist.map((domain) => (
              <div
                key={domain}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontSize: "13px",
                  padding: "8px 12px",
                  background: "#f8f9fa",
                  borderRadius: "4px",
                  border: "1px solid #dee2e6",
                }}
              >
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={domain}
                >
                  {domain}
                </span>
                <button
                  onClick={() => removeFromWhitelist(domain)}
                  style={{
                    border: "none",
                    background: "none",
                    color: "#dc3545",
                    cursor: "pointer",
                    padding: "0 4px",
                    fontSize: "16px",
                    lineHeight: 1,
                  }}
                  title="Remove from whitelist"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}