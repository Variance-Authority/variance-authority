package va.presence;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.UUID;

/**
 * Writes a service's presence record as parts: what it ran, per journey, for a fold
 * on the far side of the fence to join to the cases that called it.
 *
 * Phase 0 harness. A Jest run that hands its cases' journeys to this service reads
 * two files from the parts directory it was given, and nothing else:
 * <ul>
 * <li>{@code jvm-<pid>-<uuid>.vac}: sense's part frames. A {@code journey:<id>} row
 * is a frame owned by that journey; a {@code between-journey-<n>} row, a window no
 * journey was open for, is a frame owned by no journey, which the fold charges to
 * every case that crossed into this process. Modules are named by path.
 * <li>{@code jvm-<pid>-<uuid>.rec}: the inventory those names resolve to, one record
 * per source file under the recipe {@value #RECIPE}, cut the way {@link Coverage}
 * cuts it: the file is the root, each method a journey entered is a region.
 * </ul>
 * Names are the checkout's: paths relative to the nearest directory above the
 * working directory that holds {@code .git}, so a service started from a
 * subdirectory names its files as the test runner does.
 *
 * Nothing is written as the service runs: the agent converts its record when the
 * JVM exits, and {@code main} converts one already on disk.
 */
public final class Parts {
  static final String RECIPE = "jvm:presence/methods-v1";
  private static final byte[] PART_MAGIC = {0x56, 0x41, 0x4a, 0x52, 0x4e, 0x00, 0x00, 0x02};
  private static final byte[] RECORD_MAGIC = {0x56, 0x41, 0x52, 0x45, 0x43, 0x00, 0x00, 0x01};
  private static final int NAMED = 1;
  private static final int UNNUMBERED = 0xffffffff;
  private static final int INSTRUMENTED = 1;
  private static final int RECORD_HEADER = 32;
  /** The owner key of a window no journey was open for. */
  private static final String NONE = "";

  private Parts() {}

  /** Usage: Parts &lt;record.jsonl&gt; &lt;parts directory&gt; */
  public static void main(String[] args) throws IOException {
    if (args.length != 2) throw new IllegalArgumentException("usage: Parts <record.jsonl> <parts directory>");
    write(Paths.get(args[0]), Paths.get(args[1]));
  }

  /** Converts {@code record} into one part file and its inventory; nothing when it holds no row. */
  public static void write(Path record, Path directory) throws IOException {
    if (!Files.isRegularFile(record)) return;
    List<Map<String, Object>> rows = new ArrayList<>();
    for (String line : Files.readAllLines(record, StandardCharsets.UTF_8)) {
      if (!line.isEmpty()) rows.add(Coverage.Json.object(line));
    }
    if (rows.isEmpty()) return;
    String prefix = checkoutPrefix();

    TreeSet<String> journeys = new TreeSet<>();
    Map<String, Map<String, Coverage.Method>> byFile = new TreeMap<>();
    int unresolved = 0;
    for (Map<String, Object> row : rows) {
      String owner = (String) row.get("owner");
      String journey = owner.startsWith("journey:") ? owner.substring("journey:".length()) : NONE;
      journeys.add(journey);
      List<?> unknown = (List<?>) row.get("unknown");
      // FIXME: a class that resolved to no source file is dropped here, so its row cannot mark its journey incomplete.
      if (unknown != null) unresolved += unknown.size();
      for (Object o : (List<?>) row.get("methods")) {
        @SuppressWarnings("unchecked")
        Map<String, Object> m = (Map<String, Object>) o;
        Map<String, Coverage.Method> methods = byFile.computeIfAbsent((String) m.get("file"), k -> new LinkedHashMap<>());
        methods.computeIfAbsent(m.get("class") + "." + m.get("method"), k -> new Coverage.Method(m)).tests.add(journey);
      }
    }
    if (unresolved > 0) System.err.println("presence: " + unresolved + " entries of classes with no source file are not in the parts");

    List<Coverage.Module> modules = new ArrayList<>();
    for (Map.Entry<String, Map<String, Coverage.Method>> e : byFile.entrySet()) {
      String text = Coverage.text(e.getKey());
      if (text == null) throw new IOException("recorded file " + e.getKey() + " is not in the checkout");
      Coverage.Module module = Coverage.module(e.getKey(), text, new ArrayList<>(e.getValue().values()));
      modules.add(new Coverage.Module(name(prefix, e.getKey()), module.sourceDigest, module.blocks));
    }

    ByteArrayOutputStream part = new ByteArrayOutputStream();
    for (String journey : journeys) {
      byte[] frame = frame(journey, modules);
      if (frame != null) {
        part.write(le(frame.length), 0, 4);
        part.write(frame, 0, frame.length);
      }
    }
    ByteArrayOutputStream inventory = new ByteArrayOutputStream();
    byte[] header = segmentHeader();
    inventory.write(header, 0, header.length);
    for (Coverage.Module module : modules) {
      byte[] framed = framed(record(module));
      inventory.write(framed, 0, framed.length);
    }

    Files.createDirectories(directory);
    String base = "jvm-" + pid() + "-" + UUID.randomUUID();
    // The inventory first: a fold that finds the frames finds what they name.
    publish(directory.resolve(base + ".rec"), inventory.toByteArray());
    publish(directory.resolve(base + ".vac"), part.toByteArray());
  }

  private static void publish(Path to, byte[] bytes) throws IOException {
    Path temporary = to.resolveSibling(to.getFileName() + ".tmp");
    Files.write(temporary, bytes);
    Files.move(temporary, to, java.nio.file.StandardCopyOption.ATOMIC_MOVE);
  }

  // ---------------------------------------------------------------- names

  /** The working directory relative to the checkout, with a trailing slash; empty at its root or outside one. */
  static String checkoutPrefix() {
    Path cwd = Paths.get("").toAbsolutePath().normalize();
    for (Path at = cwd; at != null; at = at.getParent()) {
      if (Files.exists(at.resolve(".git"))) {
        String relative = at.relativize(cwd).toString().replace(File.separatorChar, '/');
        return relative.isEmpty() ? "" : relative + "/";
      }
    }
    return "";
  }

  private static String name(String prefix, String file) {
    Path path = Paths.get(file);
    if (path.isAbsolute()) {
      Path cwd = Paths.get("").toAbsolutePath().normalize();
      return prefix + cwd.relativize(path.normalize()).toString().replace(File.separatorChar, '/');
    }
    return prefix + file.replace(File.separatorChar, '/');
  }

  // ---------------------------------------------------------------- part frames

  /** One journey's frame: every module it entered, by path, with the regions it entered. */
  private static byte[] frame(String journey, List<Coverage.Module> modules) {
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    out.write(PART_MAGIC, 0, PART_MAGIC.length);
    text(out, "\0\0\0" + journey);
    List<Coverage.Module> entered = new ArrayList<>();
    List<List<Integer>> hits = new ArrayList<>();
    for (Coverage.Module module : modules) {
      List<Integer> ordinals = new ArrayList<>();
      for (Coverage.Block block : module.blocks) if (block.tests.contains(journey)) ordinals.add(block.ordinal);
      if (ordinals.isEmpty()) continue;
      entered.add(module);
      hits.add(ordinals);
    }
    if (entered.isEmpty()) return null;
    number(out, entered.size());
    for (int i = 0; i < entered.size(); i++) {
      out.write(NAMED);
      text(out, entered.get(i).file);
      List<Integer> ordinals = hits.get(i);
      number(out, ordinals.size());
      int last = 0;
      for (int ordinal : ordinals) {
        number(out, ordinal - last);
        last = ordinal;
      }
      // Nothing entered while loading, and nothing loaded before the journey: a
      // service's startup is its own window, owned by no journey.
      number(out, 0);
      number(out, 0);
    }
    return out.toByteArray();
  }

  private static void number(ByteArrayOutputStream out, int value) {
    while ((value & ~0x7f) != 0) {
      out.write((value & 0x7f) | 0x80);
      value >>>= 7;
    }
    out.write(value);
  }

  private static void text(ByteArrayOutputStream out, String value) {
    byte[] bytes = value.getBytes(StandardCharsets.UTF_8);
    number(out, bytes.length);
    out.write(bytes, 0, bytes.length);
  }

  // ---------------------------------------------------------------- inventory

  private static byte[] segmentHeader() {
    byte[] recipe = RECIPE.getBytes(StandardCharsets.UTF_8);
    ByteBuffer out = ByteBuffer.allocate(align(RECORD_MAGIC.length + 4 + recipe.length, 8)).order(ByteOrder.LITTLE_ENDIAN);
    out.put(RECORD_MAGIC).putInt(recipe.length).put(recipe);
    return out.array();
  }

  private static byte[] framed(byte[] payload) {
    ByteBuffer out = ByteBuffer.allocate(8 + align(payload.length, 8)).order(ByteOrder.LITTLE_ENDIAN);
    out.putInt(payload.length).putInt(checksum(payload)).put(payload);
    return out.array();
  }

  /** sense's record layout: a header, the frame's own string dictionary, then one column per field. */
  private static byte[] record(Coverage.Module module) {
    Map<String, Integer> ids = new LinkedHashMap<>();
    ids.put(module.file, 0);
    List<Coverage.Block> blocks = module.blocks;
    int count = blocks.size();
    int[] names = new int[count];
    int[] paths = new int[count];
    for (int i = 0; i < count; i++) {
      names[i] = ids.computeIfAbsent(blocks.get(i).name, k -> ids.size());
      paths[i] = ids.computeIfAbsent(blocks.get(i).path, k -> ids.size());
    }
    List<byte[]> strings = new ArrayList<>();
    int dictionary = 4;
    for (String value : ids.keySet()) {
      byte[] bytes = value.getBytes(StandardCharsets.UTF_8);
      strings.add(bytes);
      dictionary += align(4 + bytes.length, 4);
    }
    int bits = (count + 7) >> 3;
    int columns = align(count, 4) + count * 4 * 5 + align(bits, 4) + count * 16;
    ByteBuffer out = ByteBuffer.allocate(RECORD_HEADER + dictionary + columns).order(ByteOrder.LITTLE_ENDIAN);
    out.putInt(UNNUMBERED).putInt(INSTRUMENTED).putInt(count).putInt(dictionary).put(digest(module.sourceDigest));
    out.putInt(strings.size());
    for (byte[] bytes : strings) {
      out.putInt(bytes.length).put(bytes);
      out.position(align(out.position(), 4));
    }
    for (Coverage.Block block : blocks) out.put((byte) block.kind);
    out.position(align(out.position(), 4));
    for (Coverage.Block block : blocks) out.putInt(block.owner);
    for (int i = 0; i < count; i++) out.putInt(names[i]);
    for (int i = 0; i < count; i++) out.putInt(paths[i]);
    for (Coverage.Block block : blocks) out.putInt(block.start);
    for (Coverage.Block block : blocks) out.putInt(block.end);
    byte[] source = new byte[align(bits, 4)];
    // Every region is a span of source lines.
    for (int i = 0; i < count; i++) source[i >> 3] |= (byte) (1 << (i & 7));
    out.put(source);
    for (Coverage.Block block : blocks) out.put(digest(block.digest));
    return out.array();
  }

  /** The sixteen bytes a {@code v1:} digest renders. */
  private static byte[] digest(String rendered) {
    String hex = rendered.substring(rendered.indexOf(':') + 1);
    byte[] out = new byte[16];
    for (int i = 0; i < 16; i++) out[i] = (byte) Integer.parseInt(hex.substring(i * 2, i * 2 + 2), 16);
    return out;
  }

  /** FNV-1a, as sense verifies a record where it decodes it. */
  private static int checksum(byte[] payload) {
    int hash = 0x811c9dc5;
    for (byte b : payload) hash = (hash ^ (b & 0xff)) * 16777619;
    return hash;
  }

  private static int align(int value, int to) {
    return (value + to - 1) & ~(to - 1);
  }

  private static byte[] le(int value) {
    return ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putInt(value).array();
  }

  private static String pid() {
    String name = java.lang.management.ManagementFactory.getRuntimeMXBean().getName();
    int at = name.indexOf('@');
    return at < 0 ? name : name.substring(0, at);
  }
}
