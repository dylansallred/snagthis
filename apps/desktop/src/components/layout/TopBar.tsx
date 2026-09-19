import type { RefObject } from 'react';
import { Link2, LoaderCircle, Search, X } from 'lucide-react';
import logo from '@/assets/vidsnag-logo-mark.png';
import { ui } from '@/lib/strings';

export type ListFilter = 'all' | 'downloading' | 'saved';
export function TopBar({ pasteRef, searchRef, value, onValue, onSubmit, filter, onFilter, searchOpen, onSearchOpen, search, onSearch, checking, error, firstLaunch, nativeMac, gallery }: {
  pasteRef: RefObject<HTMLTextAreaElement | null>; searchRef: RefObject<HTMLInputElement | null>; value: string; onValue: (value: string) => void;
  onSubmit: () => void; filter: ListFilter; onFilter: (filter: ListFilter) => void;
  searchOpen: boolean; onSearchOpen: (open: boolean) => void; search: string; onSearch: (search: string) => void;
  checking: boolean; error: string; firstLaunch: boolean; nativeMac: boolean; gallery: boolean;
}) {
  return <header className={`top-bar drag-region${nativeMac ? ' native-mac' : ''}`}>
    {gallery && <div className="window-lights" aria-hidden="true"><i /><i /><i /></div>}
    <img className="app-mark no-drag" src={logo} alt="VidSnag" />
    <form className={`paste-form no-drag${firstLaunch ? ' first-launch' : ''}`} onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
      <div className="paste-field">
        {checking ? <LoaderCircle className="spin" /> : <Link2 />}
        <textarea ref={pasteRef} aria-label={ui.paste} placeholder={checking ? ui.checking : ui.paste} value={value} rows={1} disabled={checking}
          onChange={(event) => onValue(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); onSubmit(); } }} />
      </div>
      {error && <div className="paste-error" role="alert">{error}</div>}
    </form>
    <div className="top-navigation no-drag">
      {searchOpen ? <div className="search-field"><Search /><input ref={searchRef} value={search} onChange={(event) => onSearch(event.target.value)} placeholder={ui.searchPlaceholder} aria-label={ui.searchPlaceholder} onKeyDown={(event) => { if (event.key === 'Escape') { onSearch(''); onSearchOpen(false); } }} /><button className="row-action" aria-label={ui.closeSearch} onClick={() => { onSearch(''); onSearchOpen(false); }}><X /></button></div> : <>
        <nav className="list-tabs" aria-label="Filter videos">{(['all', 'downloading', 'saved'] as const).map((item) => <button key={item} aria-current={filter === item ? 'page' : undefined} className={filter === item ? 'selected' : ''} onClick={() => onFilter(item)}>{ui[item]}</button>)}</nav>
        <button className="row-action" aria-label={ui.search} title="Search (⌘F)" onClick={() => onSearchOpen(true)}><Search /></button>
      </>}
    </div>
  </header>;
}
