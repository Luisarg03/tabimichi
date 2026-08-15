import { readFileSync } from "node:fs";
const cfg = JSON.parse(readFileSync(new URL("../data/config.json", import.meta.url), "utf8"));
const zenKey = cfg.opencodeApiKey;
const goKey = cfg.opencodeGoApiKey;
const bases = ["https://opencode.ai/zen/v1", "https://opencode.ai/go/v1", "https://opencode.ai/zen/go/v1"];
for (const base of bases) {
  for (const [label, key] of [["zen", zenKey], ["go", goKey]]) {
    try {
      const res = await fetch(`${base}/models`, {
        headers: { Authorization: "Bearer " + key },
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        const j = await res.json();
        const ids = (j.data ?? []).map(m => m.id);
        const deepseek = ids.filter(i => /deepseek/i.test(i));
        console.log(`${base} [${label} key] → OK, ${ids.length} models, deepseek: ${JSON.stringify(deepseek.slice(0, 8))}`);
      } else {
        console.log(`${base} [${label} key] → HTTP ${res.status}`);
      }
    } catch (e) {
      console.log(`${base} [${label} key] → ERR ${e.message.slice(0, 60)}`);
    }
  }
}
