import { type AnnounceTarget } from "@rx-twitter/shared";
import { type FunctionComponent } from "preact";
import { useState, useEffect } from "preact/hooks";

import { formatAnnounceTargetLabel, isSameAnnounceTarget } from "@/lib/announce-target";

interface ConfigSnapshot {
  allowAllChannels: boolean;
  whitelistedChannelIds: string[];
  maxUrlsPerMessage?: number | null;
  announceTarget?: AnnounceTarget | null;
}

interface AuditLogEntry {
  id: number;
  guildId: string;
  userId: string;
  username: string | null;
  action: string;
  oldVersion: number | null;
  newVersion: number;
  changes: {
    previous?: ConfigSnapshot;
    current?: ConfigSnapshot;
  };
  createdAt: string;
}

interface ChannelInfo {
  id: string;
  name: string;
}

interface AuditLogsProps {
  guildId: string;
  channels?: ChannelInfo[];
}

export const AuditLogs: FunctionComponent<AuditLogsProps> = ({
  guildId,
  channels: channelsProp = [],
}) => {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [limit] = useState(20);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [channels, setChannels] = useState<ChannelInfo[]>(channelsProp);

  const channelMap = new Map(channels.map((ch) => [ch.id, ch.name]));

  useEffect(() => {
    if (channelsProp.length > 0) return;
    fetch(`/api/guilds/${guildId}/channels`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const list = data?.data?.channels;
        if (Array.isArray(list)) {
          setChannels(
            list.map((ch: { id: string; name: string }) => ({
              id: ch.id,
              name: ch.name,
            })),
          );
        }
      })
      .catch(() => {});
  }, [guildId]);

  const fetchLogs = async (offset: number) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/guilds/${guildId}/audit-logs?limit=${limit}&offset=${offset}`,
      );

      if (!response.ok) {
        if (response.status === 401) {
          window.location.href = "/api/auth/discord/login";
          return;
        }
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json();
      setLogs(result.data.logs);
      setTotal(result.data.pagination.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs(page * limit);
  }, [page, guildId, limit]);

  useEffect(() => {
    const onConfigSaved = () => {
      setPage(0);
      fetchLogs(0);
    };
    window.addEventListener("config-saved", onConfigSaved);
    return () => window.removeEventListener("config-saved", onConfigSaved);
  }, [guildId]);

  const formatDate = (isoString: string) => {
    const date = new Date(isoString);
    return new Intl.DateTimeFormat("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(date);
  };

  const getChangeSummary = (entry: AuditLogEntry) => {
    const changes: string[] = [];
    const prev = entry.changes.previous;
    const curr = entry.changes.current;

    if (!prev || !curr) return "変更なし";

    if (prev.allowAllChannels !== curr.allowAllChannels) {
      changes.push(
        `全チャンネル許可: ${prev.allowAllChannels ? "ON" : "OFF"} → ${curr.allowAllChannels ? "ON" : "OFF"}`,
      );
    }

    const prevIds = new Set(prev.whitelistedChannelIds || []);
    const currIds = new Set(curr.whitelistedChannelIds || []);
    const added = [...currIds].filter((id) => !prevIds.has(id));
    const removed = [...prevIds].filter((id) => !currIds.has(id));

    if (added.length > 0) changes.push(`チャンネル追加: ${added.length}件`);
    if (removed.length > 0) changes.push(`チャンネル削除: ${removed.length}件`);

    const prevMax = prev.maxUrlsPerMessage ?? null;
    const currMax = curr.maxUrlsPerMessage ?? null;
    if (prevMax !== currMax) {
      const prevLabel = prevMax !== null ? `${prevMax}件` : "デフォルト(3)";
      const currLabel = currMax !== null ? `${currMax}件` : "デフォルト(3)";
      changes.push(`URL上限: ${prevLabel} → ${currLabel}`);
    }

    if (!isSameAnnounceTarget(prev.announceTarget, curr.announceTarget)) {
      changes.push(
        `お知らせ配信先: ${formatAnnounceTargetLabel(
          prev.announceTarget,
          formatChannelName,
        )} → ${formatAnnounceTargetLabel(curr.announceTarget, formatChannelName)}`,
      );
    }

    return changes.length > 0 ? changes.join(", ") : "変更なし";
  };

  const hasDetails = (entry: AuditLogEntry) => {
    const prev = entry.changes.previous;
    const curr = entry.changes.current;
    if (!prev || !curr) return false;

    const prevIds = new Set(prev.whitelistedChannelIds || []);
    const currIds = new Set(curr.whitelistedChannelIds || []);
    const added = [...currIds].filter((id) => !prevIds.has(id));
    const removed = [...prevIds].filter((id) => !currIds.has(id));

    const prevMax = prev.maxUrlsPerMessage ?? null;
    const currMax = curr.maxUrlsPerMessage ?? null;

    return (
      prev.allowAllChannels !== curr.allowAllChannels ||
      added.length > 0 ||
      removed.length > 0 ||
      prevMax !== currMax ||
      !isSameAnnounceTarget(prev.announceTarget, curr.announceTarget)
    );
  };

  const formatChannelName = (id: string) => {
    const name = channelMap.get(id);
    return name ? `# ${name}` : id;
  };

  const renderDetails = (entry: AuditLogEntry) => {
    const prev = entry.changes.previous;
    const curr = entry.changes.current;
    if (!prev || !curr) return null;

    const prevIds = new Set(prev.whitelistedChannelIds || []);
    const currIds = new Set(curr.whitelistedChannelIds || []);
    const added = [...currIds].filter((id) => !prevIds.has(id));
    const removed = [...prevIds].filter((id) => !currIds.has(id));

    return (
      <div class="audit-detail">
        {prev.allowAllChannels !== curr.allowAllChannels && (
          <div class="audit-detail-section">
            <span class="audit-detail-label">全チャンネル許可</span>
            <span class={`audit-badge ${curr.allowAllChannels ? "badge-on" : "badge-off"}`}>
              {prev.allowAllChannels ? "ON" : "OFF"} → {curr.allowAllChannels ? "ON" : "OFF"}
            </span>
          </div>
        )}
        {added.length > 0 && (
          <div class="audit-detail-section">
            <span class="audit-detail-label">追加されたチャンネル ({added.length}件)</span>
            <ul class="audit-channel-list">
              {added.map((id) => (
                <li key={id} class="channel-added">
                  {formatChannelName(id)}
                </li>
              ))}
            </ul>
          </div>
        )}
        {removed.length > 0 && (
          <div class="audit-detail-section">
            <span class="audit-detail-label">削除されたチャンネル ({removed.length}件)</span>
            <ul class="audit-channel-list">
              {removed.map((id) => (
                <li key={id} class="channel-removed">
                  {formatChannelName(id)}
                </li>
              ))}
            </ul>
          </div>
        )}
        {(() => {
          const prevMax = prev.maxUrlsPerMessage ?? null;
          const currMax = curr.maxUrlsPerMessage ?? null;
          if (prevMax === currMax) return null;
          const prevLabel = prevMax !== null ? `${prevMax}件` : "デフォルト(3)";
          const currLabel = currMax !== null ? `${currMax}件` : "デフォルト(3)";
          return (
            <div class="audit-detail-section">
              <span class="audit-detail-label">URL処理上限</span>
              <span class="audit-badge badge-off">{prevLabel}</span>
              {" → "}
              <span class="audit-badge badge-on">{currLabel}</span>
            </div>
          );
        })()}
        {!isSameAnnounceTarget(prev.announceTarget, curr.announceTarget) && (
          <div class="audit-detail-section">
            <span class="audit-detail-label">お知らせ配信先</span>
            <span class="audit-badge badge-off">
              {formatAnnounceTargetLabel(prev.announceTarget, formatChannelName)}
            </span>
            {" → "}
            <span class="audit-badge badge-on">
              {formatAnnounceTargetLabel(curr.announceTarget, formatChannelName)}
            </span>
          </div>
        )}
      </div>
    );
  };

  const totalPages = Math.ceil(total / limit);

  if (loading && logs.length === 0) {
    return (
      <div class="audit-logs-loading">
        <p>読み込み中...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div class="audit-logs-error">
        <p>エラーが発生しました: {error}</p>
        <button onClick={() => fetchLogs(page * limit)}>再試行</button>
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div class="audit-logs-empty">
        <p>まだ監査ログはありません。</p>
      </div>
    );
  }

  return (
    <div class="audit-logs">
      <div class="audit-logs-header">
        <h2>変更履歴</h2>
        <p class="audit-logs-count">全 {total} 件の変更記録があります。</p>
      </div>

      <div class="audit-logs-table-wrapper">
        <table class="audit-logs-table">
          <thead>
            <tr>
              <th class="audit-th-no">No.</th>
              <th>日時</th>
              <th>変更内容</th>
              <th>変更者</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((entry, index) => {
              const expandable = hasDetails(entry);
              const isExpanded = expandedId === entry.id;
              const no = total - page * limit - index;
              return (
                <>
                  <tr
                    key={entry.id}
                    class={`${expandable ? "audit-row-expandable" : ""} ${isExpanded ? "audit-row-expanded" : ""}`}
                    onClick={() => expandable && setExpandedId(isExpanded ? null : entry.id)}
                  >
                    <td class="audit-log-no">{no}</td>
                    <td class="audit-log-date">
                      {expandable && (
                        <span class={`audit-expand-icon ${isExpanded ? "open" : ""}`}>▶</span>
                      )}
                      {formatDate(entry.createdAt)}
                    </td>
                    <td class="audit-log-changes">{getChangeSummary(entry)}</td>
                    <td class="audit-log-user">{entry.username || `User ${entry.userId}`}</td>
                  </tr>
                  {isExpanded && (
                    <tr key={`${entry.id}-detail`} class="audit-detail-row">
                      <td colSpan={4}>{renderDetails(entry)}</td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div class="audit-logs-pagination">
          <button
            disabled={page === 0 || loading}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            class="pagination-btn"
          >
            前へ
          </button>
          <span class="pagination-info">
            {page + 1} / {totalPages} ページ
          </span>
          <button
            disabled={page >= totalPages - 1 || loading}
            onClick={() => setPage((p) => p + 1)}
            class="pagination-btn"
          >
            次へ
          </button>
        </div>
      )}

      <style>{`
        .audit-logs {
          margin-top: 2rem;
          padding: 1.5rem;
          background: #f8f9fa;
          border-radius: 8px;
        }

        .audit-logs-header {
          margin-bottom: 1.5rem;
        }

        .audit-logs-header h2 {
          margin: 0 0 0.5rem 0;
          font-size: 1.5rem;
          color: #333;
        }

        .audit-logs-count {
          margin: 0;
          font-size: 0.9rem;
          color: #666;
        }

        .audit-logs-table-wrapper {
          overflow-x: auto;
          background: white;
          border-radius: 4px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        }

        .audit-logs-table {
          width: 100%;
          border-collapse: collapse;
          min-width: 600px;
        }

        .audit-logs-table thead {
          background: #f1f3f5;
        }

        .audit-logs-table th {
          padding: 0.75rem 1rem;
          text-align: left;
          font-weight: 600;
          color: #495057;
          border-bottom: 2px solid #dee2e6;
        }

        .audit-logs-table td {
          padding: 0.75rem 1rem;
          border-bottom: 1px solid #e9ecef;
        }

        .audit-logs-table tbody tr:hover {
          background: #f8f9fa;
        }

        .audit-log-date {
          white-space: nowrap;
          font-size: 0.9rem;
          color: #6c757d;
        }

        .audit-th-no,
        .audit-log-no {
          width: 3.5rem;
          text-align: center;
          font-variant-numeric: tabular-nums;
          color: #6c757d;
        }

        .audit-log-changes {
          color: #495057;
        }

        .audit-log-user {
          color: #6c757d;
        }

        .audit-logs-pagination {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 1rem;
          margin-top: 1.5rem;
        }

        .pagination-btn {
          padding: 0.5rem 1rem;
          background: white;
          border: 1px solid #dee2e6;
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .pagination-btn:hover:not(:disabled) {
          background: #f8f9fa;
          border-color: #adb5bd;
        }

        .pagination-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .pagination-info {
          font-size: 0.9rem;
          color: #6c757d;
        }

        .audit-logs-loading,
        .audit-logs-error,
        .audit-logs-empty {
          padding: 2rem;
          text-align: center;
          color: #6c757d;
        }

        .audit-logs-error button {
          margin-top: 1rem;
          padding: 0.5rem 1rem;
          background: #007bff;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
        }

        .audit-row-expandable {
          cursor: pointer;
        }

        .audit-row-expandable:hover {
          background: #e9ecef !important;
        }

        .audit-row-expanded {
          background: #e9ecef;
        }

        .audit-expand-icon {
          display: inline-block;
          margin-right: 0.4rem;
          font-size: 0.65rem;
          transition: transform 0.2s;
          vertical-align: middle;
        }

        .audit-expand-icon.open {
          transform: rotate(90deg);
        }

        .audit-detail-row td {
          padding: 0 !important;
          border-bottom: 1px solid #dee2e6;
        }

        .audit-detail {
          padding: 1rem 1.5rem;
          background: #f1f3f5;
        }

        .audit-detail-section {
          margin-bottom: 0.75rem;
        }

        .audit-detail-section:last-child {
          margin-bottom: 0;
        }

        .audit-detail-label {
          display: block;
          font-weight: 600;
          font-size: 0.85rem;
          color: #495057;
          margin-bottom: 0.35rem;
        }

        .audit-badge {
          display: inline-block;
          padding: 0.2rem 0.6rem;
          border-radius: 4px;
          font-size: 0.85rem;
          font-weight: 500;
        }

        .badge-on {
          background: #d4edda;
          color: #155724;
        }

        .badge-off {
          background: #f8d7da;
          color: #721c24;
        }

        .audit-channel-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-wrap: wrap;
          gap: 0.4rem;
        }

        .audit-channel-list li {
          padding: 0.2rem 0.6rem;
          border-radius: 4px;
          font-size: 0.85rem;
          font-family: monospace;
        }

        .channel-added {
          background: #d4edda;
          color: #155724;
        }

        .channel-removed {
          background: #f8d7da;
          color: #721c24;
        }

        .audit-logs-error button:hover {
          background: #0056b3;
        }
      `}</style>
    </div>
  );
};
