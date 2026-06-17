// Top-left toggle that collapses/expands the knowledge-base sidebar.
// Rendered by AppShell; absolutely positioned, present in both states.

import { PanelLeftIcon } from '../icons';

interface SidebarToggleProps {
  open: boolean;
  onToggle: () => void;
}

export default function SidebarToggle({ open, onToggle }: SidebarToggleProps) {
  return (
    <button
      type="button"
      className="sidebar-toggle"
      onClick={onToggle}
      aria-label={open ? 'Collapse knowledge base' : 'Expand knowledge base'}
      aria-expanded={open}
      aria-controls="kb-sidebar"
    >
      <PanelLeftIcon />
    </button>
  );
}
