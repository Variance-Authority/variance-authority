package dev.varianceauthority.jvm.junit;

import java.lang.instrument.Instrumentation;

/** Nothing to instrument: the jar is an agent only so the JVM appends it to the system class path. */
public final class Premain {
  public static void premain(String args, Instrumentation inst) {}
}
