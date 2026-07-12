'use client';

import { useEffect, useState, useRef } from 'react';
import { Treemap, ResponsiveContainer, Tooltip } from 'recharts';

interface StockRow {
  symbol: string;
  name: string;
  pctChange: number;
  marketCap: number; // in INR or USD (consistent unit)
  volume?: number;
  sector?: string;
}

interface HeatmapData {
  name: string;          // display name (e.g. "RELIANCE")
  size: number;          // log-scaled market cap
  pctChange: number;
  marketCap: number;
  volume?: number;
  sector?: string;
  [key: string]: unknown;
}

/** Color mapping (same logic you had, improved slightly) */
function pctToColor(pct: number): string {
  if (Math.abs(pct) < 0.05) return 'hsl(240, 8%, 22%)';
  if (pct > 0) {
    const intensity = Math.min(Math.max(pct / 4, 0), 1);
    const lightness = 22 + intensity * 22;
    const saturation = 45 + intensity * 30;
    return `hsl(152, ${saturation}%, ${lightness}%)`;
  }
  const intensity = Math.min(Math.max(Math.abs(pct) / 4, 0), 1);
  const lightness = 22 + intensity * 20;
  const saturation = 45 + intensity * 28;
  return `hsl(355, ${saturation}%, ${lightness}%)`;
}

function pctToTextColor(pct: number): string {
  if (Math.abs(pct) < 0.05) return 'var(--text-muted)';
  return pct > 0 ? 'var(--bullish)' : 'var(--bearish)';
}

/** Format large numbers nicely */
function formatMarketCap(cap: number): string {
  if (cap >= 1e12) return `₹${(cap / 1e12).toFixed(1)}T`;
  if (cap >= 1e9) return `₹${(cap / 1e9).toFixed(1)}B`;
  return `₹${(cap / 1e6).toFixed(0)}M`;
}

/** Custom treemap cell */
function CustomContent(props: any) {
  const { x, y, width, height, name, pctChange, marketCap } = props;
  if (pctChange == null) return null;

  const showLabels = width >= 55 && height >= 45;
  const sign = pctChange >= 0 ? '+' : '';

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={8}
        ry={8}
        fill={pctToColor(pctChange)}
        stroke="var(--bg-base)"
        strokeWidth={2}
        style={{ cursor: 'pointer', transition: 'all 120ms ease' }}
      />
      {showLabels && (
        <>
          <text
            x={x + width / 2}
            y={y + height / 2 - 6}
            textAnchor="middle"
            dominantBaseline="middle"
            fill="rgba(255,255,255,0.95)"
            fontSize={width > 110 ? 12 : 10}
            fontWeight={700}
            letterSpacing="0.02em"
          >
            {name}
          </text>
          <text
            x={x + width / 2}
            y={y + height / 2 + 12}
            textAnchor="middle"
            dominantBaseline="middle"
            fill={pctToTextColor(pctChange)}
            fontSize={width > 110 ? 13 : 10}
            fontWeight={800}
          >
            {`${sign}${pctChange.toFixed(2)}%`}
          </text>
        </>
      )}
    </g>
  );
}

/** Tooltip */
function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as HeatmapData;

  return (
    <div className="rounded-xl border border-[var(--border-medium)] bg-[var(--bg-elevated)] p-3.5 text-sm shadow-xl">
      <div className="font-semibold tracking-tight">{d.name}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span style={{ color: pctToTextColor(d.pctChange) }} className="text-lg font-bold tabular-nums">
          {d.pctChange >= 0 ? '+' : ''}{d.pctChange.toFixed(2)}%
        </span>
      </div>
      <div className="mt-2 text-xs text-[var(--text-muted)]">
        Market Cap: <span className="font-medium text-[var(--text-primary)]">{formatMarketCap(d.marketCap)}</span>
      </div>
      {d.sector && (
        <div className="mt-0.5 text-xs text-[var(--text-muted)]">Sector: {d.sector}</div>
      )}
      {d.volume && (
        <div className="mt-0.5 text-xs text-[var(--text-muted)]">
          Volume: {(d.volume / 1e6).toFixed(1)}M
        </div>
      )}
    </div>
  );
}

export default function StockHeatmap() {
  const [data, setData] = useState<HeatmapData[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch stock data (replace /api/stocks-heatmap with your endpoint)
  useEffect(() => {
    fetch('/api/stocks-heatmap?limit=60') // top ~60 by market cap
      .then(res => res.json())
      .then((json: { stocks: StockRow[] }) => {
        const stocks = json.stocks ?? [];

        const mapped: HeatmapData[] = stocks.map(stock => {
          // Log scale prevents mega-caps from dominating visually
          const logSize = Math.max(2, Math.log10(stock.marketCap / 1e9) * 8);

          return {
            name: stock.symbol,
            size: logSize,
            pctChange: stock.pctChange,
            marketCap: stock.marketCap,
            volume: stock.volume,
            sector: stock.sector,
          };
        });

        setData(mapped);
      })
      .catch(err => console.error('[StockHeatmap] fetch error:', err))
      .finally(() => setLoading(false));
  }, []);

  // Fullscreen handling
  const toggleFullscreen = async () => {
    const el = containerRef.current;
    if (!el) return;

    try {
      if (!document.fullscreenElement) {
        await el.requestFullscreen();
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch (err) {
      console.error('Fullscreen error:', err);
    }
  };

  // Listen for native fullscreen changes (Esc key etc.)
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  if (loading) {
    return (
      <div className="card" style={{ minHeight: 380 }}>
        <div className="card-header">
          <h2>Stock Heatmap</h2>
        </div>
        <div className="card-body empty-state">
          <div className="pulse-dot" />
          <p className="mt-3">Loading top stocks by market cap…</p>
        </div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="card" style={{ minHeight: 380 }}>
        <div className="card-header">
          <h2>Stock Heatmap</h2>
        </div>
        <div className="card-body empty-state">
          <p>No stock data available. Run market data ingestion first.</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="card group relative overflow-hidden"
      style={{ minHeight: 380 }}
      id="stock-heatmap"
    >
      <div className="card-header flex items-center justify-between">
        <div>
          <h2>Stock Heatmap</h2>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Top {data.length} stocks • Size = Market Cap (log scaled) • Color = Today’s % Change
          </p>
        </div>

        <button
          onClick={toggleFullscreen}
          className="flex items-center gap-2 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-elevated)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--bg-base)] active:scale-[0.985] transition-all"
        >
          {isFullscreen ? (
            <>Exit Fullscreen <span className="text-lg leading-none">⤵</span></>
          ) : (
            <>Expand <span className="text-lg leading-none">⤢</span></>
          )}
        </button>
      </div>

      <div className="card-body p-3">
        <ResponsiveContainer width="100%" height={isFullscreen ? 520 : 340}>
          <Treemap
            data={data}
            dataKey="size"
            aspectRatio={isFullscreen ? 2.2 : 1.8}
            content={<CustomContent />}
            isAnimationActive={false}
          >
            <Tooltip content={<CustomTooltip />} />
          </Treemap>
        </ResponsiveContainer>
      </div>

      {/* Optional subtle footer note */}
      <div className="px-4 pb-3 text-[10px] text-[var(--text-dim)]">
        Larger tiles = bigger market cap. Green = bullish move. Click tiles or use your alerts for deeper catalyst analysis.
      </div>
    </div>
  );
}