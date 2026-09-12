// Knowledge-base header: title, liveness (live dot + source count), refresh.

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
          <span className="live-dot" aria-hidden="true" />
          {loading ? 'Refreshing' : 'Live'}
        </span>
        <span className="kb-count">
          {count === 0 && loading ? '…' : `${count} ${count === 1 ? 'source' : 'sources'}`}
        </span>
      </div>
    </div>
  );
}
