package shop;

import java.util.List;

final class Cart {
  static String summary(List<String> skus) {
    int subtotal = 0;
    for (String sku : skus) subtotal += Prices.price(sku);
    int discount = Prices.discount(subtotal);
    return "{\"count\":" + skus.size()
        + ",\"subtotal\":\"" + Prices.format(subtotal) + "\""
        + ",\"discount\":\"" + Prices.format(discount) + "\""
        + ",\"total\":\"" + Prices.format(subtotal - discount) + "\"}";
  }
}
