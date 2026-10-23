import { useEffect, useState } from "react";
import { DEFAULT_SETTINGS, type ProxySettings } from "./shared";

const card: React.CSSProperties = {
  background: "#ffffff",
  padding: "12px",
  borderRadius: "8px",
  boxShadow: "0 2px 4px rgba(0,0,0,0.05)",
  marginBottom: "16px",
};

const cardTitle: React.CSSProperties = {
  margin: "0 0 12px 0",
  fontSize: "14px",
  color: "#495057",
};

const checkboxRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  cursor: "pointer",
};

export default function App() {
  const [settings, setSettings] = useState<ProxySettings>(DEFAULT_SETTINGS);
  const [bytesSaved, setBytesSaved] = useState<number>(0);
  const [totalBytes, setTotalBytes] = useState<number>(0);

  useEffect(() => {
    chrome.storage.local.get(["settings", "bytesSaved", "totalBytes"], (result) => {
      if (result.settings) {
        setSettings({ ...DEFAULT_SETTINGS, ...result.settings });
      }
      if (typeof result.bytesSaved === "number") setBytesSaved(result.bytesSaved);
      if (typeof result.totalBytes === "number") setTotalBytes(result.totalBytes);
    });

    const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes.bytesSaved) setBytesSaved(changes.bytesSaved.newValue || 0);
      if (changes.totalBytes) setTotalBytes(changes.totalBytes.newValue || 0);
      if (changes.settings) {
        setSettings({ ...DEFAULT_SETTINGS, ...changes.settings.newValue });
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => chrome.storage.onChanged.removeListener(handleStorageChange);
  }, []);

  const updateSetting = <K extends keyof ProxySettings>(key: K, value: ProxySettings[K]) => {
    const updated = { ...settings, [key]: value };
    setSettings(updated);
    chrome.storage.local.set({ settings: updated });
  };

  const resetStats = () => {
    setBytesSaved(0);
    setTotalBytes(0);
    chrome.storage.local.set({ bytesSaved: 0, totalBytes: 0 });
  };

  const openOptions = () => {
    chrome.runtime.openOptionsPage();
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0.00 MB";
    const mb = bytes / (1024 * 1024);
    if (mb >= 0.01) return `${mb.toFixed(2)} MB`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  };

  const efficiency =
    totalBytes + bytesSaved > 0
      ? Math.min(Math.round((bytesSaved / (totalBytes + bytesSaved)) * 100), 100)
      : 0;

  return (
    <div
      style={{
        width: "320px",
        padding: "16px",
        fontFamily: "sans-serif",
        background: "#f8f9fa",
        color: "#212529",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "16px",
        }}
      >
        <h1 style={{ margin: 0, fontSize: "18px", fontWeight: "bold" }}>PymDrop</h1>
        <label style={{ ...checkboxRow, fontWeight: 600 }}>
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(e) => updateSetting("enabled", e.target.checked)}
            style={{ marginRight: "6px" }}
          />
          Active
        </label>
      </div>

      <div style={card}>
        <div style={{ fontSize: "13px", color: "#6c757d", marginBottom: "4px" }}>
          Data Saved
        </div>
        <div
          style={{ fontSize: "24px", fontWeight: "bold", color: "#0d6efd", marginBottom: "8px" }}
        >
          {formatBytes(bytesSaved)}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: "13px",
            borderTop: "1px solid #dee2e6",
            paddingTop: "8px",
          }}
        >
          <span>
            Efficiency: <strong>{efficiency}% lighter</strong>
          </span>
          <button
            onClick={resetStats}
            style={{
              border: "none",
              background: "none",
              color: "#dc3545",
              cursor: "pointer",
              padding: 0,
              fontSize: "13px",
            }}
          >
            Reset
          </button>
        </div>
      </div>

      {settings.enabled && (
        <>
          {!settings.blockAllImages && (
            <div style={card}>
              <h3 style={cardTitle}>Image Options</h3>

              <div style={{ marginBottom: "12px" }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: "13px",
                    marginBottom: "4px",
                  }}
                >
                  <span>Compression Quality</span>
                  <strong>{settings.quality}%</strong>
                </div>
                <input
                  type="range"
                  min="10"
                  max="90"
                  step="5"
                  value={settings.quality}
                  onChange={(e) => updateSetting("quality", parseInt(e.target.value, 10))}
                  style={{ width: "100%", cursor: "pointer" }}
                />
              </div>

              <label style={{ ...checkboxRow, fontSize: "13px" }}>
                <input
                  type="checkbox"
                  checked={settings.grayscale}
                  onChange={(e) => updateSetting("grayscale", e.target.checked)}
                  style={{ marginRight: "8px" }}
                />
                 Apply Grayscale (Black & White)
              </label>
              <p
                style={{
                  margin: "6px 0 0 24px",
                  fontSize: "11px",
                  color: "#6c757d",
                  lineHeight: 1.4,
                }}
              >
                Images under 3 KB (icons, logos) are skipped to avoid bloating.
              </p>
            </div>
          )}

          <div style={card}>
            <h3 style={cardTitle}>Block Filters</h3>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "8px 12px",
                fontSize: "13px",
              }}
            >
              {(
                [
                  ["blockAllImages", "All Images"],
                  ["blockTrackers", "Trackers"],
                  ["blockMedia", "Media"],
                  ["blockFonts", "Fonts"],
                  ["blockScripts", "JavaScript"],
                  ["blockStyles", "Styles"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} style={{ ...checkboxRow, gap: "6px" }}>
                  <input
                    type="checkbox"
                    checked={settings[key]}
                    onChange={(e) => updateSetting(key, e.target.checked)}
                    style={{ marginRight: 0 }}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
        </>
      )}

      <button
        onClick={openOptions}
        style={{
          width: "100%",
          padding: "10px",
          fontSize: "13px",
          border: "1px solid #ced4da",
          background: "#ffffff",
          color: "#495057",
          borderRadius: "8px",
          cursor: "pointer",
          fontWeight: 500,
        }}
      >
        ⚙ Advanced Settings
      </button>
    </div>
  );
}