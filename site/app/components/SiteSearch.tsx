"use client";

import type MiniSearch from "minisearch";
import type { SearchResult } from "minisearch";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { FocusOn } from "react-focus-on";
import {
  SEARCH_INDEX_PATH,
  SEARCH_OPTIONS,
  SEARCH_QUERY,
} from "../content/search-options";

/** What a reader can hold in view at once, and act on without scrolling far. */
const RESULT_LIMIT = 8;

type Status = "cold" | "loading" | "ready" | "unavailable";

/**
 * Search over every published section, opened from the header or by `⌘K`.
 *
 * The index is fetched the first time it is opened rather than with the page.
 * A reader who never searches never pays for it, and one who does pays once:
 * the result is held for the life of the tab, and every query after the first
 * is answered in memory with nothing on the wire.
 */
export default function SiteSearch() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <SearchTrigger onOpen={() => setOpen(true)} open={open} />
      {open ? <SearchDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/**
 * The header control, and the keyboard that reaches it from anywhere.
 *
 * `⌘K` is what a reader of technical documentation already has in their hands.
 * `/` is offered too, but only while nothing is being typed into — taking it
 * inside a field would eat the character instead of opening anything.
 */
function SearchTrigger({
  onOpen,
  open,
}: {
  readonly onOpen: () => void;
  readonly open: boolean;
}) {
  useEffect(() => {
    if (open) return;

    function onKeyDown(event: globalThis.KeyboardEvent) {
      const shortcut =
        (event.key === "k" && (event.metaKey || event.ctrlKey)) ||
        (event.key === "/" && !isTyping(event.target));
      if (!shortcut) return;
      event.preventDefault();
      onOpen();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onOpen, open]);

  return (
    <button
      type="button"
      onClick={onOpen}
      /* The glyph is decorative and the word is dropped below `sm`, so the
         button carries its own name rather than borrowing one that a phone
         never renders. */
      aria-label="Search the documentation"
      className="flex items-center gap-2 rounded-lg border border-hairline px-2.5 py-1.5 text-quiet transition-colors hover:border-orange/60 hover:text-ivory sm:px-3"
    >
      <SearchGlyph />
      <span className="hidden sm:inline">Search</span>
      <kbd className="hidden rounded border border-hairline px-1.5 py-0.5 font-mono text-[10px] text-quiet md:inline">
        ⌘K
      </kbd>
    </button>
  );
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
  );
}

/**
 * The field, and everything it is currently matching.
 *
 * `FocusOn` owns what being modal means here: focus stays inside while it is
 * open and returns where it came from, the page behind it stops scrolling and
 * stops answering to a screen reader, and Escape and a click outside both close
 * it. The list below the field is a combobox's, so the keyboard moves a
 * selection the field keeps announcing while focus never leaves the input.
 */
function SearchDialog({ onClose }: { readonly onClose: () => void }) {
  const index = useRef<MiniSearch | undefined>(undefined);
  const router = useRouter();
  const listId = useId();

  const [status, setStatus] = useState<Status>("cold");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<readonly SearchResult[]>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    let live = true;
    setStatus("loading");

    loadIndex()
      .then((loaded) => {
        if (!live) return;
        index.current = loaded;
        setStatus("ready");
      })
      .catch(() => {
        if (live) setStatus("unavailable");
      });

    return () => {
      live = false;
    };
  }, []);

  const run = useCallback((text: string) => {
    setQuery(text);
    setActive(0);
    const searched = text.trim()
      ? (index.current?.search(text, SEARCH_QUERY) ?? [])
      : [];
    setResults(searched.slice(0, RESULT_LIMIT));
  }, []);

  /** Results waiting on the index arrive as soon as it does. */
  useEffect(() => {
    if (status === "ready" && query.trim() && results.length === 0) run(query);
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  function go(result: SearchResult | undefined) {
    if (!result) return;
    router.push(result.hash ? `${result.path}#${result.hash}` : result.path);
    onClose();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current) =>
        results.length === 0
          ? 0
          : (current + step + results.length) % results.length,
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      go(results[active]);
    }
  }

  return (
    <div className="site-search-scrim fixed inset-0 z-[60]">
      <FocusOn
        className="site-search-frame"
        returnFocus
        onClickOutside={onClose}
        onEscapeKey={onClose}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Search the documentation"
          className="site-search overflow-hidden rounded-xl border border-hairline bg-panel text-ivory shadow-2xl shadow-deep/60"
          onKeyDown={onKeyDown}
        >
          <div className="flex items-center gap-3 border-b border-hairline px-4">
            <SearchGlyph />
            <input
              type="search"
              value={query}
              onChange={(event) => run(event.target.value)}
              placeholder="Search the documentation"
              aria-label="Search the documentation"
              role="combobox"
              aria-expanded={results.length > 0}
              aria-controls={listId}
              aria-activedescendant={
                results.length > 0 ? `${listId}-${active}` : undefined
              }
              className="w-full bg-transparent py-4 text-base text-ivory outline-none placeholder:text-quiet"
            />
            <kbd className="hidden rounded border border-hairline px-1.5 py-0.5 font-mono text-[10px] text-quiet sm:inline">
              Esc
            </kbd>
          </div>

          <Results
            active={active}
            listId={listId}
            onPick={go}
            query={query}
            results={results}
            status={status}
          />
        </div>
      </FocusOn>
    </div>
  );
}

function Results({
  active,
  listId,
  onPick,
  query,
  results,
  status,
}: {
  readonly active: number;
  readonly listId: string;
  readonly onPick: (result: SearchResult) => void;
  readonly query: string;
  readonly results: readonly SearchResult[];
  readonly status: Status;
}) {
  /** The keyboard moves the selection; the list follows it. */
  useEffect(() => {
    document
      .getElementById(`${listId}-${active}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active, listId]);

  if (status === "unavailable")
    return <Note>Search is unavailable. Use the navigation, or reload.</Note>;
  if (!query.trim())
    return (
      <Note>
        Search titles, headings, prose and code across every published page.
      </Note>
    );
  if (results.length === 0)
    return (
      <Note>
        {status === "ready" ? `Nothing matches “${query.trim()}”.` : "Loading…"}
      </Note>
    );

  return (
    <ul id={listId} role="listbox" className="max-h-[60vh] overflow-y-auto p-2">
      {results.map((result, index) => (
        <li key={result.id} role="presentation">
          <button
            type="button"
            id={`${listId}-${index}`}
            role="option"
            aria-selected={index === active}
            onClick={() => onPick(result)}
            className={`block w-full rounded-lg border-l-2 px-3 py-2.5 text-left transition-colors hover:bg-charcoal ${
              index === active
                ? "border-orange bg-orange/[0.07]"
                : "border-transparent"
            }`}
          >
            <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-quiet">
              {result.section}
              {result.heading ? ` › ${result.title}` : ""}
            </p>
            <p className="mt-0.5 text-sm font-medium text-ivory">
              <Marked terms={result.terms}>
                {result.heading || result.title}
              </Marked>
            </p>
            {result.lead ? (
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-quiet">
                <Marked terms={result.terms}>{result.lead}</Marked>
              </p>
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

function Note({ children }: { readonly children: React.ReactNode }) {
  return <p className="px-5 py-6 text-sm text-quiet">{children}</p>;
}

/** The terms that earned the result, marked where they landed. */
function Marked({
  children,
  terms,
}: {
  readonly children: string;
  readonly terms: readonly string[];
}) {
  const pattern = terms
    .filter((term) => term.length > 1)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  if (!pattern) return <>{children}</>;

  return (
    <>
      {children
        .split(new RegExp(`(${pattern})`, "gi"))
        .map((part, index) =>
          index % 2 === 1 ? (
            <mark key={index} className="bg-transparent text-orange">
              {part}
            </mark>
          ) : (
            part
          ),
        )}
    </>
  );
}

async function loadIndex(): Promise<MiniSearch> {
  const [{ default: MiniSearchClass }, response] = await Promise.all([
    import("minisearch"),
    fetch(SEARCH_INDEX_PATH),
  ]);
  if (!response.ok) throw new Error(`Search index: ${response.status}`);
  return MiniSearchClass.loadJSON(await response.text(), SEARCH_OPTIONS);
}

function SearchGlyph() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5 14 14" strokeLinecap="round" />
    </svg>
  );
}
