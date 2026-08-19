import type { CSSProperties } from 'react';
import { DynamicImage } from './dynamic-image.js';
import { PriceTag } from './price-tag.js';

const CARD_STYLE: CSSProperties = {
  alignItems: 'center',
  display: 'flex',
  gap: '32px',
  height: '80px',
  padding: '8px',
  width: '224px',
};

export function ProductCard({ active }: { readonly active: boolean }) {
  return (
    <main style={CARD_STYLE}>
      <PriceTag active={active} />
      <DynamicImage />
    </main>
  );
}
