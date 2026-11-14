import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

export interface ChartSeries {
  label: string;
  stroke: string;
}

/** `var(--chart-1)` -> the token's value (uPlot draws on a canvas, which cannot read CSS variables). */
function tokenColor(value: string): string {
  const name = value.startsWith('var(')
    ? value.slice(4, -1)
    : value.startsWith('--')
      ? value
      : null;
  if (!name) return value;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || value;
}

/** Thin wrapper around uPlot: created once, then only fed new data / new sizes. */
export function UPlotChart({
  data,
  series,
  dark,
  yMax,
  format,
}: {
  data: uPlot.AlignedData;
  series: ChartSeries[];
  dark: boolean;
  /** Fixed top of the y axis (e.g. 100 for percent); omit to auto-scale. */
  yMax?: number;
  format: (v: number) => string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const latest = useRef(data);
  latest.current = data;

  useEffect(() => {
    const el = host.current!;
    const axisStroke = tokenColor('--muted-foreground');
    const grid = { stroke: tokenColor('--separator'), width: 1 };
    const u = new uPlot(
      {
        width: Math.max(el.clientWidth, 100),
        height: Math.max(el.clientHeight, 80),
        legend: { show: false },
        cursor: { show: false },
        scales: {
          x: { time: false },
          y: { range: (_u, _min, max) => [0, yMax ?? Math.max(max * 1.2, 1)] },
        },
        axes: [
          { show: false },
          {
            stroke: axisStroke,
            grid,
            ticks: { show: false },
            size: 52,
            values: (_u, vals) => vals.map(format),
          },
        ],
        series: [
          {},
          ...series.map((s) => ({
            label: s.label,
            stroke: tokenColor(s.stroke),
            width: 2,
            fill: `${tokenColor(s.stroke)}22`,
            points: { show: false },
          })),
        ],
      },
      latest.current,
      el,
    );
    plot.current = u;
    const ro = new ResizeObserver(() =>
      u.setSize({ width: Math.max(el.clientWidth, 100), height: Math.max(el.clientHeight, 80) }),
    );
    ro.observe(el);
    return () => {
      ro.disconnect();
      u.destroy();
      plot.current = null;
    };
    // Recreated only when the look changes, not on every data point.
  }, [dark, yMax, series.map((s) => s.stroke).join()]);

  useEffect(() => {
    plot.current?.setData(data);
  }, [data]);

  return <div ref={host} className="h-full w-full" />;
}
