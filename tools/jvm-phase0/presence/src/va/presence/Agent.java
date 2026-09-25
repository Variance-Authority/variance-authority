package va.presence;

import java.io.File;
import java.lang.instrument.ClassFileTransformer;
import java.lang.instrument.Instrumentation;
import java.security.ProtectionDomain;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
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

import va.presence.rt.Presence;

/**
 * Records which methods ran: one flag per method, set on entry.
 *
 * Phase 0 harness. Options, comma separated: {@code includes} is a
 * colon-separated list of class-name globs, as JaCoCo's; {@code sources} is a
 * colon-separated list of source roots, relative to the working directory. The
 * store is {@link Presence}, on the bootstrap class path through this jar's
 * {@code Boot-Class-Path}.
 *
 * A class's file is found, not assumed: the one path under the roots that
 * exists as {@code <root>/<package>/<SourceFile>}, or else the one file under
 * the roots with that name, for Kotlin, whose package need not match its
 * directory. A class that resolves to no file or to several is recorded as
 * unknown, with one flag for the whole class, and a row that entered it cannot
 * exclude its test. A class that fails to instrument is recorded as failed, and
 * every later row carries it. A class without a {@code SourceFile} attribute is
 * generated (a proxy, a class a test defines at runtime) and is not probed: no
 * source file can change it, and the code that generates it is probed.
 *
 * Only method entry is probed. A constructor's probe runs before its
 * {@code super(...)} call, which is legal because it does not touch
 * {@code this}. A method without code (abstract, native) has no probe, and
 * neither has a synthetic one other than a lambda body: accessors and bridges
 * only forward, and their callee is probed.
 */
public final class Agent implements ClassFileTransformer {
  static final String DEFAULT_SOURCES = "src/main/java:src/test/java:src/main/kotlin:src/test/kotlin";
  private static volatile List<String> active = Arrays.asList(DEFAULT_SOURCES.split(":"));
  private final List<Pattern> includes = new ArrayList<>();
  private final List<String> roots = new ArrayList<>();
  private final Map<String, String> resolved = new HashMap<>();
  private Map<String, List<String>> byName;

  private Agent(String args) {
    String sources = DEFAULT_SOURCES;
    for (String option : (args == null ? "" : args).split(",")) {
      int eq = option.indexOf('=');
      if (eq < 0) continue;
      String key = option.substring(0, eq);
      String value = option.substring(eq + 1);
      if (key.equals("includes")) {
        for (String glob : value.split(":")) includes.add(glob(glob));
      } else if (key.equals("sources")) {
        sources = value;
      } else {
        throw new IllegalArgumentException("unknown presence option " + key);
      }
    }
    if (includes.isEmpty()) includes.add(glob("*"));
    for (String root : sources.split(":")) roots.add(root);
    active = roots;
  }

  /** The source roots classes are resolved under in this JVM. */
  static List<String> roots() {
    return active;
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
      return instrument(bytes);
    } catch (RuntimeException | LinkageError e) {
      Presence.fail(name);
      System.err.println("presence: left " + dotted + " uninstrumented: " + e);
      return null;
    }
  }

  private byte[] instrument(byte[] bytes) {
    ClassNode cn = new ClassNode();
    new ClassReader(bytes).accept(cn, 0);
    if ((cn.access & Opcodes.ACC_MODULE) != 0 || cn.sourceFile == null) return null;
    int slash = cn.name.lastIndexOf('/');
    String dir = slash < 0 ? "" : cn.name.substring(0, slash + 1);
    String file = resolve(dir, cn.sourceFile);
    int unknown = file == null ? Presence.register("{\"unknown\":" + quote(cn.name) + "}") : -1;
    boolean changed = false;
    for (MethodNode m : cn.methods) {
      if (m.instructions.size() == 0) continue;
      if ((m.access & Opcodes.ACC_SYNTHETIC) != 0 && !m.name.startsWith("lambda$")) continue;
      int index = unknown;
      if (file != null) {
        TreeSet<Integer> lines = new TreeSet<>();
        for (AbstractInsnNode n : m.instructions) {
          if (n instanceof LineNumberNode) lines.add(((LineNumberNode) n).line);
        }
        index = Presence.register(meta(file, cn.name, m.name + m.desc, lines));
      }
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

  /** The one existing source path for a class, or null when there is none or more than one. */
  private synchronized String resolve(String dir, String sourceFile) {
    String key = dir + sourceFile;
    if (resolved.containsKey(key)) return resolved.get(key);
    List<String> found = new ArrayList<>();
    for (String root : roots) {
      String path = root + "/" + key;
      if (new File(path).isFile()) found.add(path);
    }
    if (found.isEmpty()) {
      List<String> named = byName().get(sourceFile);
      if (named != null) found.addAll(named);
    }
    String file = found.size() == 1 ? found.get(0) : null;
    resolved.put(key, file);
    return file;
  }

  /** Every file under the roots by its name, read once, for a class whose package is not its directory. */
  private Map<String, List<String>> byName() {
    if (byName != null) return byName;
    byName = new HashMap<>();
    for (String root : roots) walk(new File(root), root);
    return byName;
  }

  private void walk(File dir, String path) {
    File[] children = dir.listFiles();
    if (children == null) return;
    for (File child : children) {
      String childPath = path + "/" + child.getName();
      if (child.isDirectory()) walk(child, childPath);
      else byName.computeIfAbsent(child.getName(), k -> new ArrayList<>()).add(childPath);
    }
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
