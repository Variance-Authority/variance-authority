export function pick(items, wanted) {
  return items.find((one) => one === wanted) ?? items.find((one) => one.startsWith(wanted));
}
//# sourceMappingURL=pick.js.map
