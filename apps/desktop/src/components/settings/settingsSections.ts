import { AppWindow, Download, Info, Palette, Puzzle, SlidersHorizontal, type LucideIcon } from 'lucide-react';
import { ui } from '@/lib/strings';

/** Sidebar sections of desktop Settings, in rail order (settings-refresh option 2). */
export const settingsSections = [
  { id: 'chrome', title: ui.chrome, description: ui.chromeSectionHint, icon: Puzzle },
  { id: 'downloads', title: ui.groupDownloads, description: ui.downloadsSectionHint, icon: Download },
  { id: 'app', title: ui.groupApp, description: ui.appSectionHint, icon: AppWindow },
  { id: 'appearance', title: ui.appearance, description: ui.appearanceSectionHint, icon: Palette },
  { id: 'advanced', title: ui.advanced, description: ui.advancedSectionHint, icon: SlidersHorizontal },
  { id: 'about', title: ui.updatesSupport, description: ui.updatesSupportSectionHint, icon: Info },
] as const satisfies ReadonlyArray<{ id: string; title: string; description: string; icon: LucideIcon }>;

export type SettingsSectionId = typeof settingsSections[number]['id'];

/** The section Settings shows the first time it opens in a session. */
export const defaultSettingsSection: SettingsSectionId = 'downloads';

export const isSettingsSection = (value: unknown): value is SettingsSectionId => settingsSections.some((section) => section.id === value);
