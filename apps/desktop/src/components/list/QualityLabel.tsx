import { formatQualityBadge } from '@m3u8/contracts/src/rows.mjs';

export function QualityLabel({ label }: { label: string }) {
  const quality = formatQualityBadge(label);
  if (!quality.label) return null;
  return (
    <span className="quality-mark q-solid" role={quality.tier ? 'img' : undefined} aria-label={quality.tier ? `${quality.name}, ${quality.label}` : undefined} title={quality.tier ? quality.name : undefined}>
      {quality.tier && <span className="tier-badge" aria-hidden="true">{quality.tier}</span>}
      <span className="resolution">{quality.label}</span>
    </span>
  );
}
