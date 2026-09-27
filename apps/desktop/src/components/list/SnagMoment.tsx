import { useEffect, useRef } from 'react';
import type { RowModel } from '@m3u8/contracts/src/rows.mjs';
import { PixelButton } from '@/components/brand/PixelButton';
import { pixelTextPath } from '@/components/brand/PixelText';
import './SnagMoment.css';

const LIVE = new Set(['downloading', 'finishing']);
// Completions this close together share one coin, so a batch never becomes a shower.
const COALESCE_MS = 2000;
// The row's own completion (check draws, lane fades, FLIP into Saved) settles first.
const SETTLE_CAP_MS = 320;
const COLORS = ['var(--accent-bevel-face, #fa5d0e)', 'var(--accent-bevel-light, #ffb238)', '#80bfa6', '#fff4e6', 'var(--accent-bevel-dark, #bd3f00)'];

type Point = { x: number; y: number };
type Moment = { started: number; count: number; plus: HTMLElement | null };
const center = (rect: DOMRect): Point => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const SVG = 'http://www.w3.org/2000/svg';

/** Draws "+N" into the floating label, on the same pixel grid as the mascot's z's. */
function drawPlus(label: HTMLElement, count: number) {
  const { d, width } = pixelTextPath(`+${count}`);
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('width', String(width * 3));
  svg.setAttribute('height', '15');
  svg.setAttribute('viewBox', `0 0 ${width} 5`);
  svg.setAttribute('shape-rendering', 'crispEdges');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('fill', 'currentColor');
  path.setAttribute('d', d);
  svg.appendChild(path);
  label.replaceChildren(svg);
}

/** Where the finished row's action sits, if the row is on screen inside the list. */
function originOf(id: string): Point | null {
  const row = document.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(id)}"]`);
  const list = document.querySelector('.workbench-content')?.getBoundingClientRect();
  if (!row || !list) return null;
  const rect = (row.querySelector('.play-action') || row.querySelector('.row-actions') || row).getBoundingClientRect();
  const point = center(rect);
  return rect.width && point.y > list.top && point.y < list.bottom ? point : null;
}

/**
 * Unique look 2 · The snag moment. When a download finishes while the window is visible, square pixels
 * burst from the row's action, a mini play button arcs into the Saved tab, the tab bumps and shows "+1".
 * It extends the row's own completion motion (VideoRow's just-saved) and never fires for rows that were
 * already saved on load or refresh. Hidden windows and reduced motion only get the Saved-tab dot.
 */
export function SnagMoment({ rows, onQuietCompletion }: { rows: RowModel[]; onQuietCompletion: () => void }) {
  const previous = useRef<Map<string, string> | null>(null);
  const layer = useRef<HTMLDivElement>(null);
  const batch = useRef<Moment | null>(null);
  const quiet = useRef(onQuietCompletion);
  useEffect(() => { quiet.current = onQuietCompletion; });

  useEffect(() => {
    const before = previous.current;
    previous.current = new Map(rows.map((row) => [row.id, row.state]));
    // The first list is history, not news. Rows missing from the last list (search, paging) are not completions either.
    if (!before) return;
    const finished = rows.filter((row) => row.state === 'saved' && LIVE.has(before.get(row.id) || ''));
    if (!finished.length) return;
    if (document.visibilityState !== 'visible' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { quiet.current(); return; }
    const now = performance.now();
    const current = batch.current;
    if (current && now - current.started < COALESCE_MS) {
      current.count += finished.length;
      if (current.plus) drawPlus(current.plus, current.count);
      return;
    }
    const moment: Moment = { started: now, count: finished.length, plus: null };
    batch.current = moment;
    if (layer.current) void play(layer.current, finished[0].id, moment);
  }, [rows]);

  // The coin is a copy of this hidden button, so it shares the brand geometry and accent colours.
  return <div ref={layer} className="snag-layer" aria-hidden="true"><div className="snag-template" hidden><PixelButton size={16} /></div></div>;
}

async function play(fx: HTMLElement, id: string, moment: Moment) {
  // Measure at once (a row leaving the Downloading tab is still collapsing), then again once it lands.
  await new Promise(requestAnimationFrame);
  let from = originOf(id);
  const item = document.querySelector<HTMLElement>(`[data-item-key="${CSS.escape(id)}"]`);
  const settling = item?.getAnimations().map((animation) => animation.finished.catch(() => {})) || [];
  if (settling.length) await Promise.race([Promise.all(settling), wait(SETTLE_CAP_MS)]);
  from = originOf(id) || from;
  const tab = document.querySelector<HTMLElement>('.list-tabs [data-tab="saved"]');
  if (from) burst(fx, from);
  if (!tab) return;
  const to = center(tab.getBoundingClientRect());
  if (from) {
    await wait(150);
    const coin = document.createElement('div');
    coin.className = 'snag-coin';
    coin.style.left = `${from.x - 8}px`;
    coin.style.top = `${from.y - 8}px`;
    const art = fx.querySelector('.snag-template .pixel-button');
    if (art) coin.appendChild(art.cloneNode(true));
    fx.appendChild(coin);
    // The arc peaks 70px above the higher end, but never leaves the window.
    const mid = { x: (to.x - from.x) * .55, y: Math.max(12, Math.min(to.y, from.y) - 70) - from.y };
    await coin.animate([
      { transform: 'translate(0, 0) scale(1)' },
      { transform: `translate(${mid.x}px, ${mid.y}px) scale(1.25)`, offset: .5 },
      { transform: `translate(${to.x - from.x}px, ${to.y - from.y}px) scale(.6)`, opacity: .9 },
    ], { duration: 560, easing: 'cubic-bezier(.5, 0, .4, 1)', fill: 'forwards' }).finished.catch(() => {});
    coin.remove();
  }
  tab.classList.remove('snag-bump');
  void tab.offsetWidth;
  tab.classList.add('snag-bump');
  tab.addEventListener('animationend', () => tab.classList.remove('snag-bump'), { once: true });
  const plus = document.createElement('div');
  plus.className = 'snag-plus';
  plus.style.left = `${to.x + 14}px`;
  plus.style.top = `${to.y - 18}px`;
  fx.appendChild(plus);
  moment.plus = plus;
  drawPlus(plus, moment.count);
  await plus.animate([{ transform: 'translateY(0)', opacity: 1 }, { transform: 'translateY(-12px)', opacity: 0 }], { duration: 700, easing: 'steps(6, end)', fill: 'forwards' }).finished.catch(() => {});
  moment.plus = null;
  plus.remove();
}

function burst(fx: HTMLElement, from: Point) {
  for (let index = 0; index < 14; index++) {
    const pixel = document.createElement('i');
    pixel.className = 'snag-pixel';
    pixel.style.background = COLORS[index % COLORS.length];
    pixel.style.left = `${from.x - 2}px`;
    pixel.style.top = `${from.y - 2}px`;
    fx.appendChild(pixel);
    const angle = index / 14 * Math.PI * 2 + Math.random() * .4;
    const distance = 26 + Math.random() * 30;
    const dx = Math.cos(angle) * distance;
    const dy = Math.sin(angle) * distance * .8;
    // Out, then falling under gravity, in eight hard steps.
    pixel.animate([
      { transform: 'translate(0, 0)', opacity: 1 },
      { transform: `translate(${dx * .7}px, ${dy * .7 - 10}px)`, opacity: 1, offset: .45 },
      { transform: `translate(${dx}px, ${dy + 18}px)`, opacity: 0 },
    ], { duration: 600, easing: 'steps(8, end)', fill: 'forwards' }).finished.catch(() => {}).then(() => pixel.remove());
  }
}
