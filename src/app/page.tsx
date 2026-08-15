"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import DayPanel, { type DiscoverPayload } from "@/components/DayPanel";
import RecommendationCard from "@/components/RecommendationCard";
import WeatherCard from "@/components/WeatherCard";
import LocaleToggle from "@/components/LocaleToggle";
import { useI18n } from "@/lib/i18n";
import type { PlaceProfile, RecommendResult, ScoredPlace } from "@/lib/types";
import { EXPERIENCE_TYPE_MAP } from "@/lib/places/taxonomy";

const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });

interface SavedLocation {
  lat: number;
  lng: number;
  label: string;
}

export default function HomePage() {
  const { t, locale } = useI18n();
  const [location, setLocation] = useState<SavedLocation | null>(null);
  const [mode, setMode] = useState<string>("transit");
  const [result, setResult] = useState<RecommendResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [guideState, setGuideState] = useState<"idle" | "thinking" | "done">("idle");
  const [votes, setVotes] = useState<Record<string, "like" | "dislike">>({});
  const [profile, setProfile] = useState<PlaceProfile | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("tabi.lastLocation");
      if (raw) setLocation(JSON.parse(raw) as SavedLocation);
    } catch {
      // ignore
    }
    fetch("/api/feedback")
      .then((r) => r.json())
      .then((d) => setProfile(d.profile as PlaceProfile))
      .catch(() => {});
  }, []);

  const handleFeedback = useCallback(async (placeId: string, liked: boolean, tags?: string[]) => {
    setVotes((v) => ({ ...v, [placeId]: liked ? "like" : "dislike" }));
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ placeId, liked, tags }),
      });
      if (res.ok) {
        const d = (await res.json()) as { profile: PlaceProfile };
        setProfile(d.profile);
      }
    } catch {
      // optimistic vote stays; profile updates on next action
    }
  }, []);

  const handleDiscover = useCallback(
    async (payload: DiscoverPayload) => {
      setLoading(true);
      setError(false);
      setResult(null);
      setSelectedId(null);
      setGuideState("idle");
      try {
        const loc = { lat: payload.lat, lng: payload.lng, label: payload.label };
        setLocation(loc);
        setMode(payload.mode);
        try {
          localStorage.setItem("tabi.lastLocation", JSON.stringify(loc));
        } catch {
          // ignore
        }

        // phase 1 (fast): rules pipeline — weather, discovery, scoring
        const res = await fetch("/api/recommend", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lat: payload.lat,
            lng: payload.lng,
            budget: payload.budget,
            types: payload.types,
            mode: payload.mode,
            lang: locale,
          }),
        });
        if (!res.ok) throw new Error("bad response");
        const data = (await res.json()) as RecommendResult;
        setResult(data);
        setLoading(false);

        // photo enrichment (async, non-blocking): search APIs give ~1 photo,
        // Place Details up to 8 — cards update when the refs arrive
        if (data.places.length > 0) {
          const topIds = data.places
            .slice(0, 6)
            .map((p) => p.id)
            .join(",");
          fetch(`/api/photos?ids=${encodeURIComponent(topIds)}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => {
              const map = d?.photos as Record<string, string[]> | undefined;
              if (!map) return;
              setResult((prev) => {
                if (!prev) return prev;
                let changed = false;
                const places = prev.places.map((p) => {
                  const refs = map[p.id];
                  if (refs && refs.length > (p.photoRefs?.length ?? 0)) {
                    changed = true;
                    return { ...p, photoRefs: refs, photoRef: refs[0] };
                  }
                  return p;
                });
                return changed ? { ...prev, places } : prev;
              });
            })
            .catch(() => {});
        }

        // phase 2 (async): LLM narrative — day summary + per-place why
        if (data.places.length > 0) {
          setGuideState("thinking");
          try {
            const narrRes = await fetch("/api/narrate", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                lat: payload.lat,
                lng: payload.lng,
                budget: payload.budget,
                mode: payload.mode,
                types: payload.types,
                lang: locale,
                places: data.places.map((p) => ({
                  id: p.id,
                  name: p.name,
                  distanceKm: p.distanceKm,
                  travelMin: p.travelMin,
                  rating: p.rating,
                  tags: p.tags,
                })),
              }),
            });
            if (narrRes.ok) {
              const narr = (await narrRes.json()) as {
                summary?: string;
                narratives?: Record<string, string>;
                narratedBy?: string;
              };
              setResult((prev) => {
                if (!prev) return prev;
                const narrMap = narr.narratives ?? {};
                return {
                  ...prev,
                  narrated: true,
                  narratedBy: narr.narratedBy,
                  summary: narr.summary,
                  places: prev.places.map((p) =>
                    narrMap[p.id] ? { ...p, why: narrMap[p.id] } : p
                  ),
                };
              });
            }
          } catch {
            // guide unavailable — cards with rule reasons remain
          } finally {
            setGuideState("done");
          }
        }
      } catch {
        setError(true);
        setLoading(false);
      }
    },
    [locale]
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🗾</span>
          <div>
            <h1 className="text-xl font-bold text-slate-900">
              {t("app.name")} <span className="font-normal text-slate-400">旅</span>
            </h1>
            <p className="text-xs text-slate-500">{t("app.tagline")}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <LocaleToggle />
          <Link
            href="/settings"
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            ⚙️ {t("nav.settings")}
          </Link>
        </div>
      </header>

      <main className="mt-6 grid gap-6 lg:grid-cols-5">
        {/* left: panel + weather + cards */}
        <div className="space-y-4 lg:col-span-2">
          <DayPanel initialLocation={location} loading={loading} onDiscover={handleDiscover} />

          {loading && (
            <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
              <span className="inline-block animate-pulse">⏳ {t("status.discovering")}</span>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
              {t("status.error")}
            </div>
          )}

          {result && !loading && (
            <>
              <WeatherCard weather={result.weather} />
              {result.sourceNote === "none" ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  {t(`panel.source.${result.sourceNote}`)}
                </div>
              ) : (
                <>
                  <div className="text-xs text-slate-400">{t(`panel.source.${result.sourceNote}`)}</div>
                  {guideState === "thinking" && !result.summary && (
                    <div className="rounded-xl border border-sky-100 bg-sky-50 p-4 text-sm text-slate-500">
                      <span className="inline-block animate-pulse">🧠 {t("status.guideThinking")}</span>
                    </div>
                  )}
                  {result.summary && (
                    <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-slate-800">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-xs font-medium uppercase tracking-wide text-sky-500">
                          {t("card.summaryTitle")}
                        </span>
                        {result.narratedBy && (
                          <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-medium text-sky-600">
                            {result.narratedBy === "opencode-go" ? t("card.narrator.paid") : t("card.narrator.free")}
                          </span>
                        )}
                      </div>
                      {result.summary}
                    </div>
                  )}
                  {result.places.length === 0 ? (
                    <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
                      {t("status.empty")}
                    </div>
                  ) : (
                    <>
                      {profile && Object.keys(profile).some((k) => profile[k] !== 0) && (
                        <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-2.5 text-xs text-slate-600">
                          <span className="font-medium text-emerald-700">{t("profile.title")}: </span>
                          {Object.entries(profile)
                            .filter(([, w]) => w !== 0)
                            .map(([tag, w]) => (
                              <span key={tag} className="mr-2 inline-flex items-center gap-1">
                                {EXPERIENCE_TYPE_MAP[tag]?.emoji ?? ""}
                                {t(`panel.type.${tag}`)}
                                <span className={w > 0 ? "text-emerald-600" : "text-rose-500"}>
                                  {w > 0 ? `+${w}` : w}
                                </span>
                              </span>
                            ))}
                        </div>
                      )}
                      <div className="space-y-3">
                        {result.places.map((p: ScoredPlace) => (
                          <RecommendationCard
                            key={p.id}
                            place={p}
                            origin={{ lat: location!.lat, lng: location!.lng }}
                            mode={mode}
                            narratedBy={result.narratedBy}
                            selected={selectedId === p.id}
                            voted={votes[p.id] ?? null}
                            onSelect={setSelectedId}
                            onFeedback={handleFeedback}
                          />
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}
            </>
          )}

          {!result && !loading && !error && (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white/60 p-8 text-center text-sm text-slate-400">
              {t("app.tagline")} 🌸
            </div>
          )}
        </div>

        {/* right: map */}
        <div className="lg:col-span-3">
          <div className="sticky top-4 h-72 overflow-hidden rounded-2xl border border-slate-200 shadow-sm lg:h-[calc(100vh-6rem)]">
            {location ? (
              <MapView
                center={{ lat: location.lat, lng: location.lng }}
                places={result?.places ?? []}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
            ) : (
              <div className="flex h-full items-center justify-center bg-slate-50 text-sm text-slate-400">
                {t("map.nearby")}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
