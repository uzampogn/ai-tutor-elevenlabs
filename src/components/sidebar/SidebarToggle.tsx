// The mark, doubling as the knowledge-base collapse control. First control on
// the rail; present in both states, aria-expanded drives its look in CSS.

import Mark from '../Mark';

interface SidebarToggleProps {
  open: boolean;
  onToggle: () => void;
}

export default function SidebarToggle({ open, onToggle }: SidebarToggleProps) {
  return (
    <button
      type="button"
      className="rail-btn sidebar-toggle"
      onClick={onToggle}
      aria-label={open ? 'Collapse knowledge base' : 'Expand knowledge base'}
      aria-expanded={open}
      aria-controls="kb-sidebar"
    >
      <Mark className="mark" size={20} />
      <span className="rail-name" aria-hidden="true">
        {open ? 'Hide knowledge base' : 'Knowledge base'}
      </span>
    </button>
  );
}
