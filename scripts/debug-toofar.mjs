import { discover } from "../src/lib/places/index.ts";
import { scorePlaces } from "../src/lib/scoring.ts";
import { getWeather, weatherAt } from "../src/lib/weather.ts";
import { haversineKm, travelMin, radiusForBudget, BUDGET_MIN } from "../src/lib/geo.ts";
import { googlePlaceDetails } from "../src/lib/places/google.ts";
import { isOpenAt } from "../src/lib/open-hours.ts";
import { jstHourStamp } from "../src/lib/jst.ts";
import { getConfig } from "../src/lib/settings.ts";

const lat = 36.6442612, lng = 138.1860968;
const mode = "transit", budget = "afternoon";
const sim = new Date("2026-08-16T21:00:00.000Z"); // Sunday 21:00 JST
const radiusKm = radiusForBudget(budget, mode);
console.log("radius:", radiusKm, "| maxDist:", radiusKm * 1.5);

const { places, source } = await discover({ lat, lng, radiusKm, types: [], simulate: true });
console.log("discover:", source, "| places:", places.length);
const config = getConfig();
for (const p of places.slice(0, 12)) {
  const d = haversineKm({ lat, lng }, p);
  const t = travelMin(d, mode);
  let open = p.openNow;
  if (p.source === "google" && sim) {
    try {
      const { periods } = await googlePlaceDetails(config.googlePlacesApiKey, p.id.slice(2));
      open = isOpenAt(periods, sim);
    } catch { open = "ERR"; }
  }
  const dropped = d > radiusKm * 1.5 ? "MAXDIST" : t > BUDGET_MIN[budget] * 1.25 ? "BUDGET" : "ok";
  console.log(`  ${p.id.slice(0,22).padEnd(24)} ${p.name.slice(0,24).padEnd(26)} d=${d.toFixed(1)}km t=${t}min open=${open} → ${dropped}`);
}
