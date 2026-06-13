'use client';

import Composer from './Composer';
import VoiceDock from './VoiceDock';

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
}: InputDockProps) {
  const modeSwitch = (
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
          modeSwitch={modeSwitch}
        />
        <div className="composer-foot">
          Answers are grounded in the Claude blog and may be imperfect.
        </div>
      </>
    );
  }

  // Text mode: Composer already renders .composer-wrap; prefix with mode switch.
  return (
    <>
      {modeSwitch}
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
