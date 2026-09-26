import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { ArrowRight, Check, CirclePlay, ClipboardPaste, Download, FolderOpen, LayoutGrid, Link2, List, Pause, Search, Settings } from 'lucide-react';
import type { RowModel } from '@m3u8/contracts/src/rows.mjs';
import { ACCENTS, useAccent } from '@/lib/accent';
import { resolveThumbnailUrl } from '@/lib/utils';
import { ui } from '@/lib/strings';
import { settingsSections, type SettingsSectionId } from '@/components/settings/settingsSections';
import type { ListFilter } from '@/components/layout/TopBar';
import type { SavedView } from '@/components/library/SavedShelf';
import './CommandPalette.css';

/** What the palette can ask the app to do. Every command reuses an existing app handler. */
export interface PaletteActions {
  pasteLink: () => void;
  clipboardLink: () => void;
  snagLink: (url: string) => void;
  pauseAll: () => void;
  resumeAll: () => void;
  openFolder: () => void;
  focusSearch: () => void;
  filter: ListFilter;
  setFilter: (filter: ListFilter) => void;
  savedView: SavedView;
  setSavedView: (view: SavedView) => void;
  openSettings: (section?: SettingsSectionId) => void;
  jumpTo: (row: RowModel) => void;
}

interface Item {
  id: string;
  group: string;
  label: string;
  icon: ReactNode;
  hint?: string;
  keywords?: string;
  current?: boolean;
  poster?: string | null;
  /** Commands that place focus somewhere else keep it there instead of returning it. */
  movesFocus?: boolean;
  run: () => void;
}

const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const paletteShortcut = mac ? '⌘K' : 'Ctrl K';
const looksLikeLink = (value: string) => /^https?:\/\/\S+$/i.test(value) || /^[\w-]+(\.[\w-]+)+\/\S*$/.test(value);

/**
 * Fuzzy match: every word of the query must appear in order within the text. Whole substrings
 * score highest, then matches at word starts and consecutive letters. Null means no match.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const haystack = text.toLowerCase();
  let total = 0;
  for (const word of query.toLowerCase().split(/\s+/).filter(Boolean)) {
    const at = haystack.indexOf(word);
    if (at >= 0) { total += 100 + word.length * 4 - Math.min(at, 40) + (at === 0 || /[\s\-—:·/]/.test(haystack[at - 1]) ? 40 : 0); continue; }
    let from = 0; let previous = -2; let score = 0;
    for (const letter of word) {
      const found = haystack.indexOf(letter, from);
      if (found < 0) return null;
      score += (found === previous + 1 ? 6 : 1) + (found === 0 || /[\s\-—:·/]/.test(haystack[found - 1]) ? 5 : 0);
      previous = found; from = found + 1;
    }
    total += score;
  }
  return total - haystack.length * .05;
}

function useItems(query: string, actions: PaletteActions, videos: RowModel[], apiBase: string): Item[] {
  const [accent, setAccent] = useAccent();
  return useMemo(() => {
    const trimmed = query.trim();
    if (looksLikeLink(trimmed)) {
      return [{ id: 'snag', group: ui.paletteGroupLink, label: ui.paletteSnagLink, icon: <Download />, hint: '↵', run: () => actions.snagLink(/^https?:/i.test(trimmed) ? trimmed : `https://${trimmed}`) }];
    }
    const commands: Item[] = [
      { id: 'paste', group: ui.paletteGroupActions, label: ui.palettePasteLink, icon: <Link2 />, hint: mac ? '⌘V' : 'Ctrl V', keywords: 'add new url', movesFocus: true, run: actions.pasteLink },
      { id: 'clipboard', group: ui.paletteGroupActions, label: ui.paletteClipboard, icon: <ClipboardPaste />, keywords: 'paste snag url', movesFocus: true, run: actions.clipboardLink },
      { id: 'pause-all', group: ui.paletteGroupActions, label: ui.palettePauseAll, icon: <Pause />, keywords: 'stop', run: actions.pauseAll },
      { id: 'resume-all', group: ui.paletteGroupActions, label: ui.paletteResumeAll, icon: <CirclePlay />, keywords: 'start continue', run: actions.resumeAll },
      { id: 'folder', group: ui.paletteGroupActions, label: ui.saveFolder, icon: <FolderOpen />, keywords: 'downloads finder explorer', run: actions.openFolder },
      { id: 'search', group: ui.paletteGroupActions, label: ui.paletteSearch, icon: <Search />, hint: mac ? '⌘F' : 'Ctrl F', keywords: 'find filter', movesFocus: true, run: actions.focusSearch },
      actions.savedView === 'shelf'
        ? { id: 'view', group: ui.paletteGroupActions, label: ui.paletteList, icon: <List />, keywords: 'layout grid rows', run: () => { actions.setFilter('saved'); actions.setSavedView('list'); } }
        : { id: 'view', group: ui.paletteGroupActions, label: ui.paletteShelf, icon: <LayoutGrid />, keywords: 'layout grid posters', run: () => { actions.setFilter('saved'); actions.setSavedView('shelf'); } },
      ...(['all', 'downloading', 'saved'] as const).map((tab): Item => ({ id: `tab-${tab}`, group: ui.paletteGroupGoTo, label: ui.paletteGoTo.replace('{tab}', ui[tab]), icon: <ArrowRight />, keywords: 'tab', current: actions.filter === tab, run: () => actions.setFilter(tab) })),
      { id: 'settings', group: ui.paletteGroupSettings, label: ui.paletteSettings, icon: <Settings />, hint: mac ? '⌘,' : 'Ctrl ,', keywords: 'preferences options', run: () => actions.openSettings() },
      ...settingsSections.map(({ id, title, icon: Icon }): Item => ({ id: `settings-${id}`, group: ui.paletteGroupSettings, label: ui.paletteSettingsSection.replace('{section}', title), icon: <Icon />, keywords: 'preferences', run: () => actions.openSettings(id) })),
      ...ACCENTS.map(({ id, name, swatch }): Item => ({ id: `accent-${id}`, group: ui.paletteGroupAppearance, label: ui.paletteAccent.replace('{name}', name), icon: <span className="palette-swatch" style={{ background: swatch }} />, keywords: 'theme color colour appearance', current: accent === id, run: () => setAccent(id) })),
    ];
    const videoItems = videos.map((row): Item => ({ id: `video-${row.id}`, group: ui.paletteGroupVideos, label: row.title, icon: null, poster: resolveThumbnailUrl(row.thumbnailUrl, apiBase), hint: row.durationLabel, keywords: row.statusLine, movesFocus: true, run: () => actions.jumpTo(row) }));
    if (!trimmed) return [...commands, ...videoItems.slice(0, 3)];
    const rank = (items: Item[]) => items.map((item) => ({ item, score: fuzzyScore(trimmed, `${item.label} ${item.keywords || ''}`) }))
      .filter((entry): entry is { item: Item; score: number } => entry.score !== null).sort((a, b) => b.score - a.score).map((entry) => entry.item);
    // Groups keep their order; within a group the best match leads.
    const ranked = rank(commands);
    const groups = [...new Set(commands.map((item) => item.group))];
    return [...groups.flatMap((group) => ranked.filter((item) => item.group === group)), ...rank(videoItems).slice(0, 6)];
  }, [query, actions, videos, apiBase, accent, setAccent]);
}

/**
 * ⌘K / Ctrl K command palette (unique-look option 11), styled like the launch terminal.
 * Radix Dialog supplies the modal focus trap, Escape and focus return; the input is a combobox
 * over a grouped listbox.
 */
export function CommandPalette({ open, onOpenChange, actions, videos, apiBase }: {
  open: boolean; onOpenChange: (open: boolean) => void; actions: PaletteActions; videos: RowModel[]; apiBase: string;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const pending = useRef<Item | null>(null);
  // Where focus goes back to on close. Recorded here because a StrictMode re-mount would
  // otherwise make Radix remember the palette's own input.
  const returnTo = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const focused = document.activeElement;
    if (open && focused instanceof HTMLElement && !focused.closest('.command-palette')) returnTo.current = focused;
  }, [open]);
  const list = useRef<HTMLDivElement>(null);
  const items = useItems(query, actions, videos, apiBase);
  const active = Math.min(selected, Math.max(0, items.length - 1));
  const choose = (item: Item | undefined) => {
    if (!item) return;
    pending.current = item;
    onOpenChange(false);
  };
  const move = (next: number) => {
    const index = Math.max(0, Math.min(items.length - 1, next));
    setSelected(index);
    list.current?.querySelector(`#palette-option-${index}`)?.scrollIntoView({ block: 'nearest' });
  };
  return <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="command-palette-overlay" />
      <DialogPrimitive.Content className="command-palette" aria-describedby={undefined}
        onOpenAutoFocus={(event) => { event.preventDefault(); (event.currentTarget as HTMLElement).querySelector('input')?.focus(); }}
        onCloseAutoFocus={(event) => {
          // The chosen command runs once the palette has gone, so focus lands where it should.
          const item = pending.current;
          pending.current = null;
          // Each opening starts from an empty prompt.
          setQuery(''); setSelected(0);
          event.preventDefault();
          if (!item?.movesFocus && returnTo.current?.isConnected) returnTo.current.focus();
          returnTo.current = null;
          item?.run();
        }}>
        <DialogPrimitive.Title className="sr-only">{ui.commandPalette}</DialogPrimitive.Title>
        <div className="palette-input">
          <span className="palette-prompt" aria-hidden="true">›</span>
          <div className="palette-field">
            <span className="palette-mirror" aria-hidden="true">{query}</span><i className="palette-cursor" aria-hidden="true" />
            <input value={query} placeholder={ui.paletteHint} spellCheck={false} autoComplete="off"
              role="combobox" aria-expanded="true" aria-controls="command-palette-list" aria-autocomplete="list" aria-label={ui.commandPalette}
              aria-activedescendant={items.length ? `palette-option-${active}` : undefined}
              onChange={(event) => { setQuery(event.target.value); setSelected(0); list.current?.scrollTo({ top: 0 }); }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); move(active + (event.key === 'ArrowDown' ? 1 : -1)); }
                else if (event.key === 'PageDown' || event.key === 'PageUp') { event.preventDefault(); move(active + (event.key === 'PageDown' ? 8 : -8)); }
                else if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); choose(items[active]); }
              }} />
          </div>
          <kbd>esc</kbd>
        </div>
        <div className="palette-results" id="command-palette-list" role="listbox" aria-label={ui.commands} ref={list}>
          {items.length ? items.map((item, index) => {
            const heading = item.group !== items[index - 1]?.group ? item.group : null;
            return <div key={item.id} role="presentation">
              {heading && <div className="palette-group" role="presentation">{heading}</div>}
              <div id={`palette-option-${index}`} role="option" aria-selected={index === active} className={`palette-option${index === active ? ' selected' : ''}`}
                onPointerMove={() => { if (index !== active) setSelected(index); }} onPointerDown={(event) => event.preventDefault()} onClick={() => choose(item)}>
                {item.poster !== undefined ? <span className="palette-poster">{item.poster && <img src={item.poster} alt="" draggable={false} />}</span> : item.icon}
                <span className="palette-label">{item.label}</span>
                {item.current ? <><Check className="palette-current" aria-hidden="true" /><span className="sr-only">(current)</span></> : item.hint && <span className="palette-hint">{item.hint}</span>}
              </div>
            </div>;
          }) : <div className="palette-group palette-empty" role="presentation">{ui.paletteNoMatches}</div>}
        </div>
        <div className="palette-footer" aria-hidden="true"><span><b>↑↓</b> {ui.paletteMove}</span><span><b>↵</b> {ui.paletteRun}</span><span><b>esc</b> {ui.paletteClose}</span></div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>;
}
