"use client";

import { useEffect, useRef } from "react";
import {
  Chart,
  LineController,
  BarController,
  LineElement,
  BarElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Filler,
  Legend,
  Tooltip,
  type ChartConfiguration,
} from "chart.js";

Chart.register(
  LineController,
  BarController,
  LineElement,
  BarElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Filler,
  Legend,
  Tooltip
);

// Thin canvas + Chart.js instance wrapper — no react-chartjs-2 dependency,
// same imperative create/destroy-on-change lifecycle the original used
// directly (mainChart/revenueChart + .destroy() before every re-render).
export default function DashboardChart({ config }: { config: ChartConfiguration }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (chartRef.current) {
      chartRef.current.destroy();
      chartRef.current = null;
    }
    chartRef.current = new Chart(canvas, config);
    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(config)]);

  useEffect(() => {
    function handleResize() {
      chartRef.current?.resize();
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return <canvas ref={canvasRef} />;
}
