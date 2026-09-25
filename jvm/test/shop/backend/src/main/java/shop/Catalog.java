package shop;

import java.util.List;

final class Catalog {
  record Product(String sku, String name, int cents) {}

  static final List<Product> PRODUCTS = List.of(
      new Product("kettle", "Copper kettle", 4900),
      new Product("teapot", "Stoneware teapot", 3200),
      new Product("cups", "Tea cups, set of four", 2400),
      new Product("tin", "Loose leaf tin", 900));

  static Product bySku(String sku) {
    for (Product product : PRODUCTS) {
      if (product.sku().equals(sku)) return product;
    }
    throw new IllegalArgumentException("no product " + sku);
  }
}
