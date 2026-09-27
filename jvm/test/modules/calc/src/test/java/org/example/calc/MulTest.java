package org.example.calc;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class MulTest {
  @Test
  void multiplies() {
    assertEquals(6, Calc.mul(2, 3));
  }
}
