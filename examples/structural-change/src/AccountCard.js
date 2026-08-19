/** The two variants deliberately share every painted declaration. */
export function AccountCard(variant) {
  const card = document.createElement(variant === 'after' ? 'section' : 'div');
  card.dataset.component = 'AccountCard';
  if (variant === 'after') card.setAttribute('aria-label', 'Account');

  Object.assign(card.style, {
    boxSizing: 'border-box',
    width: '224px',
    height: '96px',
    padding: '16px',
    border: '1px solid #d0d7de',
    borderRadius: '8px',
    background: '#ffffff',
    color: '#24292f',
    font: '600 16px Arial, sans-serif',
  });

  const heading = document.createElement('span');
  heading.textContent = 'Marina Korzunova';
  card.append(heading);
  return card;
}
