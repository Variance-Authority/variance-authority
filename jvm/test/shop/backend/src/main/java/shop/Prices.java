package shop;

final class Prices {
  static int price(String sku) {
    return Catalog.bySku(sku).cents();
  }

  /** Ten percent off an order of 100.00 or more. */
  static int discount(int subtotal) {
    return subtotal >= 10000 ? subtotal / 10 : 0;
  }

  static String format(int cents) {
    return String.format("%d.%02d", cents / 100, cents % 100);
  }
}
