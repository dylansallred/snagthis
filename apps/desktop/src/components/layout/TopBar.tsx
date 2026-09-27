import { useEffect, useLayoutEffect, useRef, type PointerEvent, type ReactNode, type RefObject } from 'react';
import { Link2, LoaderCircle, Search, X } from 'lucide-react';
import { SnagThisLogo } from './BrandLockup';
import { ui } from '@/lib/strings';

export type ListFilter = 'all' | 'downloading' | 'saved';
export function TopBar({ brandRef, pasteRef, searchRef, value, onValue, onSubmit, filter, onFilter, showNavigation, searchOpen, onSearchOpen, search, onSearch, checking, error, firstLaunch, gallery, viewToggle, savedDot = false }: {
  brandRef: RefObject<SVGSVGElement | null>; viewToggle?: ReactNode; savedDot?: boolean;
  pasteRef: RefObject<HTMLTextAreaElement | null>; searchRef: RefObject<HTMLInputElement | null>; value: string; onValue: (value: string) => void;
  onSubmit: () => void; filter: ListFilter; onFilter: (filter: ListFilter) => void; showNavigation: boolean;
  searchOpen: boolean; onSearchOpen: (open: boolean) => void; search: string; onSearch: (search: string) => void;
  checking: boolean; error: string; firstLaunch: boolean; gallery: boolean;
}) {
  const tabs = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const nav = tabs.current;
    if (!nav) return;
    const place = () => {
      const selected = nav.querySelector<HTMLElement>('button.selected');
      if (!selected) return;
      nav.style.setProperty('--tab-x', `${selected.offsetLeft}px`);
      nav.style.setProperty('--tab-width', `${selected.offsetWidth}px`);
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [filter, searchOpen, showNavigation]);
  const lastShine = useRef(-Infinity);
  // One shine per pointer entry, at most once a second; CSS removes it under reduced motion.
  // The logo is part of the window's drag area, where macOS delivers no pointer events,
  // so its shine plays when the window comes into focus (at most once a minute).
  const brandBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const shine = () => {
      const brand = brandBox.current, now = performance.now();
      if (!brand || now - lastShine.current < 60_000) return;
      lastShine.current = now;
      brand.classList.remove('shining');
      void brand.offsetWidth;
      brand.classList.add('shining');
    };
    window.addEventListener('focus', shine);
    return () => window.removeEventListener('focus', shine);
  }, []);
  const followPointer = (event: PointerEvent<HTMLElement>) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('button');
    if (!button) return;
    event.currentTarget.style.setProperty('--tab-hover-x', `${button.offsetLeft}px`);
    event.currentTarget.style.setProperty('--tab-hover-width', `${button.offsetWidth}px`);
    event.currentTarget.classList.add('hovering');
  };
  // The header is the window's title bar: empty space drags (and double-click zooms/maximises);
  // controls are no-drag. Real window buttons are inset by platform classes (lib/windowChrome.ts);
  // the browser gallery draws placeholder lights instead.
  return <header className="top-bar drag-region">
    {gallery && <div className="window-lights" aria-hidden="true"><i /><i /><i /></div>}
    {/* The logo drags the window like the rest of the header. */}
    <div className="app-brand" ref={brandBox} onAnimationEnd={(event) => event.currentTarget.classList.remove('shining')}><SnagThisLogo ref={brandRef} className="app-wordmark" /></div>
    <form className={`paste-form no-drag${firstLaunch ? ' first-launch' : ''}`} onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
      <div className="paste-field">
        {checking ? <LoaderCircle className="spin" /> : <Link2 />}
        <textarea ref={pasteRef} aria-label={ui.paste} placeholder={checking ? ui.checking : ui.paste} value={value} rows={1} disabled={checking}
          onChange={(event) => onValue(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); onSubmit(); } }} />
        {!value && !checking && <kbd className="paste-hint" aria-hidden="true">{/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘V' : 'Ctrl V'}</kbd>}
      </div>
      {error && <div className="paste-error" role="alert">{error}</div>}
    </form>
    {/* An empty library has nothing to filter or search; the tabs arrive with the first video. */}
    {showNavigation && <div className="top-navigation no-drag">
      {searchOpen ? <div className="search-field"><Search /><input ref={searchRef} value={search} onChange={(event) => onSearch(event.target.value)} placeholder={ui.searchPlaceholder} aria-label={ui.searchPlaceholder} onKeyDown={(event) => { if (event.key === 'Escape') { onSearch(''); onSearchOpen(false); } }} /><button className="row-action" aria-label={ui.closeSearch} onClick={() => { onSearch(''); onSearchOpen(false); }}><X /></button></div> : <>
        <nav className="list-tabs" aria-label="Filter videos" ref={tabs} onPointerOver={followPointer} onPointerLeave={(event) => event.currentTarget.classList.remove('hovering')}><i className="tab-hover" aria-hidden="true" /><i className="tab-indicator" aria-hidden="true" />{(['all', 'downloading', 'saved'] as const).map((item) => <button key={item} data-tab={item} aria-current={filter === item ? 'page' : undefined} className={filter === item ? 'selected' : ''} onClick={() => onFilter(item)}>{ui[item]}{item === 'saved' && savedDot && <i className="snag-pip" aria-hidden="true" />}</button>)}</nav>
        {viewToggle}
        <button className="row-action" aria-label={ui.search} title="Search (⌘F)" onClick={() => onSearchOpen(true)}><Search /></button>
      </>}
    </div>}
  </header>;
}
