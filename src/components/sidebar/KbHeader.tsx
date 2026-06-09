// Knowledge-base header: title, refresh button, live dot + source count.

import { RefreshIcon } from '../icons';

interface KbHeaderProps {
  count: number;
  loading: boolean;
  onRefresh: () => void;
}

export default function KbHeader({ count, loading, onRefresh }: KbHeaderProps) {
  return (
    <div className="kb-head">
      <div className="kb-title">
        <span>Knowledge base</span>
        <button
          type="button"
          className={`kb-refresh${loading ? ' spinning' : ''}`}
          onClick={onRefresh}
          aria-label="Refresh knowledge base"
          disabled={loading}
        >
          <RefreshIcon />
        </button>
      </div>
      <div className="kb-meta">
        <span className="kb-live">
          <span className="live-dot" />
          Live
        </span>
        <span className="kb-mono">{count} sources</span>
      </div>
    </div>
  );
}
