var __name = (target, value) => Object.defineProperty(target, 'name', { value, configurable: true });
export function total(items) {
  if (items.length === 0) {
    return 0;
  }
  return items.reduce(__name(function (sum, item) { return sum + item; }, 'sum'), 0);
}
//# sourceMappingURL=cart.js.map
