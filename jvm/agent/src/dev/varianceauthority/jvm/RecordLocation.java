package dev.varianceauthority.jvm;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Where a JVM's record goes: the directory {@code va.out} names, or the
 * checkout's cache layer, where sense's {@code record-location.ts} puts a Node
 * seam's.
 *
 * A caller that names {@code va.out} owns that directory. It is not a layer of
 * anything and is not checked against the root {@code variance.config.json}.
 * Without it, the record goes where {@code variance select} reads without
 * flags: {@code <layer>/coverage.bin} in a repository that declares no suites,
 * and {@code <layer>/suites/<va.suite>/coverage.bin} in one that does. A suite
 * the configuration does not declare, no suite once any is declared, and a
 * suite named while none is, each fail the JVM before a test runs, with the
 * refusal sense gives a Node seam. Naming both is refused too: both say where
 * the run records.
 *
 * The rows the JVMs merge from live beside the snapshot, in {@code .jvm}, which
 * a dot keeps apart from a record store's caller-chosen label. A worktree's
 * first run takes the sealed rows of the same directory under the base, as a
 * Node seam takes the base's snapshot, and the seal check drops those whose
 * files the worktree has changed.
 *
 * The layer is derived here the way {@code cache-layers.ts} derives it, and
 * {@code jvm/test/suite.mjs} holds the two to one answer.
 */
public final class RecordLocation {
  static final String CONFIG = "variance.config.json";
  private static final Pattern GITDIR = Pattern.compile("(?m)^gitdir:\\s*(.+?)\\s*$");
  private static final Pattern SUITE_NAME = Pattern.compile("[A-Za-z0-9][A-Za-z0-9._-]*");
  private static final List<String> KINDS = Arrays.asList("unit", "integration", "e2e", "visual");

  /** The rows' directory and the snapshot written from it, when this JVM resolved them from the layer. */
  private static volatile Path layerDirectory;
  private static volatile Path layerSnapshot;

  private RecordLocation() {}

  /**
   * Called from {@code premain}: with no {@code va.out}, sets it to the layer's
   * rows directory, so the listener and the journey store write where the
   * snapshot is made from.
   */
  static void resolve() {
    String out = System.getProperty("va.out");
    String suite = System.getProperty("va.suite");
    if (out != null) {
      if (suite != null) {
        throw new IllegalStateException("the suite \"" + suite + "\" and the directory " + out
            + " both say where this run records; name one");
      }
      return;
    }
    Path checkout = Parts.checkoutRoot();
    Path record = layers(checkout).top.resolve(recordPath(checkout, suite));
    Path rows = record.resolveSibling(".jvm");
    seed(checkout, record);
    layerDirectory = rows;
    layerSnapshot = record;
    System.setProperty("va.out", rows.toString());
  }

  /** The snapshot the rows in {@code out} are written to: the layer's record, or {@code coverage.va} beside them. */
  static Path snapshot(Path out) {
    Path directory = layerDirectory;
    return directory != null && directory.equals(out.toAbsolutePath().normalize())
        ? layerSnapshot
        : out.resolve("coverage.va");
  }

  /** Prints the record this JVM would write from its working directory: {@code java -cp variance-agent.jar ...RecordLocation}. */
  public static void main(String[] args) {
    Path checkout = Parts.checkoutRoot();
    System.out.println(layers(checkout).top.resolve(recordPath(checkout, System.getProperty("va.suite"))));
  }

  // ------------------------------------------------------------- the declaration

  /** The record's path inside a layer, checked against the declaration: {@code recordPath} in record-location.ts. */
  static String recordPath(Path checkout, String suite) {
    Path file = checkout.resolve(CONFIG);
    Map<String, Object> config = config(file);
    Object suites = config == null ? null : config.get("suites");
    if (suites == null) {
      if (suite == null) return "coverage.bin";
      throw new IllegalStateException("the suite \"" + suite + "\" is named, and "
          + (config == null ? "the root " + CONFIG : file) + " declares no suites; declare it there under \"suites\", with its kind");
    }
    List<String> declared = declared(suites, file);
    StringBuilder listed = new StringBuilder();
    for (String name : declared) listed.append(listed.length() == 0 ? "" : ", ").append('"').append(name).append('"');
    if (suite == null) {
      throw new IllegalStateException(file + " declares the suites " + listed + ", and none is named; name the suite this run is with -Dva.suite");
    }
    if (!declared.contains(suite)) {
      throw new IllegalStateException("the suite \"" + suite + "\" is not declared in " + file + ", which declares " + listed);
    }
    return "suites/" + suite + "/coverage.bin";
  }

  /** The names a {@code suites} value declares, sorted, under {@code parseSuites}' rules. */
  private static List<String> declared(Object suites, Path file) {
    if (!(suites instanceof Map)) {
      throw new IllegalStateException(file + ": \"suites\" must be an object from each suite's name to its kind");
    }
    List<String> names = new ArrayList<>();
    for (Map.Entry<?, ?> entry : ((Map<?, ?>) suites).entrySet()) {
      String name = (String) entry.getKey();
      Object value = entry.getValue();
      if (!SUITE_NAME.matcher(name).matches()) {
        throw new IllegalStateException(file + ": \"suites." + name + "\" is not a suite name: it names a directory in the cache, "
            + "so it is letters, digits, \".\", \"_\" and \"-\", and starts with a letter or a digit");
      }
      if (!(value instanceof Map) || ((Map<?, ?>) value).size() != 1 || !KINDS.contains(((Map<?, ?>) value).get("kind"))) {
        throw new IllegalStateException(file + ": \"suites." + name + "\" must be { \"kind\": \"unit\" | \"integration\" | \"e2e\" | \"visual\" }");
      }
      names.add(name);
    }
    if (names.isEmpty()) {
      throw new IllegalStateException(file + ": \"suites\" declares no suite; remove it, or name each suite the repository runs");
    }
    Collections.sort(names);
    return names;
  }

  /** The root config's object, or null when there is no file. A file that is not a JSON object sets nothing. */
  @SuppressWarnings("unchecked")
  private static Map<String, Object> config(Path file) {
    String text;
    try {
      text = new String(Files.readAllBytes(file), StandardCharsets.UTF_8);
    } catch (NoSuchFileException e) {
      return null;
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
    Object value;
    try {
      value = Coverage.Json.parse(text);
    } catch (RuntimeException e) {
      throw new IllegalStateException(file + " is not JSON, so the settings it holds cannot be read: " + e.getMessage(), e);
    }
    return value instanceof Map ? (Map<String, Object>) value : Collections.<String, Object>emptyMap();
  }

  // ------------------------------------------------------------------ the layers

  /** This checkout's own directory, and the repository's beneath it: {@code cacheLayers} in cache-layers.ts. */
  static final class Layers {
    final Path top;
    final Path base;

    Layers(Path top, Path base) {
      this.top = top;
      this.base = base;
    }
  }

  static Layers layers(Path here) {
    Path primary = primary(here);
    Path base = cacheRoot(primary).resolve("test-selection").resolve(key(primary));
    if (primary.equals(here)) return new Layers(base, base);
    Path own = cacheRoot(here).resolve("test-selection").resolve(key(primary));
    return new Layers(own.resolve(".work").resolve(key(here)), base);
  }

  /** {@code cacheRoot} of the root config, resolved against it; else {@code XDG_CACHE_HOME} when absolute, else {@code ~/.cache}. */
  private static Path cacheRoot(Path checkout) {
    Path file = checkout.resolve(CONFIG);
    Map<String, Object> config = config(file);
    Object named = config == null ? null : config.get("cacheRoot");
    if (named != null) {
      if (!(named instanceof String) || ((String) named).isEmpty()) {
        throw new IllegalStateException(file + ": \"cacheRoot\" must be a directory path, not " + named);
      }
      return checkout.resolve((String) named).normalize();
    }
    String xdg = System.getenv("XDG_CACHE_HOME");
    Path home = xdg != null && Paths.get(xdg).isAbsolute()
        ? Paths.get(xdg)
        : Paths.get(System.getProperty("user.home"), ".cache");
    return home.resolve("variance-authority").normalize();
  }

  /** The checkout a worktree was cut from, read from its {@code .git} file, or {@code here}. */
  private static Path primary(Path here) {
    String pointer;
    try {
      pointer = new String(Files.readAllBytes(here.resolve(".git")), StandardCharsets.UTF_8);
    } catch (IOException e) {
      return here;
    }
    Matcher named = GITDIR.matcher(pointer);
    if (!named.find()) return here;
    Path gitDirectory = here.resolve(named.group(1)).normalize();
    Path worktrees = gitDirectory.getParent();
    if (worktrees == null || worktrees.getParent() == null) return here;
    boolean cut = worktrees.getFileName().toString().equals("worktrees")
        && worktrees.getParent().getFileName().toString().equals(".git");
    return cut ? worktrees.getParent().getParent() : here;
  }

  /** The first 32 hex characters of the path's sha256: {@code digestString} without its prefix. */
  private static String key(Path checkout) {
    try {
      byte[] digest = MessageDigest.getInstance("SHA-256").digest(checkout.toString().getBytes(StandardCharsets.UTF_8));
      StringBuilder hex = new StringBuilder();
      for (int i = 0; i < 16; i++) hex.append(String.format("%02x", digest[i]));
      return hex.toString();
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
  }

  // --------------------------------------------------------------------- seeding

  /**
   * A worktree's first run takes the base's sealed rows for the same record.
   * Unsealed ones are JVMs of the primary checkout still running, and are not
   * this checkout's to finish. Silent on failure: rows that were not seeded are
   * rows this checkout records for itself.
   */
  private static void seed(Path checkout, Path record) {
    Layers layers = layers(checkout);
    if (layers.top.equals(layers.base)) return;
    Path records = record.resolveSibling(".jvm").resolve("records");
    Path from = layers.base.resolve(layers.top.relativize(records));
    if (Files.exists(records) || !Files.isDirectory(from)) return;
    Path staging = records.resolveSibling("records." + UUID.randomUUID() + ".seed");
    try {
      Files.createDirectories(staging);
      try (DirectoryStream<Path> files = Files.newDirectoryStream(from, "*.jsonl")) {
        for (Path file : files) {
          if (Coverage.sealed(file)) Files.copy(file, staging.resolve(file.getFileName()));
        }
      }
      Files.move(staging, records, StandardCopyOption.ATOMIC_MOVE);
    } catch (IOException | RuntimeException e) {
      // Another fork got there first, or there was nothing to take.
      try (DirectoryStream<Path> files = Files.newDirectoryStream(staging)) {
        for (Path file : files) Files.delete(file);
      } catch (IOException | RuntimeException ignored) {
        // The staging copy outlives this run at worst.
      }
      try {
        Files.deleteIfExists(staging);
      } catch (IOException ignored) {
        // As above.
      }
    }
  }
}
