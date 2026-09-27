import { Check } from 'lucide-react';
import { ACCENTS, useAccent, type AccentId } from '@/lib/accent';
import { ui } from '@/lib/strings';
import { SettingRow } from './settingsFields';

/**
 * Accent colour swatches in one row: the chosen colour's name as the label, the swatches below.
 * Native radios give the group arrow-key movement and checked state.
 */
export function AccentPicker({ onSaved }: { onSaved: () => void }) {
  const [accent, setAccent] = useAccent();
  const choose = (id: AccentId) => { setAccent(id); onSaved(); };
  const current = ACCENTS.find((entry) => entry.id === accent) || ACCENTS[0];
  return <SettingRow id="accent-colour" className="accent-row" label={current.name} hint={ui.accentHint} hintId="accent-colour-hint"
    below={<div className="accent-swatches" role="radiogroup" aria-label={ui.accentColour} aria-describedby="accent-colour-hint">
      {ACCENTS.map(({ id, name, swatch }) => <label key={id} className="accent-swatch" style={{ '--swatch': swatch } as React.CSSProperties}>
        <input type="radio" name="accent-colour" value={id} checked={accent === id} onChange={() => choose(id)} />
        <span className="accent-dot" aria-hidden="true"><Check /></span>
        <span className="accent-name">{name}</span>
      </label>)}
    </div>} />;
}
