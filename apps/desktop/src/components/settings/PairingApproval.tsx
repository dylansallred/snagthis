import { useCallback, useEffect, useRef, useState } from 'react';
import { Ban, Check, Clock, ExternalLink, Puzzle, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { PixelButton, pressPixelButton } from '@/components/brand/PixelButton';
import { PixelText, PixelWord } from '@/components/brand/PixelText';
import type { PairingRequest } from '@/types/desktop-bridge';
import { ui } from '@/lib/strings';
import './PairingApproval.css';

/** Allow stays disabled this long after the digits appear, so a click meant for another window can't approve. */
export const ALLOW_DELAY_MS = 700;
/** "Connected" stays this long, then the card or dialog closes itself (no Done). */
export const CONNECTED_MS = 1400;
/** The desktop renews "Waiting for Chrome…" this often while its card is on screen (the bridge forgets it after 90 s). */
const LISTEN_RENEW_MS = 30_000;
const REVIEW_EVENT = 'snagthis:review-pairing';
const PIPS = 12;
const PIP_MS = 10_000;

/**
 * Connect cards on screen that answer requests in place. While one is showing, the Approve dialog
 * stays closed, so the digits appear once.
 */
let inlineHosts = 0;

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

/** The one toast for a request that ended without Allow. */
function announceEnded(status: string | undefined) {
  if (status === 'denied') toast(ui.pairingDeniedToast, { icon: <Ban aria-hidden="true" /> });
  else if (status === 'cancelled') toast(ui.pairingCancelledToast);
  else if (status === 'conflict') toast(ui.pairingConflictTitle, { description: ui.pairingConflictBody, icon: <TriangleAlert aria-hidden="true" /> });
  else toast(ui.pairingExpiredToast, { icon: <Clock aria-hidden="true" /> });
}

type Decision = { result: 'approved' } | { result: 'ended'; status?: string };

/**
 * The digits, countdown, who is asking, and Deny / Allow. Shared by the Approve dialog and the
 * in-place connect card. Neither button takes focus; Allow arms for 700 ms each time digits appear.
 */
function ApproveControls({ request, onDecided, demo = false }: { request: PairingRequest; onDecided: (decision: Decision) => void; demo?: boolean }) {
  const [allowReady, setAllowReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setAllowReady(false); setNow(Date.now());
    const arm = window.setTimeout(() => setAllowReady(true), ALLOW_DELAY_MS);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { window.clearTimeout(arm); window.clearInterval(tick); };
  }, [request.requestId]);
  const remaining = request.expiresAt - now;
  const seconds = Math.max(0, Math.ceil(remaining / 1000));
  // Screen readers hear the time only at 1:00 and 0:15; the ticking clock is hidden from them.
  const announcement = seconds <= 15 ? ui.pairingFifteenSeconds : seconds <= 60 ? ui.pairingOneMinute : '';
  const expired = remaining <= 0;
  const decided = useRef(onDecided);
  decided.current = onDecided;
  useEffect(() => { if (expired && !demo) decided.current({ result: 'ended', status: 'expired' }); }, [expired, demo]);

  const decide = async (allow: boolean) => {
    if (busy || (allow && !allowReady)) return;
    setBusy(true);
    try {
      const result = demo ? { ok: true, status: allow ? 'approved' : 'denied' } : await window.desktop.decidePairing(request.requestId, allow);
      if (!result.ok) { decided.current({ result: 'ended', status: result.status === 'conflict' ? 'conflict' : 'expired' }); return; }
      decided.current(allow ? { result: 'approved' } : { result: 'ended', status: 'denied' });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : ui.pairingExpiredToast);
    } finally { setBusy(false); }
  };

  return <>
    <PairingDigits code={request.matchCode} />
    <PairingPips remaining={remaining} />
    <Identity request={request} />
    <div className="pairing-buttons">
      <button type="button" className="row-action labelled" disabled={busy} onClick={() => decide(false)}>{ui.deny}</button>
      <button type="button" className={`row-action primary-action pairing-allow${allowReady ? '' : ' arming'}`} disabled={busy || !allowReady} aria-describedby={`pairing-allow-hint-${request.requestId}`} onClick={() => decide(true)}><span>{ui.allow}</span></button>
    </div>
    <div className="pairing-foot"><span id={`pairing-allow-hint-${request.requestId}`}>{ui.pairingMismatchHint}</span><span className="pairing-tick" aria-hidden="true">{countdown(remaining)}</span></div>
    <div className="sr-only" role="status">{announcement}</div>
  </>;
}

const burstStyle = (angle: number, index: number) => ({ '--a': `${angle}deg`, '--d': `${index > 7 ? 40 : 58}px`, '--c': ['var(--accent-bevel-face, #fa5d0e)', 'var(--accent-bevel-light, #ffb238)', '#80bfa6', '#fff4e6'][index % 4] }) as React.CSSProperties;

/**
 * Connect Chrome?: the trusted desktop half of pairing, for requests that arrive while no connect
 * card is on screen. SnagThis surfaces itself for a new request without taking focus, so Chrome's
 * popup stays open beside it. Allow shows "Connected" for a moment and the dialog closes itself.
 */
export function PairingApproval({ onOpenChange, demo }: { onOpenChange?: (open: boolean) => void; demo?: PairingRequest | null } = {}) {
  const [request, setRequest] = useState<PairingRequest | null>(demo || null);
  const [outcome, setOutcome] = useState<'approved' | 'conflict' | null>(null);
  const shownId = useRef(demo?.requestId || '');
  const content = useRef<HTMLDivElement>(null);
  const celebrate = useRef<HTMLDivElement>(null);
  const open = Boolean(request);

  const show = useCallback((next: PairingRequest) => {
    // A connect card on screen answers the request in place.
    if (next.status !== 'pending' || inlineHosts > 0) return;
    shownId.current = next.requestId;
    setOutcome(null); setRequest(next);
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
      if (state.status === 'expired' || state.status === 'cancelled') announceEnded(state.status);
    });
    const onReview = (event: Event) => show((event as CustomEvent<PairingRequest>).detail);
    window.addEventListener(REVIEW_EVENT, onReview);
    return () => { offShow(); offState(); window.removeEventListener(REVIEW_EVENT, onReview); };
  }, [show, close]);

  // While the dialog is open, Settings hides its "Chrome is asking to connect · Review" row so the code shows once.
  // The app's shortcuts, paste and drops stay off while it is open (spec §6).
  useEffect(() => { onOpenChange?.(open); }, [open, onOpenChange]);
  useEffect(() => {
    if (!open) return undefined;
    document.documentElement.dataset.pairingDialog = 'open';
    return () => { delete document.documentElement.dataset.pairingDialog; };
  }, [open]);
  useEffect(() => {
    if (outcome !== 'approved') return undefined;
    // The button presses and bursts, then everything closes by itself.
    requestAnimationFrame(() => pressPixelButton(celebrate.current?.querySelector('.pixel-button')));
    if (demo) return undefined;
    const timer = window.setTimeout(close, CONNECTED_MS);
    return () => window.clearTimeout(timer);
  }, [outcome, close, demo]);

  const onDecided = useCallback((decision: Decision) => {
    if (decision.result === 'approved') { setOutcome('approved'); return; }
    close(); announceEnded(decision.status);
  }, [close]);

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
        <DialogTitle className="pairing-yay-title" role="status"><span className="sr-only">{ui.pairingConnectedTitle}</span><PixelWord text="Connected" scale={3} /></DialogTitle>
        <DialogDescription>{ui.pairingConnectedBody}</DialogDescription>
        <div className="pairing-closing" aria-hidden="true"><i /></div>
      </> : request && <>
        <PixelButton size={36} className="pairing-mark" />
        <DialogTitle>{ui.pairingDialogTitle}</DialogTitle>
        <DialogDescription>{ui.pairingDialogBody}</DialogDescription>
        <ApproveControls request={request} onDecided={onDecided} demo={Boolean(demo)} />
      </>}
    </DialogContent>
  </Dialog>;
}

const galleryRequest = (): PairingRequest => ({ requestId: 'gallery', status: 'pending', matchCode: '4719', expiresAt: Date.now() + 112_000, extensionId: 'gedjaiphmbpcgkpjlnnhdbcbecnombmb', extensionVersion: '1.0.1', identity: 'unrecognized' });
export const galleryPairingRequest = galleryRequest;

/**
 * Pair from the desktop (owner pick 2026-09-29, docs/design/prototypes/pairing-simple option B).
 * While this card is on screen the desktop is "Waiting for Chrome…": opening the SnagThis popup in
 * an unpaired Chrome starts the request by itself, and the card turns into the digits with Deny and
 * Allow in place. Allow shows "Connected" briefly and the card folds away.
 */
export function ChromeConnectCard({ variant, active = true, gallery = false, demo, onInstall, onConnected, onUseCode }: {
  variant: 'first' | 'settings' | 'another';
  /** False while something covers the card (a sheet or dialog); it then neither listens nor answers. */
  active?: boolean;
  gallery?: boolean;
  /** Gallery previews: 'waiting' (default), 'request' or 'connected'. */
  demo?: string | null;
  onInstall?: () => void;
  onConnected?: () => void;
  onUseCode?: () => void;
}) {
  const [request, setRequest] = useState<PairingRequest | null>(() => (gallery && demo === 'request' ? galleryRequest() : null));
  const [phase, setPhase] = useState<'waiting' | 'connected' | 'closed'>(gallery && demo === 'connected' ? 'connected' : 'waiting');
  const current = useRef<PairingRequest | null>(null);
  current.current = request;
  const connectedRef = useRef(onConnected);
  connectedRef.current = onConnected;
  const live = active && !gallery && phase !== 'closed' && Boolean(window.desktop?.onPairingState);

  // Listening: renewed while the card is on screen and the window is visible; dropped when it goes.
  useEffect(() => {
    if (!live || phase !== 'waiting' || !window.desktop.setPairingListening) return undefined;
    const listen = window.desktop.setPairingListening;
    const renew = () => { void listen(document.visibilityState === 'visible').catch(() => {}); };
    renew();
    const timer = window.setInterval(renew, LISTEN_RENEW_MS);
    document.addEventListener('visibilitychange', renew);
    window.addEventListener('focus', renew);
    return () => {
      window.clearInterval(timer); document.removeEventListener('visibilitychange', renew); window.removeEventListener('focus', renew);
      void listen(false).catch(() => {});
    };
  }, [live, phase]);

  useEffect(() => {
    if (!live) return undefined;
    inlineHosts += 1;
    let open = true;
    void window.desktop.getPairingRequest().then((next) => { if (open && next?.status === 'pending') setRequest(next); }).catch(() => {});
    const off = window.desktop.onPairingState((next) => {
      if (next?.status === 'pending') { setRequest(next); return; }
      const shown = current.current;
      if (!shown || (next && next.requestId !== shown.requestId && next.status !== 'conflict')) return;
      setRequest(null);
      if (next?.status === 'approved' || next?.status === 'collected') setPhase('connected');
      else if (next && next.status !== 'denied') announceEnded(next.status);
    });
    return () => {
      open = false; off(); inlineHosts -= 1;
      // Covered or closed while Chrome still waits: hand the request to the Approve dialog.
      const waiting = current.current;
      if (waiting && waiting.expiresAt > Date.now()) window.setTimeout(() => { if (inlineHosts === 0) reviewPairing(waiting); }, 0);
    };
  }, [live]);

  useEffect(() => {
    if (phase !== 'connected' || demo === 'connected') return undefined;
    const timer = window.setTimeout(() => { setPhase('closed'); connectedRef.current?.(); }, CONNECTED_MS);
    return () => window.clearTimeout(timer);
  }, [phase, demo]);

  const onDecided = useCallback((decision: Decision) => {
    setRequest(null); current.current = null;
    if (decision.result === 'approved') { setPhase('connected'); return; }
    announceEnded(decision.status);
  }, []);

  if (phase === 'closed') return null;
  const labelled = variant === 'another' ? ui.chromeConnectAnother : ui.connectChrome;
  return <section className={`chrome-connect-card ${variant}${request ? ' asking' : ''}${phase === 'connected' ? ' connected' : ''}`} aria-label={labelled}>
    {phase === 'connected' ? <div className="connect-done" role="status">
      <span className="connect-done-mark"><Check aria-hidden="true" /></span>
      <b>{ui.pairingConnectedCard}</b>
      <span>{ui.pairingConnectedBody}</span>
      <div className="pairing-closing" aria-hidden="true"><i /></div>
    </div> : request ? <>
      <h3>{ui.pairingCardTitle}</h3>
      <p>{ui.pairingDialogBody}</p>
      <ApproveControls request={request} onDecided={onDecided} demo={gallery} />
    </> : <>
      {variant === 'first' && <h3>{labelled}</h3>}
      <p className="connect-hint"><PixelButton size={14} />{ui.chromeCardHintBefore}<b>SnagThis</b>{ui.chromeCardHintAfter}</p>
      <p className="connect-listen" role="status"><span className="connect-blip" aria-hidden="true" />{variant === 'another' ? ui.chromeWaitingAnother : ui.chromeWaiting}</p>
      {(onInstall || onUseCode) && <div className="connect-links">
        {onInstall && <button type="button" className="text-link" aria-label={ui.addChrome} onClick={onInstall}>{ui.chromeCardInstall}<ExternalLink aria-hidden="true" /></button>}
        {onUseCode && <button type="button" className="text-link" onClick={onUseCode}>{ui.chromeUseCode}</button>}
      </div>}
    </>}
  </section>;
}
