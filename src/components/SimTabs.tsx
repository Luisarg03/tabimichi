"use client";

import Chip from "@/components/ui/Chip";
import { useI18n } from "@/lib/i18n";
import { SIM_PRESETS } from "@/lib/jst";

/** Time-simulation preset chips ("Ahora / Día / Tarde / Noche…"). */
export default function SimTabs({
  preset,
  onChange,
}: {
  preset: string | null;
  onChange: (id: string | null) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-1 overflow-x-auto py-0.5">
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
