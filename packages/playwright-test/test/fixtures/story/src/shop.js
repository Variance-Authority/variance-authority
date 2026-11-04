function open() {
  return 'open';
}

function choose(item) {
  console.log('chose', item);
  return item;
}

function pay(amount) {
  if (amount > 10) {
    return 'card';
  }
  return 'cash';
}

globalThis.shop = { open, choose, pay };
