import { readFileSync } from "node:fs";
const cfg = JSON.parse(readFileSync(new URL("../data/config.json", import.meta.url), "utf8"));
const key = cfg.geoapifyApiKey;
if (!key) {
  console.log("NO GEOAPIFY KEY");
  process.exit(1);
}
const { geoapifySearch } = await import("../src/lib/places/geoapify.ts");
const { resolveTypes } = await import("../src/lib/places/taxonomy.ts");
for (const [label, ids] of [
  ["food", ["food"]],
  ["museum", ["museum"]],
  ["viewpoint", ["viewpoint"]],
  ["onsen", ["onsen"]],
  ["nightlife", ["nightlife"]],
  ["any", []],
]) {
  const types = resolveTypes(ids);
  try {
    const places = await geoapifySearch(key, types, 36.6485, 138.1949, 12000, "es");
    console.log(`== ${label} → ${places.length}`);
    for (const p of places.slice(0, 3)) console.log(`   ${p.name.slice(0, 38).padEnd(40)} tags=${p.tags}`);
  } catch (e) {
    console.log(`== ${label} → ERROR ${e.message}`);
  }
}
