export function title(page) {
  return page.evaluate(() => document.title);
}

function countItems(skipped) {
  return document.items.filter((item) => item !== skipped).length;
}

export function count(page) {
  return page.evaluate(countItems, 'b');
}

export function label(text) {
  return `[${text}]`;
}

export function size(page, early) {
  const items = page.evaluate(countAll);
  if (early) return items;
  return items * 2;

  function countAll() {
    return document.items.length;
  }
}

export function kind(page, which) {
  switch (which) {
    case 'count':
      return page.evaluate(countKinds);
    default:
      function countKinds() {
        return document.items.length;
      }
      return 0;
  }
}
