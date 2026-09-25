package va.presence;

import java.lang.instrument.ClassFileTransformer;
import java.lang.instrument.Instrumentation;
import java.security.ProtectionDomain;
import java.util.ArrayList;
import java.util.List;
import java.util.TreeSet;
import java.util.regex.Pattern;

import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassWriter;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.tree.AbstractInsnNode;
import org.objectweb.asm.tree.ClassNode;
import org.objectweb.asm.tree.FieldInsnNode;
import org.objectweb.asm.tree.InsnList;
import org.objectweb.asm.tree.InsnNode;
import org.objectweb.asm.tree.LdcInsnNode;
import org.objectweb.asm.tree.LineNumberNode;
import org.objectweb.asm.tree.MethodNode;

/**
 * Records which methods ran: one flag per method, set on entry.
 *
 * Phase 0 harness. Options, comma separated: {@code includes} is a
 * colon-separated list of class-name globs, as JaCoCo's; {@code source} is the
 * source root the record names files under. The store is
 * {@link va.presence.rt.Presence}, on the bootstrap class path through this
 * jar's {@code Boot-Class-Path}.
 *
 * Only method entry is probed. A constructor's probe runs before its
 * {@code super(...)} call, which is legal because it does not touch
 * {@code this}. A method without code (abstract, native) has no probe, and
 * neither has a synthetic one other than a lambda body: accessors and bridges
 * only forward, and their callee is probed. A class loaded from a
 * {@code test-classes} directory is named under {@code test-source}.
 */
public final class Agent implements ClassFileTransformer {
  private final List<Pattern> includes = new ArrayList<>();
  private final String source;
  private final String testSource;

  private Agent(String args) {
    String src = "src/main/java";
    String testSrc = "src/test/java";
    for (String option : (args == null ? "" : args).split(",")) {
      int eq = option.indexOf('=');
      if (eq < 0) continue;
      String key = option.substring(0, eq);
      String value = option.substring(eq + 1);
      if (key.equals("includes")) {
        for (String glob : value.split(":")) includes.add(glob(glob));
      } else if (key.equals("source")) {
        src = value;
      } else if (key.equals("test-source")) {
        testSrc = value;
      } else {
        throw new IllegalArgumentException("unknown presence option " + key);
      }
    }
    if (includes.isEmpty()) includes.add(glob("*"));
    source = src;
    testSource = testSrc;
  }

  public static void premain(String args, Instrumentation inst) {
    inst.addTransformer(new Agent(args));
  }

  private static Pattern glob(String glob) {
    StringBuilder re = new StringBuilder();
    for (char c : glob.toCharArray()) {
      if (c == '*') re.append(".*");
      else if (c == '?') re.append('.');
      else re.append(Pattern.quote(String.valueOf(c)));
    }
    return Pattern.compile(re.toString());
  }

  @Override
  public byte[] transform(ClassLoader loader, String name, Class<?> redefined, ProtectionDomain domain, byte[] bytes) {
    if (loader == null || name == null || redefined != null || name.startsWith("va/presence/")) return null;
    String dotted = name.replace('/', '.');
    boolean included = false;
    for (Pattern p : includes) {
      if (p.matcher(dotted).matches()) {
        included = true;
        break;
      }
    }
    if (!included) return null;
    try {
      return instrument(bytes, isTest(domain) ? testSource : source);
    } catch (RuntimeException e) {
      System.err.println("presence: left " + dotted + " uninstrumented: " + e);
      return null;
    }
  }

  private static boolean isTest(ProtectionDomain domain) {
    if (domain == null || domain.getCodeSource() == null || domain.getCodeSource().getLocation() == null) return false;
    String location = domain.getCodeSource().getLocation().getPath();
    return location.endsWith("/test-classes/") || location.endsWith("/test-classes");
  }

  private byte[] instrument(byte[] bytes, String source) {
    ClassNode cn = new ClassNode();
    new ClassReader(bytes).accept(cn, 0);
    if ((cn.access & Opcodes.ACC_MODULE) != 0 || cn.sourceFile == null) return null;
    int slash = cn.name.lastIndexOf('/');
    String file = source + "/" + (slash < 0 ? "" : cn.name.substring(0, slash + 1)) + cn.sourceFile;
    boolean changed = false;
    for (MethodNode m : cn.methods) {
      if (m.instructions.size() == 0) continue;
      if ((m.access & Opcodes.ACC_SYNTHETIC) != 0 && !m.name.startsWith("lambda$")) continue;
      TreeSet<Integer> lines = new TreeSet<>();
      for (AbstractInsnNode n : m.instructions) {
        if (n instanceof LineNumberNode) lines.add(((LineNumberNode) n).line);
      }
      int index = va.presence.rt.Presence.register(meta(file, cn.name, m.name + m.desc, lines));
      InsnList probe = new InsnList();
      probe.add(new FieldInsnNode(Opcodes.GETSTATIC, "va/presence/rt/Presence", "P", "[Z"));
      probe.add(new LdcInsnNode(index));
      probe.add(new InsnNode(Opcodes.ICONST_1));
      probe.add(new InsnNode(Opcodes.BASTORE));
      m.instructions.insert(probe);
      changed = true;
    }
    if (!changed) return null;
    ClassWriter cw = new ClassWriter(ClassWriter.COMPUTE_MAXS);
    cn.accept(cw);
    return cw.toByteArray();
  }

  /** The record's method entry, preformatted: the listener only joins these. */
  private static String meta(String file, String cls, String method, TreeSet<Integer> lines) {
    StringBuilder s = new StringBuilder();
    s.append("{\"file\":").append(quote(file))
        .append(",\"class\":").append(quote(cls))
        .append(",\"method\":").append(quote(method))
        .append(",\"first\":").append(lines.isEmpty() ? -1 : lines.first())
        .append(",\"last\":").append(lines.isEmpty() ? -1 : lines.last())
        .append(",\"lines\":[");
    boolean first = true;
    for (int l : lines) {
      if (!first) s.append(',');
      first = false;
      s.append(l);
    }
    return s.append("]}").toString();
  }

  private static String quote(String s) {
    return "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
  }
}
