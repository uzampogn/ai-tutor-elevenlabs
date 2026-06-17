// Top-left toggle that collapses/expands the knowledge-base sidebar.
// Rendered by AppShell; absolutely positioned, present in both states.
// Visually it is the brand mark (gradient square + pulsing dot); the corner
// radius morphs square (open) ⇄ circle (closed), driven by aria-expanded in CSS.

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
      <span className="brand-pulse" aria-hidden="true" />
    </button>
  );
}
