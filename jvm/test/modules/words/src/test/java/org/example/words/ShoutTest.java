package org.example.words;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class ShoutTest {
  @Test
  void shouts() {
    assertEquals("HI!", Words.shout("hi"));
  }
}
