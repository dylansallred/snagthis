import { useEffect, useRef, useState } from 'react';
import { PixelButton, pressPixelButton } from '@/components/brand/PixelButton';
import { SNAGTHIS_LOGO } from './snagthisLogo';
import { ui } from '@/lib/strings';
import './DropOverlay.css';

export type DropResult = 'added' | 'picker' | 'error' | 'busy';

const REORDER_TYPE = 'application/x-snagthis-job';
const NEAR_PX = 150;
const PRESS_MS = 520;
// Dragover repeats while a drag is over the window; silence means it left or was cancelled with Esc.
const IDLE_MS = 400;

/** A link drag from a browser or another app: never files, never the list's own row reordering. */
function acceptsDrag(event: DragEvent) {
  const types = Array.from(event.dataTransfer?.types || []);
  if (types.includes('Files') || types.includes(REORDER_TYPE)) return false;
  return types.includes('text/uri-list') || types.includes('text/plain');
}

/** The dropped text as it would have been pasted: uri-list entries one per line, else the plain text. */
function droppedText(data: DataTransfer) {
  const listed = data.getData('text/uri-list').split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  return listed.length ? listed.join('\n') : data.getData('text/plain').trim();
}

// "SNAG" in the logo's own capitals.
const SNAG = SNAGTHIS_LOGO.letters.slice(0, 4);
const SNAG_WIDTH = SNAG[3].right;

/**
 * Unique look 6 · Drop to snag. Dragging a link anywhere onto the window shows a dark overlay with
 * marching pixel borders; the big button grows as the link nears it and presses when it is dropped.
 * The drop goes through the paste field's own submit path. Visual only: keyboard and screen-reader
 * users keep the paste field, and the result is announced.
 */
export function DropOverlay({ disabled, onDropLinks }: { disabled: boolean; onDropLinks: (text: string) => Promise<DropResult> }) {
  const [shown, setShown] = useState(false);
  const [near, setNear] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const catcher = useRef<HTMLDivElement>(null);
  const submit = useRef(onDropLinks);
  useEffect(() => { submit.current = onDropLinks; });

  useEffect(() => {
    if (disabled) {
      setShown(false); setNear(false);
      // While a dialog is open a dropped link does nothing. Left unclaimed, Electron would navigate the
      // window to it (and the main process would open it in the browser). Text fields still take drops.
      const refuse = (event: DragEvent) => {
        if (!acceptsDrag(event) || (event.target instanceof HTMLElement && event.target.closest('input,textarea,[contenteditable="true"]'))) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
      };
      window.addEventListener('dragover', refuse);
      window.addEventListener('drop', refuse);
      return () => { window.removeEventListener('dragover', refuse); window.removeEventListener('drop', refuse); };
    }
    let depth = 0;
    let internal = false;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const reset = () => { depth = 0; clearTimeout(idleTimer); setShown(false); setNear(false); };
    const accepts = (event: DragEvent) => !internal && acceptsDrag(event);
    // Text or rows dragged inside the app (such as within the paste field) are not new links.
    const onStart = () => { internal = true; };
    const onEnd = () => { internal = false; reset(); };
    const onEnter = (event: DragEvent) => {
      if (!accepts(event)) return;
      event.preventDefault();
      depth += 1;
      clearTimeout(hideTimer);
      setShown(true);
    };
    const onOver = (event: DragEvent) => {
      if (!accepts(event)) return;
      // Claiming the drag keeps Electron from navigating the window to the link.
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      setShown(true);
      clearTimeout(idleTimer);
      idleTimer = setTimeout(reset, IDLE_MS);
      const box = catcher.current?.getBoundingClientRect();
      if (box) setNear(Math.hypot(event.clientX - box.left - box.width / 2, event.clientY - box.top - box.height / 2) < NEAR_PX);
    };
    const onLeave = (event: DragEvent) => {
      if (!accepts(event)) return;
      depth -= 1;
      if (depth <= 0) reset();
    };
    const onDrop = (event: DragEvent) => {
      if (!accepts(event) || !event.dataTransfer) return;
      event.preventDefault();
      const text = droppedText(event.dataTransfer);
      depth = 0;
      clearTimeout(idleTimer);
      setNear(false);
      pressPixelButton(catcher.current?.querySelector('.pixel-button'));
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      hideTimer = setTimeout(() => setShown(false), reduced ? 0 : PRESS_MS);
      if (!text) { setShown(false); return; }
      setAnnouncement(ui.dropChecking);
      void submit.current(text).then((result) => {
        setAnnouncement(result === 'added' ? ui.dropAdded : result === 'picker' ? ui.dropChoose : result === 'busy' ? ui.dropBusy : '');
      });
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    window.addEventListener('dragstart', onStart);
    window.addEventListener('dragend', onEnd);
    return () => {
      clearTimeout(hideTimer);
      clearTimeout(idleTimer);
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragstart', onStart);
      window.removeEventListener('dragend', onEnd);
    };
  }, [disabled]);

  return <>
    <div className={`drop-overlay${shown ? ' show' : ''}${near ? ' near' : ''}`} aria-hidden="true" data-testid="drop-overlay">
      <div className="drop-overlay-ants" />
      <div className="drop-overlay-center">
        <div className="drop-overlay-catcher" ref={catcher}><PixelButton size={80} /></div>
        <div className="drop-overlay-title">
          <span>{ui.dropTitle}</span>
          <svg className="drop-overlay-snag" width={SNAG_WIDTH * 1.5} height={SNAGTHIS_LOGO.capHeight * 1.5} viewBox={`0 ${SNAGTHIS_LOGO.capTop} ${SNAG_WIDTH} ${SNAGTHIS_LOGO.capHeight}`} shapeRendering="crispEdges">
            {SNAG.map((letter, index) => <path key={index} d={letter.d} />)}
          </svg>
        </div>
        <p>{ui.dropHint}</p>
      </div>
    </div>
    <div className="sr-only" role="status" aria-live="polite">{announcement}</div>
  </>;
}
