import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

export interface ChartSeries {
  label: string;
  stroke: string;
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
    const axisStroke = dark ? '#94a3b8' : '#475569';
    const grid = { stroke: dark ? '#1e293b' : '#e2e8f0', width: 1 };
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
            stroke: s.stroke,
            width: 2,
            fill: `${s.stroke}22`,
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
