import { useCallback, useEffect, useRef, useState } from 'react';
import { Puzzle, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { PixelButton, pressPixelButton } from '@/components/brand/PixelButton';
import { PixelText } from '@/components/brand/PixelText';
import type { PairingRequest } from '@/types/desktop-bridge';
import { ui } from '@/lib/strings';
import './PairingApproval.css';

/** Allow stays disabled this long after the dialog appears, so a click meant for another window can't approve. */
export const ALLOW_DELAY_MS = 700;
const REVIEW_EVENT = 'snagthis:review-pairing';

/** Opens the Approve dialog for the pending request (Settings → Chrome extension → Review). */
export function reviewPairing(request: PairingRequest) {
  window.dispatchEvent(new CustomEvent(REVIEW_EVENT, { detail: request }));
}

export const shortExtensionId = (id: string) => (id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-6)}` : id);
export const countdown = (ms: number) => { const seconds = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; };

/** Four big pixel digits in bevelled cells; the accessible name spells the digits out. */
export function PairingDigits({ code, tone = 'hot', size = 'lg' }: { code: string; tone?: 'hot' | 'plain' | 'bad'; size?: 'lg' | 'sm' }) {
  return <div className={`pairing-digits ${tone} ${size}`} role="img" aria-label={`${ui.pairingMatchLabel} ${[...code].join(' ')}`} data-code={code}>
    {[...code].map((digit, index) => <span key={index} className="pairing-digit" aria-hidden="true"><PixelText text={digit} scale={size === 'sm' ? 4 : 6} /></span>)}
  </div>;
}

function Identity({ request }: { request: PairingRequest }) {
  const store = request.identity === 'store';
  return <div className={`pairing-who ${store ? 'known' : 'unknown'}`}>
    {store ? <PixelButton size={26} /> : <Puzzle className="pairing-who-icon" aria-hidden="true" />}
    <div className="pairing-who-text">
      <b>{store ? `${ui.pairingStoreName}${request.extensionVersion ? ` ${request.extensionVersion}` : ''}` : ui.pairingUnknownName}</b>
      <small title={request.extensionId}>{request.extensionId}</small>
    </div>
    <span className={store ? 'ok' : 'warn'}>{store ? ui.pairingStoreBuild : request.identity === 'connected-before' ? ui.pairingConnectedBefore : ui.pairingNotStore}</span>
  </div>;
}

/**
 * Chrome wants to connect: the trusted desktop half of one-click pairing. Shown for
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
      if (state.status === 'expired') toast(ui.pairingExpiredToast);
      if (state.status === 'cancelled') toast(ui.pairingCancelledToast);
    });
    const onReview = (event: Event) => show((event as CustomEvent<PairingRequest>).detail);
    window.addEventListener(REVIEW_EVENT, onReview);
    return () => { offShow(); offState(); window.removeEventListener(REVIEW_EVENT, onReview); };
  }, [show, close]);

  // Allow is enabled only after a moment, each time a request is shown.
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
  useEffect(() => { if (request && !outcome && remaining <= 0) { close(); toast(ui.pairingExpiredToast); } }, [request, outcome, remaining, close]);
  useEffect(() => {
    if (outcome !== 'approved') return;
    requestAnimationFrame(() => pressPixelButton(celebrate.current?.querySelector('.pixel-button')));
  }, [outcome]);

  const decide = async (allow: boolean) => {
    if (!request || busy || (allow && !allowReady)) return;
    setBusy(true);
    try {
      const result = await window.desktop.decidePairing(request.requestId, allow);
      if (!result.ok) { close(); toast(result.status === 'conflict' ? ui.pairingConflictTitle : ui.pairingExpiredToast); return; }
      if (allow) setOutcome('approved');
      else { close(); toast(ui.pairingDeniedToast); }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : ui.pairingExpiredToast);
    } finally { setBusy(false); }
  };

  return <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}>
    <DialogContent ref={content} className="pairing-dialog" showCloseButton={false}
      // Neither button takes focus on open: Allow must be a deliberate choice.
      onOpenAutoFocus={(event) => { event.preventDefault(); content.current?.focus({ preventScroll: true }); }}>
      {outcome === 'conflict' ? <>
        <TriangleAlert className="pairing-alert" aria-hidden="true" />
        <DialogTitle>{ui.pairingConflictTitle}</DialogTitle>
        <DialogDescription>{ui.pairingConflictBody}</DialogDescription>
        <div className="pairing-buttons"><button type="button" className="row-action primary-action" onClick={close}>{ui.ok}</button></div>
      </> : outcome === 'approved' ? <>
        <div className="pairing-yay" ref={celebrate}>
          <div className="pairing-burst" aria-hidden="true">{[0, 45, 90, 135, 180, 225, 270, 315, 20, 200].map((angle, index) => <i key={angle} style={{ '--a': `${angle}deg`, '--d': `${index > 7 ? 40 : 58}px`, '--c': ['var(--accent-bevel-face, #fa5d0e)', 'var(--accent-bevel-light, #ffb238)', '#80bfa6', '#fff4e6'][index % 4] } as React.CSSProperties} />)}</div>
          <PixelButton size={64} />
        </div>
        <DialogTitle className="pairing-yay-title">Chrome <em>connected</em></DialogTitle>
        <DialogDescription>{ui.pairingConnectedBody}</DialogDescription>
        <div className="pairing-buttons"><button type="button" className="row-action primary-action" onClick={close}>{ui.done}</button></div>
      </> : request && <>
        <PixelButton size={40} className="pairing-mark" />
        <DialogTitle>{ui.pairingDialogTitle}</DialogTitle>
        <DialogDescription>{ui.pairingDialogBody}</DialogDescription>
        <PairingDigits code={request.matchCode} />
        <Identity request={request} />
        <div className="pairing-buttons">
          <button type="button" className="row-action labelled" disabled={busy} onClick={() => decide(false)}>{ui.deny}</button>
          <button type="button" className="row-action primary-action" disabled={busy || !allowReady} aria-describedby="pairing-allow-hint" onClick={() => decide(true)}>{ui.allow}</button>
        </div>
        <p className="pairing-hint" id="pairing-allow-hint">{ui.pairingExpiresIn.replace('{time}', countdown(remaining))} · {ui.pairingMismatchHint}</p>
      </>}
    </DialogContent>
  </Dialog>;
}
