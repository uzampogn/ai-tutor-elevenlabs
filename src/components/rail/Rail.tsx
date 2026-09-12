// The icon rail: the mark (collapses the knowledge base), New chat, and the
// Text fallback. Names appear beside the icon on hover and focus (.rail-name).
// Replaces the floating Voice / Text / New chat pill (shape brief §3).

import SidebarToggle from '../sidebar/SidebarToggle';
import { PlusIcon, KeyboardIcon } from '../icons';

export type InputMode = 'voice' | 'text';

interface RailProps {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  inputMode: InputMode;
  /** True when the browser has no voice input: the Text control is then fixed on. */
  voiceUnavailable?: boolean;
  onSetInputMode: (mode: InputMode) => void;
  onNewChat: () => void;
}

export default function Rail({
  sidebarOpen,
  onToggleSidebar,
  inputMode,
  voiceUnavailable = false,
  onSetInputMode,
  onNewChat,
}: RailProps) {
  const textOn = inputMode === 'text';
  const textName = voiceUnavailable ? 'Text only' : textOn ? 'Back to voice' : 'Type instead';
  return (
    <nav className="rail" aria-label="Session">
      <SidebarToggle open={sidebarOpen} onToggle={onToggleSidebar} />
      <button type="button" className="rail-btn" onClick={onNewChat} aria-label="New chat">
        <PlusIcon />
        <span className="rail-name" aria-hidden="true">New chat</span>
      </button>
      <button
        type="button"
        className="rail-btn"
        aria-label="Text mode"
        aria-pressed={textOn}
        disabled={voiceUnavailable}
        onClick={() => onSetInputMode(textOn ? 'voice' : 'text')}
      >
        <KeyboardIcon />
        <span className="rail-name" aria-hidden="true">{textName}</span>
      </button>
    </nav>
  );
}
