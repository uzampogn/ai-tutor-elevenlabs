'use client';

import Composer from './Composer';
import VoiceDock from './VoiceDock';
import NewChat from './NewChat';

export type InputMode = 'voice' | 'text';

interface InputDockProps {
  inputMode: InputMode;
  setInputMode: (mode: InputMode) => void;
  input: string;
  setInput: (v: string) => void;
  isLoading: boolean;
  listening: boolean;
  setListening: (v: boolean) => void;
  onSend: (override?: string) => void;
  speaking: boolean;
  onNewChat: () => void;
  /** Pause TTS playback when a listening turn starts (forwarded to VoiceDock). */
  onStartListening?: () => void;
}

export default function InputDock({
  inputMode,
  setInputMode,
  input,
  setInput,
  isLoading,
  listening,
  setListening,
  onSend,
  speaking,
  onNewChat,
  onStartListening,
}: InputDockProps) {
  // Session controls live by the input dock and are reachable in both modes:
  // the Voice/Text switch (selects orb vs. composer) + New chat (clears the session).
  const sessionControls = (
    <div className="session-controls">
      <div className="input-mode-switch" role="group" aria-label="Input mode">
        <button
          type="button"
          className={`input-mode-btn${inputMode === 'voice' ? ' is-active' : ''}`}
          aria-pressed={inputMode === 'voice'}
          onClick={() => setInputMode('voice')}
        >
          Voice
        </button>
        <button
          type="button"
          className={`input-mode-btn${inputMode === 'text' ? ' is-active' : ''}`}
          aria-pressed={inputMode === 'text'}
          onClick={() => setInputMode('text')}
        >
          Text
        </button>
      </div>
      <NewChat onClick={onNewChat} />
    </div>
  );

  if (inputMode === 'voice') {
    return (
      <>
        <VoiceDock
          input={input}
          setInput={setInput}
          isLoading={isLoading}
          listening={listening}
          setListening={setListening}
          onSend={onSend}
          speaking={speaking}
          onStartListening={onStartListening}
          controls={sessionControls}
        />
        <div className="composer-foot">
          Answers are grounded in the Claude blog and may be imperfect.
        </div>
      </>
    );
  }

  // Text mode: Composer already renders .composer-wrap; prefix with the session controls.
  return (
    <>
      {sessionControls}
      <Composer
        input={input}
        setInput={setInput}
        isLoading={isLoading}
        listening={listening}
        setListening={setListening}
        onSend={onSend}
      />
    </>
  );
}
