import { Check, Palette } from 'lucide-react';
import { ACCENTS, useAccent, type AccentId } from '@/lib/accent';
import { ui } from '@/lib/strings';
import { SettingTitle } from './settingsFields';

/** Accent colour swatches. Native radios give the group arrow-key movement and checked state. */
export function AccentPicker({ onSaved }: { onSaved: () => void }) {
  const [accent, setAccent] = useAccent();
  const choose = (id: AccentId) => { setAccent(id); onSaved(); };
  return <div className="preference-row accent-row">
    <span className="setting-icon" aria-hidden="true"><Palette /></span>
    <div className="setting-text">
      <SettingTitle id="accent-colour">{ui.accentColour}</SettingTitle>
      <small id="accent-colour-hint">{ui.accentHint}</small>
      <div className="accent-swatches" role="radiogroup" aria-labelledby="accent-colour-label" aria-describedby="accent-colour-hint">
        {ACCENTS.map(({ id, name, swatch }) => <label key={id} className="accent-swatch" style={{ '--swatch': swatch } as React.CSSProperties}>
          <input type="radio" name="accent-colour" value={id} checked={accent === id} onChange={() => choose(id)} />
          <span className="accent-dot" aria-hidden="true"><Check /></span>
          <span className="accent-name">{name}</span>
        </label>)}
      </div>
    </div>
  </div>;
}
