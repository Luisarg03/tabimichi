"use client";

import type { CrowdEstimate, CrowdLabel } from "@/lib/types";
import { useI18n } from "@/lib/i18n";

/**
 * One place, one crowd reading — shared by the card, the detail panel and the
 * map legend so the same value never looks like two different things.
 * Green = quiet, amber = normal, cinnabar = busy, red = packed.
 */
export const CROWD_COLOR: Record<CrowdLabel, string> = {
  low: "var(--color-ok, #2e7d5b)",
  medium: "var(--color-warn, #8a6a2a)",
  high: "var(--color-verm, #c04b33)",
  veryHigh: "var(--color-bad, #b03028)",
};

export const CROWD_SOFT: Record<CrowdLabel, string> = {
  low: "var(--color-ok-soft, rgba(46,125,91,.13))",
  medium: "var(--color-warn-soft, rgba(138,106,42,.12))",
  high: "var(--color-verm-soft, rgba(192,75,51,.12))",
  veryHigh: "var(--color-bad-soft, rgba(176,48,40,.11))",
};

/** "estimado" / "observado hace 20 min" — the honest provenance line. */
export function crowdSourceLabel(
  crowd: CrowdEstimate,
  t: ReturnType<typeof useI18n>["t"],
  locale: string
): string {
  if (crowd.source === "model" || !crowd.observedAt) return t("crowd.estimated");
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(crowd.observedAt)) / 60000));
  const when =
    minutes < 1
      ? t("crowd.justNow")
      : new Date(crowd.observedAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  return crowd.source === "mixed" ? t("crowd.mixed") : t("crowd.observed", { when });
}

/** Reasons behind the number, already translated ("finde", "lluvia"…). */
export function crowdFactors(
  crowd: CrowdEstimate,
  t: ReturnType<typeof useI18n>["t"]
): string[] {
  return crowd.factors.map((f) => t(`crowd.factor.${f}`));
}

export default function CrowdBadge({ crowd }: { crowd: CrowdEstimate }) {
  const { t, locale } = useI18n();
  const detail = [crowdSourceLabel(crowd, t, locale), ...crowdFactors(crowd, t)].join(" · ");
  return (
    <span
      title={detail}
      className="flex items-center gap-1 text-[11.5px] font-semibold"
      style={{ color: CROWD_COLOR[crowd.label] }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: CROWD_COLOR[crowd.label], boxShadow: `0 0 0 2px ${CROWD_SOFT[crowd.label]}` }}
      />
      {t(`crowd.label.${crowd.label}`)}
    </span>
  );
}
