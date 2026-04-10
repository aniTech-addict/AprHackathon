import { useEffect, useState } from "react";
import type { SessionListItem } from "../types";
import "../styles/SessionSidebar.css";

interface SessionSidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  currentSessionId: string | null;
  onSessionSelect: (sessionId: string) => void;
}

export function SessionSidebar({
  isOpen,
  onToggle,
  currentSessionId,
  onSessionSelect,
}: SessionSidebarProps) {
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    setLoading(true);
    setError(null);

    fetch("/api/research/sessions")
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
  }, [isOpen]);

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
          <h2>Sessions</h2>
          <button
            className="sidebar-close"
            onClick={onToggle}
            aria-label="Close sidebar"
          >
            ✕
          </button>
        </div>

        <div className="sidebar-content">
          {loading && <div className="sidebar-loading">Loading...</div>}
          {error && <div className="sidebar-error">{error}</div>}

          {!loading && !error && sessions.length === 0 && (
            <div className="sidebar-empty">No sessions yet</div>
          )}

          {!loading && !error && sessions.length > 0 && (
            <ul className="sessions-list">
              {sessions.map((session) => (
                <li
                  key={session.id}
                  className={`session-item ${
                    session.id === currentSessionId ? "active" : ""
                  }`}
                  onClick={() => onSessionSelect(session.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      onSessionSelect(session.id);
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
