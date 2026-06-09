// Left column: brand, KB header, and the article list.

import type { Article } from '@/lib/types';
import Brand from './Brand';
import KbHeader from './KbHeader';
import KbList from './KbList';

interface SidebarProps {
  articles: Article[];
  articlesLoading: boolean;
  activeUrl: string | null;
  onRefresh: () => void;
  onOpenArticle: (article: Article, trigger: HTMLButtonElement | null) => void;
}

export default function Sidebar({
  articles,
  articlesLoading,
  activeUrl,
  onRefresh,
  onOpenArticle,
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <Brand />
      <KbHeader count={articles.length} loading={articlesLoading} onRefresh={onRefresh} />
      <KbList
        articles={articles}
        loading={articlesLoading}
        activeUrl={activeUrl}
        onOpen={onOpenArticle}
      />
    </aside>
  );
}
