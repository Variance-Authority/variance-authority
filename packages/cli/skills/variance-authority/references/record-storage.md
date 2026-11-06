# Which sections occupy a record's bytes?

Name the record to inspect its storage directory:

```bash
variance journeys inspect artifacts/coverage.bin
variance journeys inspect artifacts/coverage.bin --format json
```

The path resolves from the working directory. Inspection reads the header, with
no project configuration, source index, or section payloads. It reports the
record's format and total bytes, each section's stored bytes, and the bytes
outside sections, including the header and alignment padding. Sections appear
largest first, with ties in code-unit order of name.

Each section also reports `rows`, `width`, and `packed`. Rows are physical
storage elements: a one-byte element or a four-byte word, rather than a count
of tests or cases. For a plain section, rows are stored bytes divided by width;
for a packed section, the header names how many elements it decodes to. A nested
index or JSON payload already occupies its section's bytes, so add only the
top-level sizes when accounting for the file.

The directory reader checks framing and section bounds. It leaves payloads
opaque, including sections a later build names. An unreadable file, invalid
directory, or unsupported option exits `2`. `--format` accepts `text` (the
default) or `json`; other journey operations do not accept it.
