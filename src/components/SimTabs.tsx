"use client";

import Chip from "@/components/ui/Chip";
import { useI18n } from "@/lib/i18n";
import { SIM_PRESETS } from "@/lib/jst";

/** Time-simulation preset chips ("Ahora / Día / Tarde / Noche…"), in a
 *  floating pill (prototype .sim-pill). */
export default function SimTabs({
  preset,
  onChange,
  className = "",
}: {
  preset: string | null;
  onChange: (id: string | null) => void;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <div
      role="group"
      aria-label={t("sim.label")}
      className={`flex items-center gap-0.5 overflow-x-auto rounded-full border border-border bg-surface/94 p-1 shadow-soft backdrop-blur-md ${className}`}
    >
      <Chip selected={preset === null} onClick={() => onChange(null)}>
        {t("sim.now")}
      </Chip>
      {SIM_PRESETS.map((p) => (
        <Chip key={p.id} selected={preset === p.id} onClick={() => onChange(p.id)}>
          {t(`sim.${p.labelKey}`)}
        </Chip>
      ))}
    </div>
  );
}
