/**
 * Guide model registry — the single source of truth for which models the
 * virtual guide can use, and which provider/tier serves each one.
 *
 * Pure data, no server-only imports: shared by the server (providers.ts
 * reorders providers, user-keys route validates the stored value) and by the
 * client (SettingsForm renders the picker from it).
 *
 * A model is identified by its id (the `model` field sent to the
 * OpenAI-compatible /chat/completions endpoint). `providerId` decides which
 * provider's baseURL/key serves it; `tier` only drives UI labels.
 */

export type GuideModelTier = "free" | "paid";
export type GuideModelProviderId = "opencode-zen" | "opencode-go";

export interface GuideModel {
  id: string;
  /** display label shown in the picker (brand names — not translated) */
  label: string;
  providerId: GuideModelProviderId;
  tier: GuideModelTier;
}

export const GUIDE_MODELS: GuideModel[] = [
  {
    id: "deepseek-v4-flash-free",
    label: "DeepSeek V4 Flash (free tier)",
    providerId: "opencode-zen",
    tier: "free",
  },
  {
    id: "deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
    providerId: "opencode-zen",
    tier: "free",
  },
  {
    id: "deepseek-v4-pro",
    label: "DeepSeek V4 Pro",
    providerId: "opencode-go",
    tier: "paid",
  },
  {
    id: "mimo-v2.5",
    label: "Mimo 2.5",
    providerId: "opencode-go",
    tier: "paid",
  },
  {
    id: "minimax-m3",
    label: "MiniMax M3",
    providerId: "opencode-go",
    tier: "paid",
  },
];

export function guideModelById(id: string | undefined | null): GuideModel | undefined {
  if (!id) return undefined;
  return GUIDE_MODELS.find((m) => m.id === id);
}

export function isKnownGuideModel(id: string): boolean {
  return guideModelById(id) !== undefined;
}
