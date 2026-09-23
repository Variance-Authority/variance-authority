"use client";

import { useEffect, useState } from "react";

let diagramSequence = 0;

export default function MermaidDiagram({ source }: { source: string }) {
  const [svg, setSvg] = useState<string>();
  const [failed, setFailed] = useState(false);
  const [fit, setFit] = useState(true);
  const title = /^\s*accTitle:\s*(.+)$/m.exec(source)?.[1] ?? "Diagram";

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
          <p>The diagram could not be rendered.</p>
        ) : (
          <p>Rendering diagram…</p>
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
    </figure>
  );
}
