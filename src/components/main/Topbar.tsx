// Right-column header: page title + sub, voice toggle, new-chat button.

import VoiceToggle from './VoiceToggle';
import NewChat from './NewChat';

interface TopbarProps {
  voiceEnabled: boolean;
  speaking: boolean;
  onToggleVoice: () => void;
  onNewChat: () => void;
}

export default function Topbar({ voiceEnabled, speaking, onToggleVoice, onNewChat }: TopbarProps) {
  return (
    <header className="topbar">
      <div className="topbar-l">
        <h1 className="topbar-title">AI News Tutor</h1>
        <span className="topbar-sub">Grounded in Claude&apos;s latest articles</span>
      </div>
      <div className="topbar-r">
        <VoiceToggle enabled={voiceEnabled} speaking={speaking} onToggle={onToggleVoice} />
        <NewChat onClick={onNewChat} />
      </div>
    </header>
  );
}
