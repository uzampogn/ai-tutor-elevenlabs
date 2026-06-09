// Shared animated waveform bars. Used by the VoiceToggle (TTS) and reflects
// active state while TTS audio is playing OR while STT is listening.

interface WaveformProps {
  active: boolean;
  /** Number of bars (default 16 per the mockup). */
  bars?: number;
}

export default function Waveform({ active, bars = 16 }: WaveformProps) {
  return (
    <span className={`wave${active ? ' is-active' : ''}`} aria-hidden="true">
      {Array.from({ length: bars }, (_, i) => (
        // --i drives the staggered animation-delay in globals.css.
        <span key={i} style={{ ['--i' as string]: i } as React.CSSProperties} />
      ))}
    </span>
  );
}
