import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Eye, EyeOff, Minus, Plus } from 'lucide-react';
import type { DesktopSettings } from '@/types/settings';
import { Switch } from '@/components/ui/switch';
import { ui } from '@/lib/strings';

/** A field whose typed value is not saved yet. The sheet commits it on close and reverts it on Esc. */
export interface Draft { dirty(): boolean; commit(): void; revert(): void }

export interface SettingsForm {
  /** Saves a patch and flashes "Saved" beside the setting named by `key`. Resolves false on failure. */
  commit(patch: Partial<DesktopSettings>, key: string, label: string): Promise<boolean>;
  savedKey: string;
  register(id: string, draft: Draft): () => void;
}

export const SettingsFormContext = createContext<SettingsForm | null>(null);
function useForm() {
  const form = useContext(SettingsFormContext);
  if (!form) throw new Error('Settings fields need SettingsFormContext');
  return form;
}

export function SavedMark({ id }: { id: string }) {
  const { savedKey } = useForm();
  return savedKey === id ? <span className="saved-mark" aria-hidden="true"><Check />{ui.settingSaved}</span> : null;
}

/** Label line with the inline "Saved" confirmation. */
export function SettingTitle({ id, htmlFor, children }: { id: string; htmlFor?: string; children: ReactNode }) {
  return <span className="setting-title">{htmlFor ? <label htmlFor={htmlFor}>{children}</label> : <span id={`${id}-label`}>{children}</span>}<SavedMark id={id} /></span>;
}

/**
 * One inset-grouped row: label and hint on the left, one right-aligned control column, and an
 * optional full-width `below` line (a path, steps, swatches). `id` names the "Saved" flash.
 */
export function SettingRow({ id, htmlFor, label, hint, hintId, error, control, below, className = '', hintRole, onClick, as: Tag = 'div' }: {
  id: string; htmlFor?: string; label: ReactNode; hint?: ReactNode; hintId?: string; error?: boolean; control?: ReactNode; below?: ReactNode;
  className?: string; hintRole?: 'status'; onClick?: (event: React.MouseEvent<HTMLElement>) => void; as?: 'div' | 'li';
}) {
  return <Tag className={`settings-row ${className}`.trim()} onClick={onClick}>
    <div className="settings-row-text">
      <SettingTitle id={id} htmlFor={htmlFor}>{label}</SettingTitle>
      {hint && <p id={hintId} className={`settings-row-hint${error ? ' field-error' : ''}`} role={hintRole}>{hint}</p>}
    </div>
    {control && <div className="settings-row-control">{control}</div>}
    {below && <div className="settings-row-below">{below}</div>}
  </Tag>;
}

/** A captioned group of rows in one inset card, with an optional caption action and a footer note. */
export function SettingsGroup({ id, title, action, footer, children, list, listLabel }: {
  id: string; title: string; action?: ReactNode; footer?: ReactNode; children: ReactNode; list?: boolean; listLabel?: string;
}) {
  return <div className="settings-set" role="group" aria-labelledby={id}>
    <div className="settings-set-head"><h4 id={id}>{title}</h4>{action}</div>
    {list ? <ul className="settings-card" aria-label={listLabel}>{children}</ul> : <div className="settings-card">{children}</div>}
    {footer && <p className="settings-set-foot">{footer}</p>}
  </div>;
}

/** A switch row; a click anywhere on the row (outside its controls) flips the switch too. */
export function SwitchRow({ id, label, hint, checked, onChange }: { id: string; label: string; hint?: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <SettingRow id={id} htmlFor={id} label={label} hint={hint} hintId={hint ? `${id}-hint` : undefined} className="clickable"
    control={<Switch id={id} checked={checked} aria-describedby={hint ? `${id}-hint` : undefined} onCheckedChange={onChange} />}
    onClick={(event) => { if (!(event.target as Element).closest('button, a, input, select, label')) onChange(!checked); }} />;
}

function useDraftField(id: string, value: string, validate: (draft: string) => string, save: (draft: string) => Promise<boolean>) {
  const { register } = useForm();
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState('');
  const focused = useRef(false);
  const state = useRef({ draft, value, validate, save });
  state.current = { draft, value, validate, save };
  // Follow saved values (reset to defaults, another window) unless the person is typing.
  useEffect(() => { if (!focused.current) { setDraft(value); setError(''); } }, [value]);
  const commit = async (next = state.current.draft) => {
    if (next === state.current.value) { setError(''); return; }
    const problem = state.current.validate(next);
    setError(problem);
    if (problem) return;
    if (!await state.current.save(next)) setDraft(state.current.value);
  };
  const revert = () => { setDraft(state.current.value); setError(''); };
  useEffect(() => register(id, { dirty: () => state.current.draft !== state.current.value, commit: () => { void commit(); }, revert }), [id, register]);
  return {
    draft, error, setDraft, commit, revert,
    inputProps: {
      id, value: draft,
      'aria-invalid': error ? true : undefined,
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => { setDraft(event.target.value); if (error) setError(''); },
      onFocus: () => { focused.current = true; },
      onBlur: () => { focused.current = false; void commit(); },
      onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => { if (event.key === 'Enter') { event.preventDefault(); void commit(); } },
    },
  };
}

export function NumberSetting({ id, settingKey, label, hint, value, min, max }: {
  id: string; settingKey: 'queueMaxConcurrent' | 'downloadThreads'; label: string; hint: string; value: number; min: number; max: number;
}) {
  const { commit: save } = useForm();
  const rangeError = ui.numberRange.replace('{min}', String(min)).replace('{max}', String(max));
  const field = useDraftField(id, String(value), (draft) => /^\d+$/.test(draft.trim()) && Number(draft) >= min && Number(draft) <= max ? '' : rangeError,
    (draft) => save({ [settingKey]: Number(draft) }, id, label));
  const step = (delta: number) => {
    const current = /^\d+$/.test(field.draft) ? Number(field.draft) : value;
    const next = String(Math.max(min, Math.min(max, current + delta)));
    field.setDraft(next);
    void field.commit(next);
  };
  const current = Number(field.draft);
  return <SettingRow id={id} htmlFor={id} label={label} hint={field.error || hint} hintId={`${id}-hint`} error={!!field.error}
    control={<div className="settings-stepper">
      <div className="stepper">
        <button type="button" aria-label={ui.decrease.replace('{label}', label)} disabled={current <= min} onClick={() => step(-1)}><Minus /></button>
        <input {...field.inputProps} type="number" inputMode="numeric" min={min} max={max} step={1} aria-describedby={`${id}-hint`} />
        <button type="button" aria-label={ui.increase.replace('{label}', label)} disabled={current >= max} onClick={() => step(1)}><Plus /></button>
      </div>
      <span className="settings-range" aria-hidden="true">{ui.numberBounds.replace('{min}', String(min)).replace('{max}', String(max))}</span>
    </div>} />;
}

export function TextSetting({ id, settingKey, label, hint, value, secret, placeholder, validate, inputRef }: {
  id: string; settingKey: 'customFilename' | 'tmdbApiKey' | 'subdlApiKey'; label: string; hint: string; value: string; secret?: boolean; placeholder?: string;
  validate?: (draft: string) => string; inputRef?: React.Ref<HTMLInputElement>;
}) {
  const { commit: save } = useForm();
  const [visible, setVisible] = useState(false);
  const field = useDraftField(id, value, validate || (() => ''), (draft) => save({ [settingKey]: draft.trim() }, id, label));
  return <SettingRow id={id} htmlFor={id} label={label} hint={field.error || hint} hintId={`${id}-hint`} error={!!field.error}
    control={<div className="key-field">
      <input {...field.inputProps} ref={inputRef} type={secret && !visible ? 'password' : 'text'} placeholder={placeholder} aria-describedby={`${id}-hint`} autoComplete="off" spellCheck={false} />
      {secret && <button type="button" className="key-reveal" aria-label={`${visible ? ui.hideKey : ui.showKey}: ${label}`} aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? <EyeOff /> : <Eye />}</button>}
    </div>} />;
}
