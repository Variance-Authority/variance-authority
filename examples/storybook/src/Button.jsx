export function Button({ label, tone = 'neutral' }) {
  const primary = tone === 'primary';
  return (
    <button
      style={{
        background: primary ? '#2b5cff' : '#eeeeee',
        color: primary ? '#ffffff' : '#222222',
        border: '1px solid #999999',
        borderRadius: 6,
        padding: '8px 16px',
        font: '16px system-ui, sans-serif',
      }}
    >
      {label}
    </button>
  );
}
