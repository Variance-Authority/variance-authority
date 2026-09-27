package org.example.calc;

public final class Calc {
  private Calc() {}

  public static int add(int a, int b) {
    return a + b;
  }

  public static int mul(int a, int b) {
    return a * b;
  }

  public static int neg(int a) {
    return -a;
  }
}
