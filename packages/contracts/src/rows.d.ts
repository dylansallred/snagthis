export type RowState = 'detected' | 'waiting' | 'downloading' | 'finishing' | 'paused' | 'problem' | 'saved' | 'missing';
export interface RowAction {
  id: 'download' | 'pause' | 'resume' | 'play' | 'open-page' | 'retry' | 'choose-folder' | 'locate' | 'details' | 'use-chrome-session';
  label: string;
  style: 'primary' | 'bordered' | 'icon';
}
export interface RowProblem { code: 'authentication' | 'expired' | 'network' | 'disk' | 'unsupported' | 'missing' | 'unknown'; message: string; action: RowAction; raw: string; }
export interface RowModel {
  id: string;
  jobId: string | null;
  title: string;
  state: RowState;
  statusLine: string;
  tone: 'muted' | 'attention' | 'success';
  progress: number;
  percent: number;
  thumbnailUrl: string | null;
  durationLabel: string;
  qualityLabel: string;
  sizeLabel: string;
  action: RowAction | null;
  problem: RowProblem | null;
  source: Record<string, any>;
  isHistory: boolean;
  fill: { percent: number; dimmed: boolean; scanLine: boolean };
}
export interface RowOptions { surface?: 'desktop' | 'popup'; now?: number | Date; firstQueuedId?: string; folder?: string; kind?: 'history'; }
export function toRowModel(input: object, options?: RowOptions): RowModel | null;
export function mergeRows(queue: object[], history: object[], options?: RowOptions): RowModel[];
export function formatEta(seconds?: number | null): string;
export function formatSize(bytes?: number | null, options?: { estimated?: boolean }): string;
export function formatWhen(value?: number | string | Date | null, now?: number | Date): string;
export function formatDuration(seconds?: number | null): string;
export function formatQualityBadge(label: string): { tier: string; label: string; name: string };
export function classifyProblem(error: unknown, options?: { progress?: number; folder?: string }): RowProblem;
