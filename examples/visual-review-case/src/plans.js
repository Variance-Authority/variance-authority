import { digestValue } from '@variance-authority/core/format';

/**
 * The page before and after one edit: the Team plan is renamed, and the accent
 * every Choose button is painted in moves from charcoal to orange. Nothing else
 * in the file differs between the two.
 */
const ACCENT = { before: '#24282a', after: '#ff4a19' };

const PLANS = {
  before: [
    { name: 'Starter', price: '$0 a month' },
    { name: 'Team', price: '$12 a month' },
    { name: 'Scale', price: '$40 a month' },
  ],
  after: [
    { name: 'Starter', price: '$0 a month' },
    { name: 'Team, billed yearly for every seat', price: '$12 a month' },
    { name: 'Scale', price: '$40 a month' },
  ],
};

const FONT = '16px Arial, sans-serif';

function element(tag, component, props, style) {
  const node = document.createElement(tag);
  node.dataset.component = component;
  node.dataset.props = digestValue(props);
  Object.assign(node.style, style);
  return node;
}

export function PlanName({ name }) {
  const heading = element('h3', 'PlanName', { name }, {
    width: '200px',
    margin: '0',
    font: `600 ${FONT}`,
    lineHeight: '18px',
    color: '#24282a',
  });
  heading.textContent = name;
  return heading;
}

export function Price({ price }) {
  const text = element('p', 'Price', { price }, {
    margin: '40px 0 0',
    font: FONT,
    lineHeight: '20px',
    color: '#756d67',
  });
  text.textContent = price;
  return text;
}

export function ChooseButton({ accent }) {
  const button = element('button', 'ChooseButton', { accent }, {
    width: '104px',
    height: '40px',
    border: '0',
    borderRadius: '6px',
    backgroundColor: accent,
    color: '#ffffff',
    font: `600 ${FONT}`,
  });
  button.textContent = 'Choose';
  return button;
}

export function PlanCard(plan) {
  const card = element('li', 'PlanCard', plan, {
    boxSizing: 'border-box',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    height: '144px',
    padding: '16px',
    borderBottom: '1px solid #e2e2e2',
  });
  const text = document.createElement('div');
  text.append(PlanName(plan), Price(plan));
  card.append(text, ChooseButton(plan));
  return card;
}

export function Plans(variant) {
  const main = element('main', 'Plans', { variant: 'plans' }, { display: 'block', background: '#ffffff' });
  const section = document.createElement('section');
  section.setAttribute('aria-label', 'Plans');
  const list = document.createElement('ul');
  Object.assign(list.style, { listStyle: 'none', margin: '0', padding: '0' });
  list.append(...PLANS[variant].map((plan) => PlanCard({ ...plan, accent: ACCENT[variant] })));
  section.append(list);
  main.append(section);
  return main;
}
