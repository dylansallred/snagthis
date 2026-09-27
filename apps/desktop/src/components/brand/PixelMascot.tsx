import { useRef } from 'react';
import { PixelButton, pressPixelButton } from './PixelButton';
import { PixelText } from './PixelText';
import './PixelMascot.css';

export type MascotVariant = 'first' | 'dozing' | 'shelf';

/**
 * The logo's play button as a small still-life character for empty lists only:
 * it waits on first launch, dozes when nothing is downloading, and sits on an empty shelf in Saved.
 * Decorative; the copy beside it carries the meaning.
 */
export function PixelMascot({ variant }: { variant: MascotVariant }) {
  const root = useRef<HTMLDivElement>(null);
  const press = () => pressPixelButton(root.current?.querySelector('.pixel-button'));
  return <div ref={root} className="pixel-mascot" data-variant={variant} aria-hidden="true" onPointerEnter={press} onClick={press}>
    {variant === 'dozing' ? <>
      <PixelButton size={64} glyph="pause" />
      <PixelText className="pixel-mascot-z" text="z" scale={3} />
      <PixelText className="pixel-mascot-z" text="z" scale={2} />
      <i className="pixel-mascot-floor" />
    </> : variant === 'shelf' ? <>
      <div className="pixel-mascot-bob"><PixelButton size={48} /></div>
      <i className="pixel-mascot-shelf" /><i className="pixel-mascot-slot" /><i className="pixel-mascot-slot" />
    </> : <>
      <div className="pixel-mascot-bob"><PixelButton size={64} /></div>
      <i className="pixel-mascot-floor" />
    </>}
  </div>;
}
