"use client";

import { useEffect, useState } from "react";

let diagramSequence = 0;

export default function MermaidDiagram({ source }: { source: string }) {
  const [svg, setSvg] = useState<string>();
  const [failed, setFailed] = useState(false);
  const [fit, setFit] = useState(true);
  const title = /^\s*accTitle:\s*(.+)$/m.exec(source)?.[1] ?? "Flowchart";

  useEffect(() => {
    let current = true;
    const renderId = `va-mermaid-${++diagramSequence}`;

    void import("mermaid")
      .then(async ({ default: mermaid }) => {
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
          },
          flowchart: {
            curve: "basis",
            htmlLabels: true,
            nodeSpacing: 34,
            rankSpacing: 48,
            useMaxWidth: false,
          },
        });

        return mermaid.render(renderId, source);
      })
      .then(({ svg: rendered }) => {
        if (current) setSvg(rendered);
      })
      .catch(() => {
        if (current) setFailed(true);
      });

    return () => {
      current = false;
    };
  }, [source]);

  return (
    <figure className="mermaid-diagram">
      <div
        className={`mermaid-canvas${fit ? " is-fit" : ""}`}
        role="img"
        aria-label={title}
        aria-busy={!svg && !failed}
      >
        {svg ? (
          <div dangerouslySetInnerHTML={{ __html: svg }} />
        ) : failed ? (
          <p>The flowchart could not be rendered.</p>
        ) : (
          <p>Rendering flowchart…</p>
        )}
      </div>
      {svg ? (
        <button
          className="mermaid-size-control"
          type="button"
          onClick={() => setFit((current) => !current)}
        >
          {fit ? "Inspect at full size" : "Fit diagram"}
        </button>
      ) : null}
      <details className="mermaid-source">
        <summary>View flowchart source</summary>
        <pre tabIndex={0}>
          <code>{source}</code>
        </pre>
      </details>
    </figure>
  );
}
