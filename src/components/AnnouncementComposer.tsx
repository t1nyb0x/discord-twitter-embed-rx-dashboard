import { ANNOUNCEMENT_BODY_MAX_LENGTH, ANNOUNCEMENT_TITLE_MAX_LENGTH } from "@rx-twitter/shared";
import { type FunctionComponent } from "preact";
import { useState } from "preact/hooks";

type SendState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; id: string }
  | { kind: "failed"; message: string };

export const AnnouncementComposer: FunctionComponent = () => {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [state, setState] = useState<SendState>({ kind: "idle" });

  const trimmedTitle = title.trim();
  const trimmedBody = body.trim();

  const titleTooLong = title.length > ANNOUNCEMENT_TITLE_MAX_LENGTH;
  const bodyTooLong = body.length > ANNOUNCEMENT_BODY_MAX_LENGTH;
  const canSend =
    trimmedTitle.length > 0 &&
    trimmedBody.length > 0 &&
    !titleTooLong &&
    !bodyTooLong &&
    state.kind !== "sending";

  const send = async () => {
    if (!canSend) return;

    const confirmed = window.confirm(
      `このお知らせを Bot が参加している全サーバーへ送信します。\n送信の取り消しはできません。\n\nタイトル: ${trimmedTitle}\n\n送信しますか？`,
    );
    if (!confirmed) return;

    setState({ kind: "sending" });

    try {
      const response = await fetch("/api/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmedTitle, body: trimmedBody }),
      });

      const result = await response.json().catch(() => null);

      if (!response.ok) {
        const message = result?.error?.message ?? `送信に失敗しました（HTTP ${response.status}）`;
        setState({ kind: "failed", message });
        return;
      }

      setState({ kind: "sent", id: result?.data?.id ?? "" });
      setTitle("");
      setBody("");
    } catch (err) {
      setState({
        kind: "failed",
        message: err instanceof Error ? err.message : "送信に失敗しました",
      });
    }
  };

  return (
    <div class="composer">
      <section class="composer-form">
        <h2>お知らせの作成</h2>

        <label class="field">
          <span class="field-label">
            タイトル
            <span class={`counter ${titleTooLong ? "counter-over" : ""}`}>
              {title.length} / {ANNOUNCEMENT_TITLE_MAX_LENGTH}
            </span>
          </span>
          <input
            type="text"
            class="field-input"
            value={title}
            placeholder="メンテナンスのお知らせ"
            onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
          />
        </label>

        <label class="field">
          <span class="field-label">
            本文
            <span class={`counter ${bodyTooLong ? "counter-over" : ""}`}>
              {body.length} / {ANNOUNCEMENT_BODY_MAX_LENGTH}
            </span>
          </span>
          <textarea
            class="field-textarea"
            rows={10}
            value={body}
            placeholder="本日 22 時からメンテナンスを実施します。"
            onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)}
          />
        </label>

        <div class="actions">
          <button class="send-button" disabled={!canSend} onClick={send}>
            {state.kind === "sending" ? "送信中..." : "全サーバーへ送信"}
          </button>
          <p class="actions-note">
            送信すると Bot が参加している全サーバーへ即時配信されます。取り消しはできません。
          </p>
        </div>

        {state.kind === "sent" && (
          <div class="status status-ok">
            <strong>送信しました。</strong>
            <span class="status-id">ID: {state.id}</span>
            <p>各サーバーの配信先設定に従って順次届きます。</p>
          </div>
        )}

        {state.kind === "failed" && (
          <div class="status status-error">
            <strong>送信できませんでした。</strong>
            <p>{state.message}</p>
          </div>
        )}
      </section>

      <section class="composer-preview">
        <h2>プレビュー</h2>
        <p class="preview-note">実際に各サーバーへ届く見え方の目安です。</p>
        <div class="preview-card">
          <div class="preview-title">{trimmedTitle || "（タイトル未入力）"}</div>
          <div class="preview-body">{trimmedBody || "（本文未入力）"}</div>
        </div>
      </section>

      <style>{`
        .composer {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          gap: 2rem;
          align-items: start;
        }

        @media (max-width: 900px) {
          .composer {
            grid-template-columns: minmax(0, 1fr);
          }
        }

        .composer h2 {
          margin: 0 0 1rem 0;
          font-size: 1.25rem;
          color: #333;
        }

        .composer-form,
        .composer-preview {
          background: #fff;
          border: 1px solid #e0e0e0;
          border-radius: 8px;
          padding: 1.5rem;
        }

        .field {
          display: block;
          margin-bottom: 1.25rem;
        }

        .field-label {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          font-size: 0.95rem;
          color: #444;
          margin-bottom: 0.4rem;
        }

        .counter {
          font-size: 0.8rem;
          color: #6c757d;
          font-variant-numeric: tabular-nums;
        }

        .counter-over {
          color: #c0392b;
          font-weight: 600;
        }

        .field-input,
        .field-textarea {
          width: 100%;
          box-sizing: border-box;
          padding: 0.75rem 1rem;
          border: 1px solid #e0e0e0;
          border-radius: 8px;
          font-size: 1rem;
          font-family: inherit;
        }

        .field-textarea {
          resize: vertical;
          line-height: 1.6;
        }

        .field-input:focus,
        .field-textarea:focus {
          outline: none;
          border-color: #5865f2;
          box-shadow: 0 0 0 3px rgba(88, 101, 242, 0.1);
        }

        .actions {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .send-button {
          padding: 0.85rem 1.5rem;
          background: #5865f2;
          color: #fff;
          border: none;
          border-radius: 8px;
          font-size: 1rem;
          font-weight: 600;
          cursor: pointer;
        }

        .send-button:hover:not(:disabled) {
          background: #4752c4;
        }

        .send-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .actions-note {
          margin: 0;
          font-size: 0.85rem;
          color: #6c757d;
        }

        .status {
          margin-top: 1.25rem;
          padding: 1rem;
          border-radius: 8px;
          font-size: 0.9rem;
        }

        .status p {
          margin: 0.4rem 0 0 0;
        }

        .status-ok {
          background: #d4edda;
          color: #155724;
        }

        .status-error {
          background: #f8d7da;
          color: #721c24;
        }

        .status-id {
          display: block;
          margin-top: 0.25rem;
          font-family: monospace;
          font-size: 0.8rem;
          opacity: 0.8;
          word-break: break-all;
        }

        .preview-note {
          margin: 0 0 1rem 0;
          font-size: 0.85rem;
          color: #6c757d;
        }

        .preview-card {
          border-left: 4px solid #5865f2;
          background: #f8f9fa;
          border-radius: 4px;
          padding: 1rem 1.25rem;
        }

        .preview-title {
          font-weight: 700;
          font-size: 1.05rem;
          color: #2c2f33;
          margin-bottom: 0.5rem;
          word-break: break-word;
        }

        .preview-body {
          white-space: pre-wrap;
          word-break: break-word;
          line-height: 1.7;
          color: #2c2f33;
        }
      `}</style>
    </div>
  );
};
