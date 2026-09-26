import { useCallback, useEffect, useRef, useState } from 'react';
import { Ban, Clock, Puzzle, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { PixelButton, pressPixelButton } from '@/components/brand/PixelButton';
import { PixelText, PixelWord } from '@/components/brand/PixelText';
import type { PairingRequest } from '@/types/desktop-bridge';
import { ui } from '@/lib/strings';
import './PairingApproval.css';

/** Allow stays disabled this long after the dialog appears, so a click meant for another window can't approve. */
export const ALLOW_DELAY_MS = 700;
const REVIEW_EVENT = 'snagthis:review-pairing';
const PIPS = 12;
const PIP_MS = 10_000;

/** Opens the Approve dialog for the pending request (Settings → Chrome extension → Review). */
export function reviewPairing(request: PairingRequest) {
  window.dispatchEvent(new CustomEvent(REVIEW_EVENT, { detail: request }));
}

export const shortExtensionId = (id: string) => (id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-6)}` : id);
export const countdown = (ms: number) => { const seconds = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; };

/**
 * The match code as one object built like the logo's pixel bevel button (pairing-polish option 4 ·
 * Cartridge); the same housing the Chrome popup shows. The accessible name spells the digits out.
 */
export function PairingDigits({ code, tone = 'hot', size = 'lg' }: { code: string; tone?: 'hot' | 'off'; size?: 'lg' | 'sm' }) {
  return <div className={`pairing-digits ${tone} ${size}`} role="img" aria-label={`${ui.pairingMatchLabel} ${[...code].join(' ')}`} data-code={code}>
    {[...code].map((digit, index) => <span key={index} className="pairing-digit" style={{ '--i': index } as React.CSSProperties} aria-hidden="true"><PixelText text={digit} scale={size === 'sm' ? 3 : 6} /></span>)}
  </div>;
}

/** Twelve pixel pips, one per 10 s; the current one blinks. Decorative: the clock and announcements carry the time. */
export function PairingPips({ remaining, tone }: { remaining?: number; tone?: 'good' }) {
  const gone = remaining === undefined ? -1 : Math.min(PIPS, Math.max(0, PIPS - Math.ceil(Math.max(0, remaining) / PIP_MS)));
  return <div className={`pairing-pips ${tone || ''}`} aria-hidden="true">
    {Array.from({ length: PIPS }, (_, index) => <i key={index} className={index < gone ? 'gone' : index === gone ? 'now' : undefined} />)}
  </div>;
}

/** One line that never wraps: who is asking, a shortened ID (full ID on hover, for screen readers and when copied), a neutral build tag. */
function Identity({ request }: { request: PairingRequest }) {
  const store = request.identity === 'store';
  const id = request.extensionId;
  return <div className="pairing-who">
    {store ? <PixelButton size={16} /> : <Puzzle className="pairing-who-icon" aria-hidden="true" />}
    <span className="pairing-who-name">{store ? ui.pairingStoreName : ui.pairingUnknownName}</span>
    <span className="pairing-who-id" title={id}
      onCopy={(event) => { event.preventDefault(); event.clipboardData.setData('text/plain', id); }}>
      <span aria-hidden="true">{store ? request.extensionVersion : shortExtensionId(id)}</span><span className="sr-only">{id}</span>
    </span>
    <span className={`pairing-chip ${store ? 'good' : ''}`} title={store || request.identity === 'connected-before' ? undefined : ui.pairingNotStoreHint}>
      {store ? ui.pairingStoreBuild : request.identity === 'connected-before' ? ui.pairingConnectedBefore : ui.pairingNotStore}
    </span>
  </div>;
}

const burstStyle = (angle: number, index: number) => ({ '--a': `${angle}deg`, '--d': `${index > 7 ? 40 : 58}px`, '--c': ['var(--accent-bevel-face, #fa5d0e)', 'var(--accent-bevel-light, #ffb238)', '#80bfa6', '#fff4e6'][index % 4] }) as React.CSSProperties;

/**
 * Connect Chrome?: the trusted desktop half of one-click pairing. Shown for
 * snagthis://open/pair while a request is pending, or from Settings → Review.
 */
export function PairingApproval() {
  const [request, setRequest] = useState<PairingRequest | null>(null);
  const [outcome, setOutcome] = useState<'approved' | 'conflict' | null>(null);
  const [allowReady, setAllowReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now);
  const shownId = useRef('');
  const content = useRef<HTMLDivElement>(null);
  const celebrate = useRef<HTMLDivElement>(null);
  const done = useRef<HTMLButtonElement>(null);
  const open = Boolean(request);

  const show = useCallback((next: PairingRequest) => {
    if (next.status !== 'pending') return;
    shownId.current = next.requestId;
    setOutcome(null); setBusy(false); setNow(Date.now()); setRequest(next);
  }, []);
  const close = useCallback(() => { shownId.current = ''; setRequest(null); setOutcome(null); }, []);

  useEffect(() => {
    if (!window.desktop?.onPairingShow) return undefined;
    const offShow = window.desktop.onPairingShow(show);
    const offState = window.desktop.onPairingState((state) => {
      if (!shownId.current) return;
      if (!state || state.requestId !== shownId.current) {
        if (state?.status === 'conflict') { setOutcome('conflict'); return; }
        if (!state) close();
        return;
      }
      if (state.status === 'pending') { setRequest(state); return; }
      if (state.status === 'conflict') { setOutcome('conflict'); return; }
      if (state.status === 'approved' || state.status === 'collected') { setOutcome('approved'); return; }
      close();
      if (state.status === 'expired') toast(ui.pairingExpiredToast, { icon: <Clock aria-hidden="true" /> });
      if (state.status === 'cancelled') toast(ui.pairingCancelledToast);
    });
    const onReview = (event: Event) => show((event as CustomEvent<PairingRequest>).detail);
    window.addEventListener(REVIEW_EVENT, onReview);
    return () => { offShow(); offState(); window.removeEventListener(REVIEW_EVENT, onReview); };
  }, [show, close]);

  // While the dialog is open, Settings hides its "Chrome is asking to connect · Review" row so the code shows once.
  useEffect(() => {
    if (!open) return undefined;
    document.documentElement.dataset.pairingDialog = 'open';
    return () => { delete document.documentElement.dataset.pairingDialog; };
  }, [open]);

  // Allow is enabled only after a moment, each time a request is shown; meanwhile it visibly fills.
  const requestId = request?.requestId;
  useEffect(() => {
    if (!requestId) return undefined;
    setAllowReady(false);
    const timer = window.setTimeout(() => setAllowReady(true), ALLOW_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [requestId]);
  useEffect(() => {
    if (!requestId || outcome) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [requestId, outcome]);
  const remaining = request ? request.expiresAt - now : 0;
  const seconds = Math.max(0, Math.ceil(remaining / 1000));
  // Screen readers hear the time only at 1:00 and 0:15; the ticking clock is hidden from them.
  const announcement = seconds <= 15 ? ui.pairingFifteenSeconds : seconds <= 60 ? ui.pairingOneMinute : '';
  useEffect(() => { if (request && !outcome && remaining <= 0) { close(); toast(ui.pairingExpiredToast, { icon: <Clock aria-hidden="true" /> }); } }, [request, outcome, remaining, close]);
  useEffect(() => {
    if (outcome !== 'approved') return;
    // Success moves focus to Done (the ring shows only for keyboard users), then the button presses and bursts.
    done.current?.focus({ focusVisible: false } as FocusOptions);
    requestAnimationFrame(() => pressPixelButton(celebrate.current?.querySelector('.pixel-button')));
  }, [outcome]);

  const decide = async (allow: boolean) => {
    if (!request || busy || (allow && !allowReady)) return;
    setBusy(true);
    try {
      const result = await window.desktop.decidePairing(request.requestId, allow);
      if (!result.ok) { close(); toast(result.status === 'conflict' ? ui.pairingConflictTitle : ui.pairingExpiredToast); return; }
      if (allow) setOutcome('approved');
      else { close(); toast(ui.pairingDeniedToast, { icon: <Ban aria-hidden="true" /> }); }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : ui.pairingExpiredToast);
    } finally { setBusy(false); }
  };

  return <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}>
    <DialogContent ref={content} className={`pairing-dialog${outcome === 'approved' ? ' approved' : ''}`} showCloseButton={false}
      // Neither button takes focus on open: Allow must be a deliberate choice.
      onOpenAutoFocus={(event) => { event.preventDefault(); content.current?.focus({ preventScroll: true }); }}>
      {outcome === 'conflict' ? <>
        <TriangleAlert className="pairing-alert" aria-hidden="true" />
        <DialogTitle>{ui.pairingConflictTitle}</DialogTitle>
        <DialogDescription>{ui.pairingConflictBody}</DialogDescription>
        <div className="pairing-buttons"><button type="button" className="row-action primary-action" onClick={close}>{ui.ok}</button></div>
      </> : outcome === 'approved' ? <>
        <div className="pairing-yay" ref={celebrate}>
          <div className="pairing-burst" aria-hidden="true">{[0, 45, 90, 135, 180, 225, 270, 315, 20, 200].map((angle, index) => <i key={angle} style={burstStyle(angle, index)} />)}</div>
          <PixelButton size={64} />
        </div>
        <DialogTitle className="pairing-yay-title"><span className="sr-only">{ui.pairingConnectedTitle}</span><PixelWord text="Connected" scale={3} /></DialogTitle>
        <DialogDescription>{ui.pairingConnectedBody}</DialogDescription>
        <PairingPips tone="good" />
        <button ref={done} type="button" className="row-action primary-action pairing-done" onClick={close}>{ui.done}</button>
      </> : request && <>
        <PixelButton size={36} className="pairing-mark" />
        <DialogTitle>{ui.pairingDialogTitle}</DialogTitle>
        <DialogDescription>{ui.pairingDialogBody}</DialogDescription>
        <PairingDigits code={request.matchCode} />
        <PairingPips remaining={remaining} />
        <Identity request={request} />
        <div className="pairing-buttons">
          <button type="button" className="row-action labelled" disabled={busy} onClick={() => decide(false)}>{ui.deny}</button>
          <button type="button" className={`row-action primary-action pairing-allow${allowReady ? '' : ' arming'}`} disabled={busy || !allowReady} aria-describedby="pairing-allow-hint" onClick={() => decide(true)}><span>{ui.allow}</span></button>
        </div>
        <div className="pairing-foot"><span id="pairing-allow-hint">{ui.pairingMismatchHint}</span><span className="pairing-tick" aria-hidden="true">{countdown(remaining)}</span></div>
        <div className="sr-only" role="status">{announcement}</div>
      </>}
    </DialogContent>
  </Dialog>;
}
