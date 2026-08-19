export function PriceTag({ active }: { readonly active: boolean }) {
  return <span style={{ color: active ? '#cf222e' : '#24292f', fontSize: '24px' }}>$42</span>;
}
