function choose(item) {
  return item;
}

function pay(amount) {
  return amount > 10 ? 'card' : 'cash';
}

globalThis.shop = { choose, pay };
