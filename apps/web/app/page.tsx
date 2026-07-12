/**
 * Dashboard — the decision surface.
 *
 * Layout: TopStrip → SectorHeatmap + EventRail (side by side) → CandidatesTable.
 * Server component that composes async server children.
 */

import { Suspense } from 'react';
import TopStrip from '@/components/TopStrip';
import SectorHeatmap from '@/components/SectorHeatmap';
import EventRail from '@/components/EventRail';
import CandidatesTable from '@/components/CandidatesTable';

function LoadingSkeleton({ label }: { label: string }) {
  return (
    <div className="card" style={{ minHeight: 160 }}>
      <div className="card-body empty-state">
        <div className="pulse-dot" />
        <p style={{ marginTop: 12 }}>{label}</p>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <span className="page-subtitle">
          {new Date().toLocaleDateString('en-IN', {
            weekday: 'short',
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          })}
        </span>
      </div>

      {/* Top Strip — five numbers, three seconds */}
      <Suspense fallback={<LoadingSkeleton label="Loading market data…" />}>
        <TopStrip />
      </Suspense>

      {/* Middle row — Heatmap + Event Rail */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '2fr 1fr',
          gap: 16,
          marginTop: 16,
        }}
      >
        <Suspense fallback={<LoadingSkeleton label="Loading heatmap…" />}>
          <SectorHeatmap />
        </Suspense>
        <Suspense fallback={<LoadingSkeleton label="Loading events…" />}>
          <EventRail />
        </Suspense>
      </div>

      {/* Candidates Table */}
      <div style={{ marginTop: 16 }}>
        <Suspense fallback={<LoadingSkeleton label="Loading candidates…" />}>
          <CandidatesTable />
        </Suspense>
      </div>
    </>
  );
}
