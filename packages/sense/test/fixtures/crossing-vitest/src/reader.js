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
