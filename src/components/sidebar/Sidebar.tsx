// Left column: brand, KB header, and the article list. Collapsible via the
// top-left SidebarToggle; when collapsed the aside is `inert` (out of tab order).

import { useEffect, useRef } from 'react';
import type { Article } from '@/lib/types';
import Brand from './Brand';
import KbHeader from './KbHeader';
import KbList from './KbList';

interface SidebarProps {
  articles: Article[];
  articlesLoading: boolean;
  activeUrl: string | null;
  collapsed: boolean;
  onRefresh: () => void;
  onOpenArticle: (article: Article, trigger: HTMLButtonElement | null) => void;
}

export default function Sidebar({
  articles,
  articlesLoading,
  activeUrl,
  collapsed,
  onRefresh,
  onOpenArticle,
}: SidebarProps) {
  const asideRef = useRef<HTMLElement>(null);

  // `inert` removes the collapsed sidebar from the tab order and the
  // accessibility tree. Set imperatively because React 18 / @types/react 18
  // do not pass the `inert` JSX attribute through.
  useEffect(() => {
    const el = asideRef.current;
    if (!el) return;
    if (collapsed) el.setAttribute('inert', '');
    else el.removeAttribute('inert');
  }, [collapsed]);

  return (
    <aside ref={asideRef} id="kb-sidebar" className="sidebar" aria-hidden={collapsed}>
      <div className="sidebar-inner">
        <Brand />
        <KbHeader count={articles.length} loading={articlesLoading} onRefresh={onRefresh} />
        <KbList
          articles={articles}
          loading={articlesLoading}
          activeUrl={activeUrl}
          onOpen={onOpenArticle}
        />
      </div>
    </aside>
  );
}
