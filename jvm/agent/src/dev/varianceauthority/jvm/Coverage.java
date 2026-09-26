package dev.varianceauthority.jvm;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.charset.StandardCharsets;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;

/**
 * Writes a presence record as sense's execution record, the snapshot its selector reads.
 *
 * Each source file is a module whose root spans the whole file,
 * with one {@code function} region per method a test entered, so the record reads as
 * JS {@code entries} coverage does. A region spans the method's source, signature to
 * closing brace, where javac can parse the file, and its line table otherwise. Which
 * methods are regions comes from the bytecode, not from a walk of the source:
 * <ul>
 * <li>a lambda body is not a region: it marks the method whose span holds its
 * first line, because a single-line lambda shares that line with the code around it;
 * <li>a method whose line table shares a line with the method whose span holds it
 * (an anonymous class written on one line) marks that method, for the same reason;
 * <li>constructors and static initializers mark the root: their line tables carry
 * field initializers from anywhere in the class;
 * <li>every method no test entered lies outside all regions, and a region's first and
 * last lines are shared with the region around it, so a change to a signature or a
 * closing brace charges every test that entered the file.
 * </ul>
 * Entering a region marks its owners up to the root. A row that lists an unknown
 * or failed class is written incomplete, so its absences justify no skip.
 *
 * The listener writes it beside {@code record.jsonl} when the plan finishes; the
 * {@code main} writes it for a record already on disk. A row names its files
 * relative to the checkout, as the agent registered them, so a module's record
 * matches a diff taken at its root and a JVM in one module can merge another's.
 * Their texts are read from the checkout, which must be at the commit the record
 * was made at. A driver's journey subjects are read from the working directory
 * and written as the table spells them.
 *
 * The bytes are sense's snapshot format 8 with every column and set stored
 * uncompressed, which its reader accepts: a run is compressed only when that pays,
 * and not compressing is always a valid choice.
 */
public final class Coverage {
  private static final int FORMAT = 8;
  private static final int MODEL = 3;
  private static final String INSTRUMENTATION = "sense:instrument/entries-v2";
  private static final int NO_OWNER = 0xffffffff;
  private static final int KIND_MODULE = 0;
  private static final int KIND_FUNCTION = 1;

  private Coverage() {}

  /**
   * Usage: Coverage &lt;record.jsonl&gt; &lt;out&gt; [commit] [source roots, colon separated]
   * [journeys.tsv]. The last is a driver's table, one {@code <journey>\t<subject file>}
   * per line, and makes the record a service's.
   */
  public static void main(String[] args) throws IOException {
    if (args.length < 2) {
      throw new IllegalArgumentException("usage: Coverage <record.jsonl> <out> [commit] [sources] [journeys.tsv]");
    }
    String commit = args.length > 2 && !args[2].isEmpty() ? args[2] : null;
    List<String> roots = Arrays.asList((args.length > 3 && !args[3].isEmpty() ? args[3] : Agent.DEFAULT_SOURCES).split(":"));
    Map<String, String> journeys = null;
    if (args.length > 4) {
      journeys = new HashMap<>();
      for (String line : Files.readAllLines(Paths.get(args[4]), StandardCharsets.UTF_8)) {
        int tab = line.indexOf('\t');
        if (tab > 0) journeys.put(line.substring(0, tab), line.substring(tab + 1));
      }
    }
    write(Paths.get(args[0]), Paths.get(args[1]), commit, roots, journeys);
  }

  /**
   * Called by the listener when this JVM's plan finishes: seals {@code own}, this
   * JVM's record under {@code <out>/records}, then writes {@code record.jsonl} and
   * the snapshot from every sealed record there: {@code coverage.va} in a
   * {@code va.out} the caller named, and the layer's record otherwise, as
   * {@link RecordLocation} places it.
   *
   * A seal is a last line naming the text of every file the record's rows read,
   * as this JVM saw it. A record whose texts still hold is current, and for each
   * test class the newest current record's row wins, so a rerun replaces what it
   * reran and keeps what it did not. A record whose texts moved is deleted: its
   * rows describe code that is gone. So is one that no test class reads from any
   * longer. A record with no seal is a JVM still running, or one that died; it is
   * left alone, and a running one merges everything when its own plan ends.
   *
   * Forks that share {@code out} merge under a lock on {@code <out>/.lock}, and
   * the last to finish writes the whole record. One that finishes while another
   * still runs writes what has finished, and a class missing from a record runs.
   */
  public static void finish(Path own, Path out) throws IOException {
    List<String> roots = Agent.roots();
    seal(own, roots);
    try (FileChannel channel = FileChannel.open(out.resolve(".lock"), StandardOpenOption.CREATE, StandardOpenOption.WRITE);
        FileLock held = channel.lock()) {
      List<Sealed> sealed = new ArrayList<>();
      try (DirectoryStream<Path> records = Files.newDirectoryStream(own.getParent(), "*.jsonl")) {
        for (Path file : records) {
          Sealed record = Sealed.read(file);
          if (record == null) continue;
          if (record.current()) sealed.add(record);
          else Files.delete(file);
        }
      }
      sealed.sort(Comparator.comparingLong((Sealed s) -> s.end).thenComparing(s -> s.file.getFileName().toString()));
      Map<String, Sealed> newest = new HashMap<>();
      for (Sealed record : sealed) for (String owner : record.owners()) newest.put(owner, record);
      StringBuilder merged = new StringBuilder();
      for (Sealed record : sealed) {
        StringBuilder kept = new StringBuilder();
        boolean reads = false;
        for (int i = 0; i < record.lines.size(); i++) {
          String owner = (String) record.rows.get(i).get("owner");
          boolean between = owner.startsWith("between");
          if (!between && newest.get(owner) != record) continue;
          reads |= !between;
          kept.append(record.lines.get(i)).append('\n');
        }
        if (reads || record.file.equals(own)) merged.append(kept);
        else Files.delete(record.file);
      }
      Path record = out.resolve("record.jsonl");
      Path temporary = record.resolveSibling("record.jsonl.tmp");
      Files.write(temporary, merged.toString().getBytes(StandardCharsets.UTF_8));
      Files.move(temporary, record, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
      write(record, RecordLocation.snapshot(out), System.getProperty("va.commit"), roots);
    }
  }

  /** Whether a JVM's record carries its seal, so the JVM that wrote it has finished. */
  static boolean sealed(Path file) throws IOException {
    return Sealed.read(file) != null;
  }

  /** Appends the seal: when this JVM finished, and the digest of every file its rows read. */
  private static void seal(Path own, List<String> roots) throws IOException {
    TreeSet<String> files = new TreeSet<>();
    StringBuilder sealed = new StringBuilder();
    String prefix = Parts.checkoutPrefix();
    if (Files.isRegularFile(own)) {
      for (String line : Files.readAllLines(own, StandardCharsets.UTF_8)) {
        if (line.isEmpty()) continue;
        Map<String, Object> row = Json.object(line);
        String owner = (String) row.get("owner");
        if (!owner.startsWith("between")) {
          // The test class's file is found under this JVM's roots, and a JVM
          // in another module could not find it: the row carries it.
          String test = Parts.name(prefix, testFile(owner, roots));
          line = "{\"test\":" + Agent.quote(test) + "," + line.substring(1);
          files.add(test);
        }
        for (Object o : (List<?>) row.get("methods")) files.add((String) ((Map<?, ?>) o).get("file"));
        sealed.append(line).append('\n');
      }
    }
    sealed.append("{\"end\":").append(System.currentTimeMillis()).append(",\"texts\":{");
    boolean first = true;
    for (String file : files) {
      String text = source(file);
      sealed.append(first ? "" : ",").append(Agent.quote(file)).append(':').append(Agent.quote(text == null ? "" : digest(text)));
      first = false;
    }
    sealed.append("}}\n");
    Path temporary = own.resolveSibling(own.getFileName() + ".tmp");
    Files.write(temporary, sealed.toString().getBytes(StandardCharsets.UTF_8));
    Files.move(temporary, own, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
  }

  /** One JVM's record that carries its seal. */
  private static final class Sealed {
    final Path file;
    final long end;
    final Map<?, ?> texts;
    final List<String> lines = new ArrayList<>();
    final List<Map<String, Object>> rows = new ArrayList<>();

    private Sealed(Path file, long end, Map<?, ?> texts) {
      this.file = file;
      this.end = end;
      this.texts = texts;
    }

    /** The record, or null when its last line is not a seal. */
    static Sealed read(Path file) throws IOException {
      List<String> lines = new ArrayList<>();
      for (String line : Files.readAllLines(file, StandardCharsets.UTF_8)) if (!line.isEmpty()) lines.add(line);
      if (lines.isEmpty()) return null;
      Map<String, Object> last = Json.object(lines.get(lines.size() - 1));
      if (!last.containsKey("end")) return null;
      Sealed record = new Sealed(file, ((Number) last.get("end")).longValue(), (Map<?, ?>) last.get("texts"));
      for (String line : lines.subList(0, lines.size() - 1)) {
        record.lines.add(line);
        record.rows.add(Json.object(line));
      }
      return record;
    }

    /** Whether every file the rows read still has the text it had. */
    boolean current() throws IOException {
      for (Map.Entry<?, ?> e : texts.entrySet()) {
        String text = source((String) e.getKey());
        if (text == null || !digest(text).equals(e.getValue())) return false;
      }
      return true;
    }

    List<String> owners() {
      List<String> out = new ArrayList<>();
      for (Map<String, Object> row : rows) {
        String owner = (String) row.get("owner");
        if (!owner.startsWith("between")) out.add(owner);
      }
      return out;
    }
  }

  static void write(Path record, Path out, String commit, List<String> roots) throws IOException {
    write(record, out, commit, roots, null);
  }

  static void write(Path record, Path out, String commit, List<String> roots, Map<String, String> journeys)
      throws IOException {
    List<Map<String, Object>> rows = new ArrayList<>();
    for (String line : Files.readAllLines(record, StandardCharsets.UTF_8)) {
      if (!line.isEmpty()) rows.add(Json.object(line));
    }
    byte[] bytes = encode(model(rows, commit, roots, journeys));
    Path temporary = out.resolveSibling(out.getFileName() + ".tmp");
    Files.write(temporary, bytes);
    Files.move(temporary, out, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
  }

  // ---------------------------------------------------------------- model

  static final class Test {
    final String file;
    final boolean complete;
    final String digest;

    Test(String file, boolean complete, String digest) {
      this.file = file;
      this.complete = complete;
      this.digest = digest;
    }
  }

  static final class Method {
    final String cls;
    final String method;
    int first;
    int last;
    final int[] lines;
    final TreeSet<String> tests = new TreeSet<>();

    Method(Map<String, Object> m) {
      cls = (String) m.get("class");
      method = (String) m.get("method");
      first = ((Number) m.get("first")).intValue();
      last = ((Number) m.get("last")).intValue();
      List<?> ls = (List<?>) m.get("lines");
      lines = new int[ls.size()];
      for (int i = 0; i < lines.length; i++) lines[i] = ((Number) ls.get(i)).intValue();
    }

    int width() {
      return last - first;
    }

    boolean contains(Method o) {
      return first <= o.first && o.last <= last;
    }

    boolean rooted() {
      return lines.length == 0 || method.startsWith("<init>") || method.startsWith("<clinit>");
    }

    /** The name as the source spells it, without the descriptor. */
    String name() {
      int paren = method.indexOf('(');
      return paren < 0 ? method : method.substring(0, paren);
    }

    boolean lambda() {
      return method.startsWith("lambda$");
    }

    boolean shares(Method o) {
      for (int a : lines) for (int b : o.lines) if (a == b) return true;
      return false;
    }
  }

  static final class Block {
    int ordinal;
    int kind;
    int owner = NO_OWNER;
    String digest;
    String name;
    String path;
    int start;
    int end;
    List<String> tests;
  }

  static final class Module {
    final String file;
    final String sourceDigest;
    final List<Block> blocks;

    Module(String file, String sourceDigest, List<Block> blocks) {
      this.file = file;
      this.sourceDigest = sourceDigest;
      this.blocks = blocks;
    }
  }

  static final class Model {
    String commit;
    final List<Test> tests = new ArrayList<>();
    final List<Module> modules = new ArrayList<>();
  }

  static Model model(List<Map<String, Object>> rows, String commit, List<String> roots) throws IOException {
    return model(rows, commit, roots, null);
  }

  /**
   * With {@code journeys}, the driver's table of which subject each journey was, the
   * rows are a service's: {@code journey:<id>} rows belong to that subject, and an
   * unattributed window belongs to every subject the table names, since the service
   * cannot say whose it was. Without it, each row is a test class of this JVM.
   */
  static Model model(List<Map<String, Object>> rows, String commit, List<String> roots, Map<String, String> journeys)
      throws IOException {
    Model model = new Model();
    model.commit = commit;
    // Named as the checkout names them, as a diff at its root does. A row's
    // files are already; a test class found under this JVM's roots is named here.
    String prefix = Parts.checkoutPrefix();
    Set<String> named = new HashSet<>();
    Map<String, Test> tests = new TreeMap<>();
    Map<String, Map<String, Method>> byFile = new TreeMap<>();
    List<String> everyone = new ArrayList<>();
    if (journeys != null) {
      for (String subject : new TreeSet<>(journeys.values())) {
        String text = text(subject);
        tests.put(subject, new Test(subject, true, text == null ? null : digest(text)));
        everyone.add(subject);
      }
    }
    int claimed = 0;
    int unclaimed = 0;
    for (Map<String, Object> row : rows) {
      String owner = (String) row.get("owner");
      List<String> files;
      if (journeys == null) {
        if (owner.startsWith("between")) continue;
        String test = row.containsKey("test") ? (String) row.get("test") : Parts.name(prefix, testFile(owner, roots));
        named.add(test);
        files = Collections.singletonList(test);
      } else if (owner.startsWith("journey:")) {
        String subject = journeys.get(owner.substring("journey:".length()));
        if (subject == null) {
          unclaimed++;
          continue;
        }
        claimed++;
        files = Collections.singletonList(subject);
      } else {
        files = everyone;
      }
      List<?> unknown = (List<?>) row.get("unknown");
      for (String file : files) {
        Test prior = tests.get(file);
        boolean complete = (unknown == null || unknown.isEmpty()) && (prior == null || prior.complete);
        String digest = prior != null ? prior.digest : null;
        if (prior == null) {
          String text = named.contains(file) ? source(file) : text(file);
          digest = text == null ? null : digest(text);
        }
        tests.put(file, new Test(file, complete, digest));
      }
      for (Object o : (List<?>) row.get("methods")) {
        @SuppressWarnings("unchecked")
        Map<String, Object> m = (Map<String, Object>) o;
        Map<String, Method> methods = byFile.computeIfAbsent((String) m.get("file"), k -> new LinkedHashMap<>());
        String key = m.get("class") + "." + m.get("method");
        methods.computeIfAbsent(key, k -> new Method(m)).tests.addAll(files);
      }
    }
    if (journeys != null && !journeys.isEmpty() && claimed == 0) {
      throw new IOException("the service recorded none of the " + journeys.size()
          + " journeys the driver minted: a service that was not watched cannot be told from one that ran nothing");
    }
    if (unclaimed > 0) System.err.println("presence: " + unclaimed + " journey rows no subject claimed: traffic the driver did not mint");
    model.tests.addAll(tests.values());
    for (Map.Entry<String, Map<String, Method>> e : byFile.entrySet()) {
      String text = source(e.getKey());
      if (text == null) throw new IOException("recorded file " + e.getKey() + " is not in the checkout");
      model.modules.add(module(e.getKey(), text, new ArrayList<>(e.getValue().values())));
    }
    return model;
  }

  /** The test class's source under the roots, or its conventional path when none exists. */
  private static String testFile(String owner, List<String> roots) {
    String base = owner.replace('.', '/');
    for (String root : roots) {
      for (String ext : new String[] {".java", ".kt"}) {
        String path = root + "/" + base + ext;
        if (new File(path).isFile()) return path;
      }
    }
    return "src/test/java/" + base + ".java";
  }

  private static volatile Path checkout;

  /** The text of a file as the checkout names it, whichever module this JVM runs in; null when there is none. */
  static String source(String named) throws IOException {
    Path root = checkout;
    if (root == null) checkout = root = Parts.checkoutRoot();
    return text(root.resolve(named).toString());
  }

  static String text(String file) throws IOException {
    Path p = Paths.get(file);
    return Files.isRegularFile(p) ? new String(Files.readAllBytes(p), StandardCharsets.UTF_8) : null;
  }

  static Module module(String file, String text, List<Method> all) {
    String[] lines = text.split("\n", -1);
    List<Spans.Span> spans;
    try {
      spans = Spans.of(file, text);
    } catch (LinkageError e) {
      // A Java 8 runtime without tools.jar: the line tables stand.
      spans = Collections.emptyList();
    }
    for (Method m : all) {
      if (m.rooted() || m.lambda()) continue;
      Spans.Span s = Spans.around(spans, m.name(), m.first, m.last);
      if (s != null) {
        m.first = s.first;
        m.last = s.last;
      }
    }
    // Widest first, so a method is compared with every region that could hold it.
    List<Method> candidates = new ArrayList<>();
    for (Method m : all) if (!m.rooted() && !m.lambda()) candidates.add(m);
    candidates.sort(Comparator.comparingInt(Method::width).reversed().thenComparingInt(m -> m.first));
    List<Method> regions = new ArrayList<>();
    Map<Method, Method> target = new IdentityHashMap<>();
    for (Method m : candidates) {
      Method parent = innermost(regions, m, m.first, m.last);
      if (parent != null && m.shares(parent)) target.put(m, parent);
      else regions.add(m);
    }
    for (Method m : all) {
      if (target.containsKey(m) || regions.contains(m)) continue;
      target.put(m, m.rooted() ? null : innermost(regions, null, m.first, m.first));
    }

    // Pre-order: by first line, the wider region first.
    regions.sort(Comparator.comparingInt((Method m) -> m.first).thenComparing(Comparator.comparingInt((Method m) -> m.last).reversed()));
    Map<Method, Integer> ordinal = new IdentityHashMap<>();
    Map<Method, Method> owner = new IdentityHashMap<>();
    Map<Method, TreeSet<String>> entered = new IdentityHashMap<>();
    for (int i = 0; i < regions.size(); i++) {
      Method r = regions.get(i);
      ordinal.put(r, i + 1);
      owner.put(r, innermost(regions, r, r.first, r.last));
      entered.put(r, new TreeSet<>());
    }
    TreeSet<String> root = new TreeSet<>();
    for (Method m : all) {
      for (Method r = ordinal.containsKey(m) ? m : target.get(m); r != null; r = owner.get(r)) entered.get(r).addAll(m.tests);
      root.addAll(m.tests);
    }

    List<Block> blocks = new ArrayList<>();
    Block b = new Block();
    b.ordinal = 0;
    b.kind = KIND_MODULE;
    b.digest = digest("module\0" + text);
    b.name = "";
    b.path = "module";
    b.start = 1;
    b.end = lines.length;
    b.tests = new ArrayList<>(root);
    blocks.add(b);
    for (Method r : regions) {
      Method parent = owner.get(r);
      b = new Block();
      b.ordinal = ordinal.get(r);
      b.kind = KIND_FUNCTION;
      b.owner = parent == null ? 0 : ordinal.get(parent);
      b.digest = digest("function\0" + String.join("\n", Arrays.asList(lines).subList(r.first - 1, Math.min(r.last, lines.length))));
      b.name = r.cls.substring(r.cls.lastIndexOf('/') + 1).replace('$', '/') + "/" + r.method;
      b.path = "entry";
      b.start = r.first;
      b.end = r.last;
      b.tests = new ArrayList<>(entered.get(r));
      blocks.add(b);
    }
    return new Module(file, digest(text), blocks);
  }

  /** The narrowest region, other than {@code self}, whose span holds first..last. */
  private static Method innermost(List<Method> regions, Method self, int first, int last) {
    Method best = null;
    for (Method r : regions) {
      if (r == self || r.first > first || last > r.last) continue;
      if (best == null || r.width() < best.width()) best = r;
    }
    return best;
  }

  /** sense's digest: {@code v1:} and the first 32 hex digits of the text's SHA-256. */
  static String digest(String text) {
    try {
      byte[] h = MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8));
      StringBuilder s = new StringBuilder("v1:");
      for (int i = 0; i < 16; i++) s.append(String.format("%02x", h[i] & 0xff));
      return s.toString();
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
  }

  // ---------------------------------------------------------------- snapshot

  static byte[] encode(Model model) {
    model.tests.sort(Comparator.comparing(t -> t.file));
    model.modules.sort(Comparator.comparing(m -> m.file));
    TreeSet<String> dictionary = new TreeSet<>();
    dictionary.add(INSTRUMENTATION);
    if (model.commit != null) dictionary.add(model.commit);
    for (Test t : model.tests) {
      dictionary.add(t.file);
      if (t.digest != null) dictionary.add(t.digest);
    }
    for (Module m : model.modules) {
      dictionary.add(m.file);
      dictionary.add(m.sourceDigest);
      for (Block b : m.blocks) {
        dictionary.add(b.name);
        dictionary.add(b.path);
        dictionary.add(b.digest);
      }
    }
    List<String> strings = new ArrayList<>(dictionary);
    Map<String, Integer> id = new HashMap<>();
    for (int i = 0; i < strings.size(); i++) id.put(strings.get(i), i);

    ByteArrayOutputStream blob = new ByteArrayOutputStream();
    int[] stringOffsets = new int[strings.size() + 1];
    for (int i = 0; i < strings.size(); i++) {
      stringOffsets[i] = blob.size();
      byte[] bytes = strings.get(i).getBytes(StandardCharsets.UTF_8);
      blob.write(bytes, 0, bytes.length);
    }
    stringOffsets[strings.size()] = blob.size();

    int tests = model.tests.size();
    Map<String, Integer> testId = new HashMap<>();
    int[] testPath = new int[tests];
    byte[] testComplete = new byte[tests];
    int[] testPreconditions = new int[tests + 1];
    List<Integer> preconditionName = new ArrayList<>();
    List<Integer> preconditionDigest = new ArrayList<>();
    for (int i = 0; i < tests; i++) {
      Test t = model.tests.get(i);
      testId.put(t.file, i);
      testPath[i] = id.get(t.file);
      testComplete[i] = (byte) (t.complete ? 1 : 0);
      testPreconditions[i] = preconditionName.size();
      if (t.digest != null) {
        preconditionName.add(id.get(t.file));
        preconditionDigest.add(id.get(t.digest));
      }
    }
    testPreconditions[tests] = preconditionName.size();

    int modules = model.modules.size();
    int blockCount = 0;
    for (Module m : model.modules) blockCount += m.blocks.size();
    int[] modulePath = new int[modules];
    int[] moduleSource = new int[modules];
    byte[] moduleInstrumented = new byte[modules];
    int[] moduleBlocks = new int[modules + 1];
    int[] ordinal = new int[blockCount];
    byte[] kind = new byte[blockCount];
    int[] owner = new int[blockCount];
    int[] digest = new int[blockCount];
    int[] name = new int[blockCount];
    int[] path = new int[blockCount];
    int[] start = new int[blockCount];
    int[] end = new int[blockCount];
    byte[] source = new byte[blockCount];
    int[] set = new int[blockCount];
    int[] loadedSet = new int[blockCount];
    Sets sets = new Sets(tests);
    int empty = sets.intern(new int[0]);
    int k = 0;
    for (int i = 0; i < modules; i++) {
      Module m = model.modules.get(i);
      modulePath[i] = id.get(m.file);
      moduleSource[i] = id.get(m.sourceDigest);
      moduleInstrumented[i] = 1;
      moduleBlocks[i] = k;
      for (Block b : m.blocks) {
        ordinal[k] = b.ordinal;
        kind[k] = (byte) b.kind;
        owner[k] = b.owner;
        digest[k] = id.get(b.digest);
        name[k] = id.get(b.name);
        path[k] = id.get(b.path);
        start[k] = b.start;
        end[k] = b.end;
        source[k] = 1;
        int[] members = new int[b.tests.size()];
        for (int j = 0; j < members.length; j++) {
          Integer t = testId.get(b.tests.get(j));
          if (t == null) throw new IllegalStateException("coverage crossing names an unobserved test: " + b.tests.get(j));
          members[j] = t;
        }
        set[k] = sets.intern(members);
        loadedSet[k] = empty;
        k++;
      }
    }
    moduleBlocks[modules] = k;

    Sections out = new Sections();
    out.add("strings.blob", blob.toByteArray(), 1);
    out.words("strings.off", stringOffsets);
    out.words("snapshot.instrumentation", new int[] {id.get(INSTRUMENTATION)});
    out.words("snapshot.commit", model.commit == null ? new int[0] : new int[] {id.get(model.commit)});
    out.words("tests.path", testPath);
    out.add("tests.complete", testComplete, 1);
    out.words("tests.preconditions", testPreconditions);
    out.words("preconditions.name", ints(preconditionName));
    out.words("preconditions.digest", ints(preconditionDigest));
    out.words("modules.path", modulePath);
    out.words("modules.source", moduleSource);
    out.add("modules.instrumented", moduleInstrumented, 1);
    out.words("modules.blocks", moduleBlocks);
    out.words("blocks.ordinal", ordinal);
    out.add("blocks.kind", kind, 1);
    out.words("blocks.owner", owner);
    out.words("blocks.digest", digest);
    out.words("blocks.name", name);
    out.words("blocks.path", path);
    out.words("blocks.start", start);
    out.words("blocks.end", end);
    out.add("blocks.source", source, 1);
    out.words("blocks.set", set);
    out.words("blocks.loadedSet", loadedSet);
    out.add("sets.blob", sets.bytes(), 1);
    out.words("sets.off", sets.offsets());
    return out.bytes();
  }

  private static int[] ints(List<Integer> values) {
    int[] out = new int[values.size()];
    for (int i = 0; i < out.length; i++) out[i] = values.get(i);
    return out;
  }

  /** Sections laid 8-byte aligned behind a length-prefixed JSON index. */
  static final class Sections {
    private final ByteArrayOutputStream body = new ByteArrayOutputStream();
    private final StringBuilder index = new StringBuilder();

    void words(String name, int[] values) {
      ByteBuffer b = ByteBuffer.allocate(values.length * 4).order(ByteOrder.LITTLE_ENDIAN);
      for (int v : values) b.putInt(v);
      add(name, b.array(), 4);
    }

    void add(String name, byte[] bytes, int width) {
      index.append(index.length() == 0 ? "" : ",")
          .append("{\"name\":\"").append(name).append("\",\"offset\":").append(body.size())
          .append(",\"length\":").append(bytes.length).append(",\"width\":").append(width).append('}');
      body.write(bytes, 0, bytes.length);
      while (body.size() % 8 != 0) body.write(0);
    }

    byte[] bytes() {
      byte[] header = ("{\"version\":" + FORMAT + ",\"sections\":[" + index + "]}").getBytes(StandardCharsets.UTF_8);
      int headerLength = (4 + header.length + 7) / 8 * 8 - 4;
      ByteBuffer out = ByteBuffer.allocate(4 + headerLength + body.size()).order(ByteOrder.LITTLE_ENDIAN);
      out.putInt(headerLength);
      out.put(header);
      out.position(4 + headerLength);
      out.put(body.toByteArray());
      return out.array();
    }
  }

  /**
   * Interned test sets, each in the smallest of sense's three containers: a list of
   * ids, a bitmap over every test, or runs of consecutive ids. Ids are two bytes
   * below 65,536 tests and four above.
   */
  static final class Sets {
    private static final int LIST = 0;
    private static final int BITS = 1;
    private static final int RUNS = 2;
    private final int testCount;
    private final int width;
    private final ByteArrayOutputStream arena = new ByteArrayOutputStream();
    private final List<Integer> offsets = new ArrayList<>(Collections.singletonList(0));
    private final Map<String, Integer> ids = new HashMap<>();

    Sets(int testCount) {
      this.testCount = testCount;
      this.width = testCount < 0x10000 ? 2 : 4;
    }

    int intern(int[] members) {
      int[] sorted = Arrays.stream(members).sorted().distinct().toArray();
      byte[] bytes = container(sorted);
      String key = new String(bytes, StandardCharsets.ISO_8859_1);
      Integer found = ids.get(key);
      if (found != null) return found;
      int id = offsets.size() - 1;
      arena.write(bytes, 0, bytes.length);
      offsets.add(arena.size());
      ids.put(key, id);
      return id;
    }

    private byte[] container(int[] m) {
      int runs = 0;
      for (int i = 0; i < m.length; i++) if (i == 0 || m[i] != m[i - 1] + 1) runs++;
      int list = 1 + m.length * width;
      int bits = 1 + (((testCount + 31) >>> 5) << 2);
      int run = 1 + runs * 2 * width;
      int smallest = Math.min(list, Math.min(bits, run));
      ByteBuffer out = ByteBuffer.allocate(smallest).order(ByteOrder.LITTLE_ENDIAN);
      if (smallest == bits) {
        out.put((byte) BITS);
        for (int t : m) {
          int at = 1 + ((t >>> 5) << 2);
          out.putInt(at, out.getInt(at) | (1 << (t & 31)));
        }
      } else if (smallest == run) {
        out.put((byte) RUNS);
        for (int i = 0; i < m.length;) {
          int j = i + 1;
          while (j < m.length && m[j] == m[j - 1] + 1) j++;
          put(out, m[i]);
          put(out, j - i);
          i = j;
        }
      } else {
        out.put((byte) LIST);
        for (int t : m) put(out, t);
      }
      return out.array();
    }

    private void put(ByteBuffer out, int v) {
      if (width == 2) out.putShort((short) v);
      else out.putInt(v);
    }

    byte[] bytes() {
      return arena.toByteArray();
    }

    int[] offsets() {
      return ints(offsets);
    }
  }

  /**
   * Just enough JSON for the record's own rows and the root config: objects,
   * arrays, strings, numbers, the literals, and whitespace between tokens.
   */
  static final class Json {
    private final String s;
    private int at;

    private Json(String s) {
      this.s = s;
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> object(String line) {
      return (Map<String, Object>) new Json(line).value();
    }

    /** A whole document: one value and nothing after it. */
    static Object parse(String text) {
      Json json = new Json(text);
      Object value = json.value();
      json.space();
      if (json.at != text.length()) throw new IllegalArgumentException("unexpected '" + text.charAt(json.at) + "' at " + json.at);
      return value;
    }

    private void space() {
      while (at < s.length() && Character.isWhitespace(s.charAt(at))) at++;
    }

    private char next() {
      space();
      if (at >= s.length()) throw new IllegalArgumentException("unexpected end at " + at);
      return s.charAt(at);
    }

    private void expect(char c) {
      if (next() != c) throw new IllegalArgumentException("expected '" + c + "' at " + at);
      at++;
    }

    private Object value() {
      char c = next();
      if (c == '{') {
        Map<String, Object> out = new LinkedHashMap<>();
        at++;
        if (next() == '}') {
          at++;
          return out;
        }
        for (;;) {
          if (next() != '"') throw new IllegalArgumentException("expected a key at " + at);
          String key = string();
          expect(':');
          out.put(key, value());
          char end = next();
          at++;
          if (end == '}') return out;
          if (end != ',') throw new IllegalArgumentException("expected ',' or '}' at " + (at - 1));
        }
      }
      if (c == '[') {
        List<Object> out = new ArrayList<>();
        at++;
        if (next() == ']') {
          at++;
          return out;
        }
        for (;;) {
          out.add(value());
          char end = next();
          at++;
          if (end == ']') return out;
          if (end != ',') throw new IllegalArgumentException("expected ',' or ']' at " + (at - 1));
        }
      }
      if (c == '"') return string();
      for (String literal : new String[] {"true", "false", "null"}) {
        if (s.startsWith(literal, at)) {
          at += literal.length();
          return literal.equals("null") ? null : Boolean.valueOf(literal);
        }
      }
      int from = at;
      boolean integer = true;
      for (char d; at < s.length() && "-+.eE0123456789".indexOf(d = s.charAt(at)) >= 0; at++) {
        integer &= d == '-' || Character.isDigit(d);
      }
      if (from == at) throw new IllegalArgumentException("unexpected '" + c + "' at " + at);
      String number = s.substring(from, at);
      return integer ? (Object) Long.parseLong(number) : (Object) Double.parseDouble(number);
    }

    private String string() {
      StringBuilder out = new StringBuilder();
      at++;
      for (char c; (c = s.charAt(at++)) != '"';) {
        if (c != '\\') {
          out.append(c);
          continue;
        }
        char e = s.charAt(at++);
        if (e == 'u') {
          out.append((char) Integer.parseInt(s.substring(at, at + 4), 16));
          at += 4;
        } else {
          int escape = "nrtbf".indexOf(e);
          out.append(escape < 0 ? e : "\n\r\t\b\f".charAt(escape));
        }
      }
      return out.toString();
    }
  }
}
