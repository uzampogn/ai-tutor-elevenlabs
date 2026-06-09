// TTS on/off pill with a waveform that animates while audio is playing.

import Waveform from '../Waveform';
import { SoundIcon } from '../icons';

interface VoiceToggleProps {
  enabled: boolean;
  /** True while TTS audio is actively playing (drives the waveform). */
  speaking: boolean;
  onToggle: () => void;
}

export default function VoiceToggle({ enabled, speaking, onToggle }: VoiceToggleProps) {
  return (
    <button
      type="button"
      className={`voice-toggle${enabled ? ' on' : ''}`}
      onClick={onToggle}
      aria-pressed={enabled}
      aria-label={enabled ? 'Turn voice off' : 'Turn voice on'}
    >
      <span className="vt-icon">
        <SoundIcon />
      </span>
      <Waveform active={enabled && speaking} bars={5} />
      {enabled ? 'Voice on' : 'Voice off'}
    </button>
  );
}
