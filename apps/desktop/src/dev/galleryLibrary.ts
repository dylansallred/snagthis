import { folderNameProblem, isInternalName, libraryText, parentFolder } from '@m3u8/contracts/src/library.mjs';
import { ApiRequestError } from '@/lib/api';
import type { DeleteMode, LibraryBackend, LibraryInfo, MoveResult } from '@/types/library';
import emberTide from './media/ember-tide.jpg';
import neonRain from './media/neon-rain.jpg';
import skyHop from './media/sky-hop.jpg';
import starCourier from './media/star-courier.jpg';

/** A saved video in the design gallery's library (the shape the bridge's history items have). */
export interface GalleryItem {
  id: string; jobId: string | null; fileName: string; title: string; folder: string; sourcePageUrl?: string;
  height?: number; sizeBytes: number; modifiedAt: number; thumbnailUrl: string; durationSeconds?: number; missing?: boolean;
  /** Fails the next move with "open in another app", once (the gallery's move-failed preview). */
  locked?: boolean;
}

const now = Date.now();
const day = 86_400_000;
const MB = 1_000_000;
const item = (id: string, title: string, folder: string, site: string, height: number, mb: number, seconds: number, daysAgo: number, thumbnailUrl: string, extra: Partial<GalleryItem> = {}): GalleryItem => ({
  id, jobId: id, fileName: `${title}.mp4`, title, folder, sourcePageUrl: `https://${site}/watch/${id}`, height, sizeBytes: mb * MB,
  modifiedAt: now - daysAgo * day - 3_600_000, thumbnailUrl, durationSeconds: seconds, ...extra,
});

/** The organise preview: the Pixel worlds sample media filed into a few folders, and some loose videos. */
function organizeSample(): { items: GalleryItem[]; folders: string[] } {
  return {
    folders: ['Music & ambience', 'Road trips', 'Tutorials', 'Tutorials/Advanced', 'Watch later', 'Wishlist'],
    items: [
      item('g-skyhop', 'Sky Hop — a play button’s day out', '', 'vimeo.com', 720, 96, 342, 0, skyHop),
      item('g-boss', 'Star Courier — boss rush', '', 'archive.org', 2160, 1300, 921, 1, starCourier),
      item('g-commentary', 'Sky Hop — director’s commentary', '', 'nebula.tv', 1080, 640, 1458, 3, skyHop),
      item('g-speedrun', 'Ember Tide speedrun in 11:52', '', 'dailymotion.com', 720, 505, 712, 4, emberTide),
      item('g-rooftop', 'Neon Rain — rooftop chase', '', 'vimeo.com', 1080, 298, 450, 9, neonRain),
      item('g-market', 'Night market in 8 bits', '', 'archive.org', 720, 144, 372, 11, neonRain),
      item('g-palette', 'Palette swap: dusk to dawn', '', 'nebula.tv', 480, 88, 198, 38, emberTide),
      item('g-live', 'Neon Rain — soundtrack live', '', 'archive.org', 480, 410, 2832, 16, neonRain, { missing: true }),
      item('g-crossing', 'Ember Tide — sunset crossing', 'Road trips', 'nebula.tv', 1080, 1200, 1334, 1, emberTide),
      item('g-coast', 'Coast road — drive at dusk', 'Road trips', 'vimeo.com', 2160, 720, 1005, 39, emberTide),
      item('g-drive', 'Neon Rain — night drive', 'Road trips', 'nebula.tv', 1080, 412, 757, 0, neonRain),
      item('g-bus', 'Night bus to the coast', 'Road trips', 'dailymotion.com', 1080, 480, 664, 60, skyHop),
      item('g-harbour', 'Harbour lights timelapse', 'Road trips', 'archive.org', 2160, 1800, 245, 14, emberTide),
      item('g-lofi', 'Lo-fi harbour loop (1 hour)', 'Music & ambience', 'archive.org', 480, 820, 3600, 4, emberTide),
      item('g-ost', 'Star Courier OST — full soundtrack', 'Music & ambience', 'archive.org', 480, 210, 2465, 6, starCourier),
      item('g-jingles', 'Courier jingles — chiptune session', 'Music & ambience', 'nebula.tv', 480, 176, 1930, 18, starCourier),
      item('g-rain', 'Drawing pixel rain in 20 minutes', 'Tutorials', 'nebula.tv', 1080, 300, 1210, 20, neonRain),
      item('g-physics', 'Platformer physics, explained', 'Tutorials', 'vimeo.com', 720, 160, 840, 25, skyHop),
      item('g-cycling', 'Palette cycling deep dive', 'Tutorials/Advanced', 'nebula.tv', 1080, 410, 1802, 33, neonRain),
      item('g-arcade', 'Star Courier — arcade run', 'Watch later', 'vimeo.com', 1080, 520, 485, 2, starCourier),
      item('g-tech', 'Sky Hop — speed tech', 'Watch later', 'dailymotion.com', 720, 90, 301, 8, skyHop),
    ],
  };
}

/** The gallery's classic saved rows (`?gallery`, `?gallery=states`). */
function classicSample(withMissing: boolean): { items: GalleryItem[]; folders: string[] } {
  const items: GalleryItem[] = [{ id: 'saved', jobId: 'saved', fileName: 'Ember Tide.mp4', title: 'Ember Tide — director’s cut', folder: '', sourcePageUrl: 'https://videos.example/ember-tide/', height: 1080, sizeBytes: 182_000_000, modifiedAt: now, thumbnailUrl: emberTide, durationSeconds: 1334 }];
  if (withMissing) items.push({ id: 'missing', jobId: 'missing', fileName: 'Sky Hop.mp4', title: 'Sky Hop — saved copy', folder: '', sizeBytes: 650_000_000, modifiedAt: now - day, thumbnailUrl: skyHop, durationSeconds: 342, missing: true });
  return { items, folders: [] };
}

const refuse = (code: string, values: Record<string, string> = {}) => new ApiRequestError(libraryText(code, values), code);
const inside = (folder: string, parent: string) => folder === parent || folder.startsWith(`${parent}/`);

/**
 * An in-memory library for the design gallery: the same folder operations as the bridge,
 * with no files, so the organise previews and the browser tests can drive the real interface.
 */
export class GalleryLibrary implements LibraryBackend {
  items: GalleryItem[];
  folders: string[];
  version = 0;
  private listeners = new Set<() => void>();
  constructor(seed: 'organize' | 'states' | 'default' | 'empty') {
    const sample = seed === 'organize' ? organizeSample() : seed === 'empty' ? { items: [], folders: [] } : classicSample(seed === 'states');
    this.items = sample.items;
    this.folders = sample.folders;
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getVersion = () => this.version;
  private changed() {
    this.version += 1;
    this.items = [...this.items];
    this.listeners.forEach((listener) => listener());
  }
  private siblings(parent: string) {
    return this.folders.filter((folder) => parentFolder(folder) === parent).map((folder) => folder.split('/').pop() as string);
  }
  private check(parent: string, name: string, current?: string) {
    const problem = folderNameProblem(name, { siblings: this.siblings(parent), caseInsensitive: true, current });
    if (problem) throw new ApiRequestError(problem.message, problem.code);
  }
  private exists(path: string) { return path === '' || this.folders.includes(path); }
  patch(id: string, patch: Partial<GalleryItem>) { this.items = this.items.map((entry) => entry.id === id ? { ...entry, ...patch } : entry); this.changed(); }
  remove(id: string) { this.items = this.items.filter((entry) => entry.id !== id); this.changed(); }
  lock(id: string) { this.patch(id, { locked: true }); }

  async info(): Promise<LibraryInfo> {
    const newest = [...this.items].filter((entry) => !entry.missing).sort((a, b) => b.modifiedAt - a.modifiedAt);
    return {
      root: { name: 'SnagThis', path: '~/Downloads/SnagThis', displayPath: '~/Downloads/SnagThis' },
      folders: [...this.folders].sort((a, b) => a.localeCompare(b)).map((path) => {
        const videos = newest.filter((entry) => inside(entry.folder, path));
        return {
          path, name: path.split('/').pop() as string, parent: parentFolder(path), videoCount: videos.length,
          sizeBytes: videos.reduce((total, entry) => total + entry.sizeBytes, 0),
          otherFiles: path === 'Road trips' ? { count: 2, names: ['route.gpx', 'notes.txt'] } : { count: 0, names: [] },
        };
      }),
    };
  }
  async createFolder(parent: string, name: string) {
    if (!this.exists(parent)) throw refuse('reasonFolderMissing');
    this.check(parent, name);
    const path = parent ? `${parent}/${name}` : name;
    this.folders = [...this.folders, path];
    this.changed();
    return { path };
  }
  async renameFolder(path: string, name: string) {
    if (!path || !this.exists(path)) throw refuse('reasonFolderMissing');
    const parent = parentFolder(path);
    this.check(parent, name, path.split('/').pop());
    const next = parent ? `${parent}/${name}` : name;
    const move = (value: string) => (inside(value, path) ? next + value.slice(path.length) : value);
    this.folders = this.folders.map(move);
    this.items = this.items.map((entry) => ({ ...entry, folder: move(entry.folder) }));
    this.changed();
    return { path: next };
  }
  async deleteFolder(path: string, mode?: DeleteMode) {
    if (!path || !this.exists(path)) throw refuse('reasonFolderMissing');
    const contents = this.items.filter((entry) => inside(entry.folder, path));
    const nested = this.folders.filter((folder) => folder !== path && inside(folder, path));
    const other = path === 'Road trips';
    if (!contents.length && !nested.length && !other) {
      this.folders = this.folders.filter((folder) => folder !== path);
      this.changed();
      return { deleted: 'empty' as const, moved: 0 };
    }
    if (mode === 'trash') {
      this.items = this.items.filter((entry) => !inside(entry.folder, path));
      this.folders = this.folders.filter((folder) => !inside(folder, path));
      this.changed();
      return { deleted: 'trash' as const, moved: contents.filter((entry) => !entry.missing).length };
    }
    if (mode !== 'keep') throw new ApiRequestError('Choose whether to keep the videos or move the folder to Trash', 'choose');
    const parent = parentFolder(path);
    const taken = new Set(this.siblings(parent).map((name) => name.toLowerCase()));
    const renames = new Map<string, string>();
    for (const folder of nested.filter((entry) => parentFolder(entry) === path)) {
      const name = folder.split('/').pop() as string;
      let free = name;
      for (let number = 2; taken.has(free.toLowerCase()); number += 1) free = `${name} (${number})`;
      taken.add(free.toLowerCase());
      renames.set(folder, parent ? `${parent}/${free}` : free);
    }
    const lift = (value: string) => {
      if (value === path) return parent;
      for (const [from, to] of renames) if (inside(value, from)) return to + value.slice(from.length);
      return value;
    };
    this.items = this.items.map((entry) => ({ ...entry, folder: lift(entry.folder) }));
    this.folders = this.folders.filter((folder) => folder !== path).map(lift);
    this.changed();
    return { deleted: 'keep' as const, moved: contents.filter((entry) => entry.folder === parent).length };
  }
  async move(ids: string[], to: string): Promise<MoveResult[]> {
    if (!this.exists(to) || isInternalName(to)) throw refuse('reasonFolderMissing');
    const results = ids.map((id) => {
      const entry = this.items.find((candidate) => candidate.id === id);
      if (!entry || entry.missing) return { id, ok: false, code: 'missing' };
      if (entry.locked) { entry.locked = false; return { id, ok: false, code: 'in-use' }; }
      entry.folder = to;
      return { id, ok: true };
    });
    this.changed();
    return results;
  }
  async reveal() { /* The gallery has no file manager to open. */ }
}
