import { Button } from './Button.jsx';

export function Panel({ heading }) {
  return (
    <section style={{ border: '1px solid #d6dae0', padding: 20, width: 320, font: '16px system-ui, sans-serif' }}>
      <h2 style={{ margin: '0 0 12px', fontSize: 18 }}>{heading}</h2>
      <Button label="Save" tone="primary" />
    </section>
  );
}
