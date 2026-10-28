"use client";

import { Suspense, use, useState, useSyncExternalStore } from "react";

let diagramSequence = 0;

type Drawing = { readonly svg: string } | { readonly failed: true };

/**
 * Mermaid, once per page, with Inter loaded before it measures anything.
 *
 * Mermaid sizes each box by laying its label out under <body> in Inter, once.
 * A face still loading is laid out as its fallback, and the boxes keep that size
 * after Inter swaps in. A face that fails to load is measured as the fallback it
 * is shown in.
 */
let loaded: Promise<typeof import("mermaid").default> | undefined;
function mermaid() {
  loaded ??= Promise.all([
    import("mermaid"),
    document.fonts.load("1em Inter").catch(() => undefined),
  ]).then(([{ default: mermaid }]) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
      themeVariables: {
        background: "#181b1d",
        primaryColor: "#1e2224",
        primaryTextColor: "#f3f4f6",
        primaryBorderColor: "#ff4a19",
        secondaryColor: "#24282a",
        tertiaryColor: "#181b1d",
        lineColor: "#756d67",
        edgeLabelBackground: "#181b1d",
        clusterBkg: "#181b1d",
        clusterBorder: "#383e41",
        // A sequence diagram's note is yellow by default.
        noteBkgColor: "#24282a",
        noteTextColor: "#f3f4f6",
        noteBorderColor: "#756d67",
        // Series in order: what the page is about, what it is compared
        // with, a one-off cost. The last colour is the card behind the
        // chart (`.mermaid-canvas`): a bar chart ends with an all-zero
        // series in it, which paints over the stub the value axis's
        // padding draws in front of every bar, including a zero one.
        xyChart: {
          backgroundColor: "transparent",
          titleColor: "#f3f4f6",
          xAxisLabelColor: "#f3f4f6",
          xAxisTitleColor: "#8f8580",
          xAxisLineColor: "#756d67",
          xAxisTickColor: "#756d67",
          yAxisLabelColor: "#8f8580",
          yAxisTitleColor: "#8f8580",
          yAxisLineColor: "#756d67",
          yAxisTickColor: "#756d67",
          plotColorPalette: "#ff4a19, #756d67, #8f8580, #15181a",
        },
      },
      // A chart here is a handful of horizontal bars; Mermaid's default
      // 500px height spends most of it on the gaps between them.
      xyChart: {
        height: 150,
      },
      flowchart: {
        curve: "basis",
        htmlLabels: true,
        nodeSpacing: 34,
        rankSpacing: 48,
        useMaxWidth: false,
      },
    });
    return mermaid;
  });
  return loaded;
}

/**
 * One drawing per source, held so every render of a diagram reads the same
 * promise. Suspending on it, rather than awaiting it in an effect, is what makes
 * the diagram's arrival visible to anything that asks React whether the page is
 * still waiting.
 */
const drawings = new Map<string, Promise<Drawing>>();
function drawing(source: string): Promise<Drawing> {
  let drawn = drawings.get(source);
  if (drawn === undefined) {
    // A vertical chart stacks its value axis in the height, and at 150px the
    // tick labels overlap and the axis title is cut. It is set in the diagram,
    // not in `initialize`: that config is global, and every diagram on a page
    // renders concurrently.
    const vertical = /^\s*xychart-beta\s*$/m.test(source);
    drawn = mermaid()
      .then((mermaid) =>
        mermaid.render(
          `va-mermaid-${++diagramSequence}`,
          vertical
            ? `---\nconfig:\n  xyChart:\n    height: 320\n---\n${source}`
            : source,
        ),
      )
      .then(({ svg }): Drawing => ({ svg }))
      .catch((): Drawing => ({ failed: true }));
    drawings.set(source, drawn);
  }
  return drawn;
}

const subscribe = () => () => {};

export default function MermaidDiagram({ source }: { source: string }) {
  const title = /^\s*accTitle:\s*(.+)$/m.exec(source)?.[1] ?? "Diagram";
  // Mermaid draws in a browser only: the server, and the hydration that matches
  // it, show the placeholder, and the client renders the diagram after it.
  const browser = useSyncExternalStore(subscribe, () => true, () => false);
  const placeholder = <Placeholder title={title} />;
  return (
    <figure className="mermaid-diagram">
      <Suspense fallback={placeholder}>
        {browser ? <Diagram source={source} title={title} /> : placeholder}
      </Suspense>
    </figure>
  );
}

function Placeholder({ title }: { title: string }) {
  return (
    <div className="mermaid-canvas is-fit" role="img" aria-label={title} aria-busy>
      <p>Rendering diagram…</p>
    </div>
  );
}

function Diagram({ source, title }: { source: string; title: string }) {
  const drawn = use(drawing(source));
  const [fit, setFit] = useState(true);
  if (!("svg" in drawn)) {
    return (
      <div className="mermaid-canvas is-fit" role="img" aria-label={title}>
        <p>The diagram could not be rendered.</p>
      </div>
    );
  }
  return (
    <>
      <div className={`mermaid-canvas${fit ? " is-fit" : ""}`} role="img" aria-label={title}>
        <div dangerouslySetInnerHTML={{ __html: drawn.svg }} />
      </div>
      <button
        className="mermaid-size-control"
        type="button"
        onClick={() => setFit((current) => !current)}
      >
        {fit ? "Inspect at full size" : "Fit diagram"}
      </button>
    </>
  );
}
