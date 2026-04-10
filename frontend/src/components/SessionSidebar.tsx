import { useEffect, useState } from "react";
import type { SessionListItem } from "../types";
import "../styles/SessionSidebar.css";

interface SessionSidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  mode?: "sessions" | "markdown";
  apiBaseUrl?: string;
  currentSessionId?: string | null;
  onSessionSelect?: (sessionId: string) => void;
  markdownSessionId?: string | null;
  markdownPlanId?: string | null;
  markdownContent?: string;
  markdownLoading?: boolean;
  markdownError?: string | null;
}

export function SessionSidebar({
  isOpen,
  onToggle,
  mode = "sessions",
  apiBaseUrl = "",
  currentSessionId = null,
  onSessionSelect,
  markdownSessionId = null,
  markdownPlanId = null,
  markdownContent,
  markdownLoading,
  markdownError,
}: SessionSidebarProps) {
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [markdown, setMarkdown] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    if (mode === "markdown" && markdownContent !== undefined) {
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    if (mode === "markdown") {
      if (!markdownSessionId) {
        setMarkdown("");
        setLoading(false);
        setError("No active review session.");
        return;
      }

      const query = markdownPlanId
        ? `?planId=${encodeURIComponent(markdownPlanId)}`
        : "";

      fetch(`${apiBaseUrl}/api/research/${markdownSessionId}/review-draft-markdown${query}`)
        .then((res) => {
          if (!res.ok) throw new Error("Failed to fetch markdown draft");
          return res.json() as Promise<{ markdown?: string }>;
        })
        .then((data) => {
          setMarkdown(String(data.markdown || ""));
          setLoading(false);
        })
        .catch((err) => {
          console.error("Error fetching markdown draft:", err);
          setError("Failed to load draft markdown");
          setLoading(false);
        });

      return;
    }

    fetch(`${apiBaseUrl}/api/research/sessions`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch sessions");
        return res.json();
      })
      .then((data) => {
        setSessions(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Error fetching sessions:", err);
        setError("Failed to load sessions");
        setLoading(false);
      });
  }, [apiBaseUrl, isOpen, markdownContent, markdownPlanId, markdownSessionId, mode]);

  const hasMarkdownContent = mode === "markdown" && Boolean((markdownContent ?? markdown).trim());
  const effectiveLoading = mode === "markdown"
    ? ((markdownLoading ?? loading) && !hasMarkdownContent)
    : loading;
  const effectiveError = mode === "markdown" ? (markdownError ?? error) : error;
  const effectiveMarkdown = mode === "markdown" ? (markdownContent ?? markdown) : "";

  return (
    <>
      {/* Sidebar Toggle Button */}
      <button
        className="sidebar-toggle"
        onClick={onToggle}
        aria-label="Toggle session sidebar"
        title={isOpen ? "Close sidebar" : "Open sidebar"}
      >
        {isOpen ? "‹" : "›"}
      </button>

      {/* Sidebar */}
      <aside className={`session-sidebar ${isOpen ? "open" : ""}`}>
        <div className="sidebar-header">
          <h2>{mode === "markdown" ? "Approved Draft" : "Sessions"}</h2>
          <button
            className="sidebar-close"
            onClick={onToggle}
            aria-label="Close sidebar"
          >
            ✕
          </button>
        </div>

        <div className="sidebar-content">
          {effectiveLoading && <div className="sidebar-loading">Loading...</div>}
          {effectiveError && <div className="sidebar-error">{effectiveError}</div>}

          {!effectiveLoading && !effectiveError && mode === "markdown" && !effectiveMarkdown.trim() && (
            <div className="sidebar-empty">No approved content yet</div>
          )}

          {!effectiveLoading && !effectiveError && mode === "markdown" && effectiveMarkdown.trim() && (
            <pre className="sidebar-markdown">{effectiveMarkdown}</pre>
          )}

          {!effectiveLoading && !effectiveError && mode === "sessions" && sessions.length === 0 && (
            <div className="sidebar-empty">No sessions yet</div>
          )}

          {!effectiveLoading && !effectiveError && mode === "sessions" && sessions.length > 0 && (
            <ul className="sessions-list">
              {sessions.map((session) => (
                <li
                  key={session.id}
                  className={`session-item ${
                    session.id === currentSessionId ? "active" : ""
                  }`}
                  onClick={() => onSessionSelect?.(session.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      onSessionSelect?.(session.id);
                    }
                  }}
                >
                  <div className="session-title">{session.topic}</div>
                  <div className="session-meta">
                    <span className="session-status">{session.status}</span>
                    <span className="session-date">
                      {new Date(session.updatedAt).toLocaleDateString()}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      {/* Overlay for closing sidebar on small screens */}
      {isOpen && (
        <div
          className="sidebar-overlay"
          onClick={onToggle}
          aria-hidden="true"
        />
      )}
    </>
  );
}
