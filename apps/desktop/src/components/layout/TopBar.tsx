import { useLayoutEffect, useRef, type PointerEvent, type RefObject } from 'react';
import { Link2, LoaderCircle, Search, X } from 'lucide-react';
import logo from '@/assets/vidsnag-logo-title.png';
import { ui } from '@/lib/strings';

export type ListFilter = 'all' | 'downloading' | 'saved';
export function TopBar({ brandRef, pasteRef, searchRef, value, onValue, onSubmit, filter, onFilter, searchOpen, onSearchOpen, search, onSearch, checking, error, firstLaunch, gallery }: {
  brandRef: RefObject<HTMLImageElement | null>;
  pasteRef: RefObject<HTMLTextAreaElement | null>; searchRef: RefObject<HTMLInputElement | null>; value: string; onValue: (value: string) => void;
  onSubmit: () => void; filter: ListFilter; onFilter: (filter: ListFilter) => void;
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
  }, [filter, searchOpen]);
  const followPointer = (event: PointerEvent<HTMLElement>) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('button');
    if (!button) return;
    event.currentTarget.style.setProperty('--tab-hover-x', `${button.offsetLeft}px`);
    event.currentTarget.style.setProperty('--tab-hover-width', `${button.offsetWidth}px`);
    event.currentTarget.classList.add('hovering');
  };
  return <header className="top-bar drag-region">
    {gallery && <div className="window-lights" aria-hidden="true"><i /><i /><i /></div>}
    <div className="app-brand"><img ref={brandRef} className="app-wordmark" src={logo} alt="VidSnag" /></div>
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
    <div className="top-navigation no-drag">
      {searchOpen ? <div className="search-field"><Search /><input ref={searchRef} value={search} onChange={(event) => onSearch(event.target.value)} placeholder={ui.searchPlaceholder} aria-label={ui.searchPlaceholder} onKeyDown={(event) => { if (event.key === 'Escape') { onSearch(''); onSearchOpen(false); } }} /><button className="row-action" aria-label={ui.closeSearch} onClick={() => { onSearch(''); onSearchOpen(false); }}><X /></button></div> : <>
        <nav className="list-tabs" aria-label="Filter videos" ref={tabs} onPointerOver={followPointer} onPointerLeave={(event) => event.currentTarget.classList.remove('hovering')}><i className="tab-hover" aria-hidden="true" /><i className="tab-indicator" aria-hidden="true" />{(['all', 'downloading', 'saved'] as const).map((item) => <button key={item} aria-current={filter === item ? 'page' : undefined} className={filter === item ? 'selected' : ''} onClick={() => onFilter(item)}>{ui[item]}</button>)}</nav>
        <button className="row-action" aria-label={ui.search} title="Search (⌘F)" onClick={() => onSearchOpen(true)}><Search /></button>
      </>}
    </div>
  </header>;
}
