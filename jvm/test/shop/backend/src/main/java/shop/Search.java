package shop;

import java.util.Locale;

final class Search {
  static String find(String query) {
    String needle = query.toLowerCase(Locale.ROOT).trim();
    StringBuilder json = new StringBuilder("[");
    for (Catalog.Product product : Catalog.PRODUCTS) {
      if (!matches(product, needle)) continue;
      if (json.length() > 1) json.append(',');
      json.append("{\"sku\":\"").append(product.sku()).append("\",\"name\":\"").append(product.name()).append("\"}");
    }
    return json.append(']').toString();
  }

  private static boolean matches(Catalog.Product product, String needle) {
    return !needle.isEmpty() && product.name().toLowerCase(Locale.ROOT).contains(needle);
  }
}
