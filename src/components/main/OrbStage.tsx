'use client';

// OrbStage — the orb as a free body over the main plane.
//
// The orb lives outside the thread's DOM, positioned in plane coordinates. It
// measures its pose from anchor slots the layout leaves for it
// (`[data-orb-anchor="centre"]` on the welcome, `[data-orb-anchor="home"]` at
// the foot), drifts between them when the pose changes (transform only, 400ms
// ease-out-quart in CSS; an instant swap under reduced motion), and can be
// dragged: on desktop it snaps to the nearest edge of the plane and keeps that
// place for the session; below 880px it has 2 homes (bottom-right, bottom-centre)
// and a drag ends on the nearer one. A new chat returns it to centre stage.
//
// It also owns voice input: tap to talk (tap again while listening sends now),
// plus the `V` key outside editable fields — default, unratified.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import Orb, { type OrbState } from './Orb';
import { useVoiceInput } from './useVoiceInput';

export type OrbPose = 'centre' | 'home';

interface Box {
  x: number;
  y: number;
  size: number;
}
interface Placed {
  x: number;
  y: number;
}

interface OrbStageProps {
  /** The main plane the orb lives over; anchors are queried inside it. */
  planeRef: RefObject<HTMLElement>;
  /** `centre` on the welcome; `home` once the conversation (or text mode) starts. */
  pose: OrbPose;
  isMobile: boolean;
  input: string;
  setInput: (v: string) => void;
  isLoading: boolean;
  listening: boolean;
  setListening: (v: boolean) => void;
  onSend: (override?: string) => void;
  speaking: boolean;
  /** Pause TTS playback when a listening turn starts (echo strategy). */
  onStartListening?: () => void;
  /** Lets the shell force Text mode when the browser has no voice input. */
  onSupportedChange?: (supported: boolean) => void;
}

const EDGE = 24;
const MOBILE_EDGE = 16;
const DRAG_THRESHOLD = 6;
const CAPTION_ROOM = 240;

function readPx(el: Element, name: string, fallback: number): number {
  const v = parseFloat(getComputedStyle(el).getPropertyValue(name));
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(v, hi));
}

export default function OrbStage({
  planeRef,
  pose,
  isMobile,
  input,
  setInput,
  isLoading,
  listening,
  setListening,
  onSend,
  speaking,
  onStartListening,
  onSupportedChange,
}: OrbStageProps) {
  const { supported, toggle, sendNow } = useVoiceInput({
    listening,
    setListening,
    onInterim: (t) => setInput(t),
    onFinal: (t) => {
      setInput(t);
      onSend(t);
    },
    disabled: isLoading,
    onStartListening,
  });

  useEffect(() => {
    onSupportedChange?.(supported);
  }, [supported, onSupportedChange]);

  // Precedence: speaking > thinking > listening > idle.
  const orbState: OrbState = speaking ? 'speaking' : isLoading ? 'thinking' : listening ? 'listening' : 'idle';

  const [box, setBox] = useState<Box | null>(null);
  const [base, setBase] = useState(144);
  const [placed, setPlaced] = useState<Placed | null>(null);
  const [dragging, setDragging] = useState(false);

  // A new chat (pose back to centre) forgets the session position, and so does
  // crossing the 880px breakpoint (desktop edges and mobile homes differ).
  useEffect(() => {
    if (pose === 'centre') setPlaced(null);
  }, [pose]);
  useEffect(() => {
    setPlaced(null);
  }, [isMobile]);

  const measure = useCallback(() => {
    const plane = planeRef.current;
    if (!plane) return;
    const pr = plane.getBoundingClientRect();
    const centreSize = readPx(plane, '--orb-centre', 144);
    const homeSize = readPx(plane, '--orb-home', 72);
    const size = pose === 'centre' ? centreSize : homeSize;
    let x: number;
    let y: number;
    if (pose === 'home' && placed) {
      const edge = isMobile ? MOBILE_EDGE : EDGE;
      x = clamp(placed.x, edge, Math.max(edge, pr.width - size - edge));
      y = clamp(placed.y, edge, Math.max(edge, pr.height - size - edge));
    } else {
      const anchor = plane.querySelector<HTMLElement>(`[data-orb-anchor="${pose}"]`);
      const ar = anchor?.getBoundingClientRect();
      // A slot that has not laid out yet (zero box) is no anchor.
      if (ar && ar.width > 0 && ar.height > 0) {
        x = ar.left - pr.left + (ar.width - size) / 2;
        y = ar.top - pr.top + (ar.height - size) / 2;
      } else {
        x = (pr.width - size) / 2;
        y = pose === 'centre' ? (pr.height - size) / 2 : pr.height - size - EDGE;
      }
    }
    setBase(centreSize);
    setBox((prev) => (prev && prev.x === x && prev.y === y && prev.size === size ? prev : { x, y, size }));
  }, [planeRef, pose, placed, isMobile]);

  // Measure before paint on every pose change, and again whenever the plane or
  // its anchor moves (KB collapse, viewport resize, the welcome reflowing as the
  // font arrives, the welcome scrolling on a short viewport).
  useLayoutEffect(() => {
    measure();
    // On first mount the parent's ref is attached after this child effect runs;
    // a microtask still lands before paint.
    if (!planeRef.current) queueMicrotask(measure);
  }, [measure, planeRef]);

  useEffect(() => {
    const plane = planeRef.current;
    if (!plane) return;
    measure();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => measure()) : null;
    ro?.observe(plane);
    const anchor = plane.querySelector<HTMLElement>(`[data-orb-anchor="${pose}"]`);
    if (anchor) ro?.observe(anchor);
    const scroller = plane.querySelector<HTMLElement>('.scroll');
    const onScroll = () => measure();
    if (pose === 'centre') scroller?.addEventListener('scroll', onScroll, { passive: true });
    document.fonts?.ready.then(() => measure()).catch(() => {});
    return () => {
      ro?.disconnect();
      scroller?.removeEventListener('scroll', onScroll);
    };
  }, [planeRef, pose, measure]);

  // ── drag ────────────────────────────────────────────────────────────────
  const dragRef = useRef<{ id: number; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (pose !== 'home' || !box || e.button !== 0) return;
    dragRef.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: box.x, oy: box.y, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    d.moved = true;
    setDragging(true);
    setBox((b) => (b ? { ...b, x: d.ox + dx, y: d.oy + dy } : b));
  }

  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    dragRef.current = null;
    if (!d.moved) return;
    // The click that follows this pointerup is the end of a drag, not a tap.
    suppressClickRef.current = true;
    setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
    setDragging(false);
    const plane = planeRef.current;
    if (!plane || !box) return;
    const pr = plane.getBoundingClientRect();
    const size = box.size;
    const cx = d.ox + (e.clientX - d.sx) + size / 2;
    const cy = d.oy + (e.clientY - d.sy) + size / 2;
    if (isMobile) {
      // 2 homes: bottom-right (the foot slot) and bottom-centre.
      const anchor = plane.querySelector<HTMLElement>('[data-orb-anchor="home"]');
      const ar = anchor?.getBoundingClientRect();
      const y = ar ? ar.top - pr.top + (ar.height - size) / 2 : pr.height - size - MOBILE_EDGE;
      const right = ar ? ar.left - pr.left + (ar.width - size) / 2 : pr.width - size - MOBILE_EDGE;
      const centre = (pr.width - size) / 2;
      const x = Math.abs(cx - (right + size / 2)) <= Math.abs(cx - (centre + size / 2)) ? right : centre;
      setPlaced({ x, y });
      return;
    }
    // Desktop: snap to the nearer edge, keep the height.
    const x = cx < pr.width / 2 ? EDGE : pr.width - size - EDGE;
    const y = clamp(cy - size / 2, EDGE, Math.max(EDGE, pr.height - size - EDGE));
    setPlaced({ x, y });
  }

  function onPointerCancel() {
    dragRef.current = null;
    setDragging(false);
    measure();
  }

  // ── tap + keyboard ──────────────────────────────────────────────────────
  const actRef = useRef({ toggle, sendNow });
  actRef.current = { toggle, sendNow };

  function activate() {
    // Thinking is a pose, not a disabled control: the orb stays focusable and
    // simply ignores taps until the answer lands.
    if (suppressClickRef.current || isLoading) return;
    if (listening) actRef.current.sendNow();
    else actRef.current.toggle();
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'v' && e.key !== 'V') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (!supported || isLoading) return;
      e.preventDefault();
      if (listening) actRef.current.sendNow();
      else actRef.current.toggle();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [supported, isLoading, listening]);

  // ── layout of the body and its caption ──────────────────────────────────
  const plane = planeRef.current;
  const planeW = plane?.clientWidth ?? 0;
  const lean = box && planeW ? (box.x + box.size / 2 < planeW / 2 ? 'right' : 'left') : 'right';

  const caption = !supported
    ? "Voice input isn't available in this browser. Type your question instead."
    : listening && input.trim()
      ? input
      : null;
  const captionKind = !supported ? 'unsupported' : 'interim';

  let side: 'right' | 'left' | 'below' = 'below';
  let captionStyle: CSSProperties | undefined;
  if (box && caption !== null) {
    if (pose === 'home' && planeW && box.x + box.size + 18 + CAPTION_ROOM <= planeW) {
      side = 'right';
      captionStyle = { left: box.x + box.size + 18, top: box.y + box.size / 2 };
    } else if (pose === 'home' && box.x - 18 - CAPTION_ROOM >= 0) {
      side = 'left';
      captionStyle = { left: box.x - 18, top: box.y + box.size / 2 };
    } else {
      side = 'below';
      captionStyle = { left: box.x + box.size / 2, top: box.y + box.size + 16 };
    }
  }

  const bodyStyle = box
    ? ({
        '--x': `${box.x}px`,
        '--y': `${box.y}px`,
        '--base': `${base}px`,
        '--s': box.size / base,
      } as CSSProperties)
    : undefined;

  return (
    <div className="orb-stage">
      {box && (
        <div
          className={`orb-body${dragging ? ' is-dragging' : ''}${speaking ? ' is-speaking' : ''}`}
          data-pose={pose}
          data-lean={lean}
          style={bodyStyle}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
        >
          <Orb state={orbState} onClick={activate} disabled={!supported} />
        </div>
      )}
      {box && caption !== null && (
        <p
          className={`orb-caption${captionKind === 'unsupported' ? ' is-unsupported' : ''}`}
          data-side={side}
          style={captionStyle}
          role={captionKind === 'unsupported' ? 'status' : undefined}
          aria-live={captionKind === 'interim' ? 'polite' : undefined}
        >
          {caption}
        </p>
      )}
    </div>
  );
}
