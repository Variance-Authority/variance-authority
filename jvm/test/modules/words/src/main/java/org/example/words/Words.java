package org.example.words;

import java.util.Locale;

public final class Words {
  private Words() {}

  public static String shout(String word) {
    return word.toUpperCase(Locale.ROOT) + "!";
  }
}
