"use client";

import DayPanel, { type DiscoverPayload } from "@/components/DayPanel";
import type { TimeBudget, TransportMode } from "@/lib/types";

interface PanelLocation {
  lat: number;
  lng: number;
  label: string;
  gps?: boolean;
}

/** Mobile search overlay: full-screen form (DayPanel in overlay mode) that
 *  replaces the top pill until a discover is confirmed or the user closes. */
export default function SearchOverlay({
  location,
  loading,
  onDiscover,
  onClose,
  budget,
  mode,
  types,
  keyword,
  onBudgetChange,
  onModeChange,
  onTypesChange,
  onKeywordChange,
}: {
  location?: PanelLocation | null;
  loading: boolean;
  onDiscover: (payload: DiscoverPayload) => void;
  onClose: () => void;
  budget: TimeBudget;
  mode: TransportMode;
  types: string[];
  keyword: string;
  onBudgetChange: (b: TimeBudget) => void;
  onModeChange: (m: TransportMode) => void;
  onTypesChange: (t: string[]) => void;
  onKeywordChange: (k: string) => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-slate-50 tabi-safe-top tabi-safe-x tabi-safe-bottom">
      {/* Scrollable wrapper: on small phones (375×667) the location + filters
          form is taller than the viewport; without scrolling the Discover
          button below the fold was unreachable. */}
      <div className="tabi-rise-in min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
        <DayPanel
          initialLocation={location}
          loading={loading}
          onDiscover={onDiscover}
          onClose={onClose}
          budget={budget}
          mode={mode}
          types={types}
          keyword={keyword}
          onBudgetChange={onBudgetChange}
          onModeChange={onModeChange}
          onTypesChange={onTypesChange}
          onKeywordChange={onKeywordChange}
        />
      </div>
    </div>
  );
}
