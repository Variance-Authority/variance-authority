package org.example.calc;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class NegTest {
  @Test
  void negates() {
    assertEquals(-2, Calc.neg(2));
  }
}
