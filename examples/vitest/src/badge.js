// A component. Nothing here knows it is being watched — `capture` takes a
// mounted DOM node, so React, Vue, Svelte or this reach it the same way.

const TONES = {
  neutral: { background: '#eeeeee', color: '#333333', border: '#c4c4c4' },
  urgent: { background: '#fdeaea', color: '#8a2020', border: '#d08b8b' },
};

export function badge(text, tone = 'neutral') {
  const { background, color, border } = TONES[tone];
  const element = document.createElement('span');
  element.textContent = text;
  element.setAttribute(
    'style',
    `display: inline-block; padding: 4px 10px; border-radius: 999px;` +
      `font: 14px system-ui, sans-serif; background: ${background};` +
      `color: ${color}; border: 1px solid ${border};`,
  );
  return element;
}
