package dev.varianceauthority.jvm;

import java.io.File;
import java.lang.instrument.ClassFileTransformer;
import java.lang.instrument.Instrumentation;
import java.net.URISyntaxException;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.security.CodeSource;
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

import dev.varianceauthority.jvm.rt.Presence;

/**
 * Records which methods ran: one flag per method, set on entry.
 *
 * Options, comma separated: {@code includes} is a
 * colon-separated list of class-name globs, as JaCoCo's; {@code sources} is a
 * colon-separated list of source roots, relative to the working directory. The
 * store is {@link Presence}, on the bootstrap class path through this jar's
 * {@code Boot-Class-Path}.
 *
 * Without {@code includes}, the classes probed are the checkout's own: those
 * loaded from a location inside it ({@code target/classes}, a module's jar),
 * and none loaded from a dependency cache or the JDK. No diff of the checkout
 * can change a dependency, so probing one could only ever mark rows unknown.
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
  /** What {@link #resolve} answers for a class whose source name matches more than one file. */
  private static final String AMBIGUOUS = "";
  private final List<Pattern> includes = new ArrayList<>();
  private final List<String> roots = new ArrayList<>();
  /** Where the checkout's own classes load from, when {@code includes} did not name them. */
  private final Path checkout;
  private final Map<String, String> resolved = new HashMap<>();
  /** Where this JVM runs, from the checkout: a row names its files as the checkout does, so any module's JVM can read them. */
  private final String prefix = Parts.checkoutPrefix();
  private Map<String, List<String>> byName;

  private Agent(String args) {
    String sources = DEFAULT_SOURCES;
    for (String option : (args == null ? "" : args).split(",")) {
      int eq = option.indexOf('=');
      if (eq < 0) continue;
      String key = option.substring(0, eq);
      String value = option.substring(eq + 1);
      if (key.equals("includes")) {
        for (String glob : value.split(":")) if (!glob.isEmpty()) includes.add(glob(glob));
      } else if (key.equals("sources")) {
        sources = value;
      } else {
        throw new IllegalArgumentException("unknown presence option " + key);
      }
    }
    checkout = includes.isEmpty() ? Parts.checkoutRoot() : null;
    for (String root : sources.split(":")) roots.add(root);
    active = roots;
  }

  /** The source roots classes are resolved under in this JVM. */
  static List<String> roots() {
    return active;
  }

  public static void premain(String args, Instrumentation inst) {
    inst.addTransformer(new Agent(args));
    Presence.on = true;
    parts();
    RecordLocation.resolve();
  }

  /**
   * With a parts directory, from {@code -Dva.parts} or the
   * {@code VARIANCE_AUTHORITY_PARTS} a test runner hands the processes it starts,
   * the record is converted into {@link Parts} when the JVM exits. The record
   * then goes to a directory of this process's own unless {@code va.out} names
   * one, since two services converting one record would each claim the other's rows.
   */
  private static void parts() {
    String configured = System.getProperty("va.parts", System.getenv("VARIANCE_AUTHORITY_PARTS"));
    if (configured == null || configured.isEmpty()) return;
    java.nio.file.Path directory = java.nio.file.Paths.get(configured).toAbsolutePath();
    if (System.getProperty("va.out") == null) {
      try {
        System.setProperty("va.out", java.nio.file.Files.createTempDirectory("variance-agent-").toString());
      } catch (java.io.IOException e) {
        throw new java.io.UncheckedIOException("presence could not make a directory for its record", e);
      }
    }
    java.nio.file.Path record = java.nio.file.Paths.get(System.getProperty("va.out"), "record.jsonl");
    Runtime.getRuntime().addShutdownHook(new Thread(() -> {
      try {
        Parts.write(record, directory);
      } catch (java.io.IOException | RuntimeException e) {
        System.err.println("presence: wrote no parts: " + e);
      }
    }, "variance-agent-parts"));
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
    if (loader == null || name == null || redefined != null || name.startsWith("dev/varianceauthority/jvm/")) return null;
    String dotted = name.replace('/', '.');
    if (checkout == null ? !declared(dotted) : !inCheckout(domain)) return null;
    try {
      return instrument(bytes);
    } catch (RuntimeException | LinkageError e) {
      Presence.fail(name);
      System.err.println("presence: left " + dotted + " uninstrumented: " + e);
      return null;
    }
  }

  private boolean declared(String dotted) {
    for (Pattern p : includes) {
      if (p.matcher(dotted).matches()) return true;
    }
    return false;
  }

  /**
   * Whether a class loaded from inside the checkout. A location that is there
   * but cannot be read as a path counts as the checkout's, so its entries mark
   * rows rather than vanish.
   */
  private boolean inCheckout(ProtectionDomain domain) {
    CodeSource source = domain == null ? null : domain.getCodeSource();
    if (source == null || source.getLocation() == null) return false;
    try {
      return Paths.get(source.getLocation().toURI()).toAbsolutePath().normalize().startsWith(checkout);
    } catch (URISyntaxException | RuntimeException e) {
      return true;
    }
  }

  private byte[] instrument(byte[] bytes) {
    ClassNode cn = new ClassNode();
    new ClassReader(bytes).accept(cn, 0);
    if ((cn.access & Opcodes.ACC_MODULE) != 0 || cn.sourceFile == null) return null;
    int slash = cn.name.lastIndexOf('/');
    String dir = slash < 0 ? "" : cn.name.substring(0, slash + 1);
    String file = resolve(dir, cn.sourceFile);
    int unknown = -1;
    if (file == null || file.equals(AMBIGUOUS)) {
      unknown = Presence.register("{\"unknown\":" + quote(cn.name) + "}");
      file = null;
    }
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
        index = Presence.register(meta(Parts.name(prefix, file), cn.name, m.name + m.desc, lines));
      }
      InsnList probe = new InsnList();
      probe.add(new FieldInsnNode(Opcodes.GETSTATIC, "dev/varianceauthority/jvm/rt/Presence", "P", "[Z"));
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
    String file = found.size() == 1 ? found.get(0) : found.isEmpty() ? null : AMBIGUOUS;
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

  static String quote(String s) {
    return "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
  }
}
