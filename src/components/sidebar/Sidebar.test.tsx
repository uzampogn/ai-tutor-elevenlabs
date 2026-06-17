import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import Sidebar from './Sidebar';

const noop = () => {};

function renderSidebar(collapsed: boolean) {
  return render(
    <Sidebar
      articles={[]}
      articlesLoading={false}
      activeUrl={null}
      collapsed={collapsed}
      onRefresh={noop}
      onOpenArticle={noop}
    />,
  );
}

describe('Sidebar collapse state', () => {
  it('is inert and aria-hidden when collapsed', () => {
    const { container } = renderSidebar(true);
    const aside = container.querySelector('#kb-sidebar') as HTMLElement;
    expect(aside).not.toBeNull();
    expect(aside.hasAttribute('inert')).toBe(true);
    expect(aside.getAttribute('aria-hidden')).toBe('true');
  });

  it('is interactive (no inert) and not aria-hidden when open', () => {
    const { container } = renderSidebar(false);
    const aside = container.querySelector('#kb-sidebar') as HTMLElement;
    expect(aside.hasAttribute('inert')).toBe(false);
    expect(aside.getAttribute('aria-hidden')).toBe('false');
  });
});
