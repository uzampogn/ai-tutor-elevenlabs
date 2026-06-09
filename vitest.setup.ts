import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});

// --- jsdom gaps the redesign relies on -------------------------------------

// reduced-motion / responsive checks
if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

// TTS audio playback
if (typeof HTMLMediaElement !== 'undefined') {
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  HTMLMediaElement.prototype.pause = vi.fn();
}

// TTS blob URLs
if (!URL.createObjectURL) {
  URL.createObjectURL = vi.fn(() => 'blob:mock');
}
if (!URL.revokeObjectURL) {
  URL.revokeObjectURL = vi.fn();
}

// Speech-to-text (Web Speech API) — fake constructor so STT paths are testable.
class MockSpeechRecognition {
  lang = '';
  continuous = false;
  interimResults = false;
  onresult: ((e: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();
}
// @ts-expect-error augmenting window for tests
window.SpeechRecognition = MockSpeechRecognition;
// @ts-expect-error augmenting window for tests
window.webkitSpeechRecognition = MockSpeechRecognition;
