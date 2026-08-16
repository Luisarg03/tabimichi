/**
 * E2E smoke test — runs against a LIVE Tabi server (next start / next dev).
 *   node scripts/smoke-e2e.mjs [baseUrl]
 * Exits non-zero on the first failure. Covers the full browser flow:
 * recommend (real + simulated), feedback, geocode, photos, narrate.
 */
const BASE = process.argv[2] ?? "http://localhost:3000";

let failures = 0;
function check(label, ok, detail = "") {
  if (ok) {
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function main() {
  console.log(`E2E smoke against ${BASE}`);

  // 1. real-mode recommend (Osaka, walking)
  console.log("recommend (real mode):");
  let r = await post("/api/recommend", {
    lat: 34.7048, lng: 135.4944, budget: "afternoon", types: [], mode: "walking", lang: "es",
  });
  check("200", r.status === 200, `status ${r.status}`);
  check("places > 0", (r.json?.places ?? []).length > 0);
  // soft closed filter in real mode: at least one open, closed ones carry a badge
  check("at least one place open", (r.json?.places ?? []).some((p) => p.openNow !== false));
  check("weather present", Boolean(r.json?.weather?.tempC !== undefined));

  // 2. simulated times — 03:00 should filter harder than 15:00
  console.log("recommend (simulation):");
  const at = async (iso) =>
    (await post("/api/recommend", {
      lat: 34.7048, lng: 135.4944, budget: "afternoon", types: ["food"], mode: "walking", lang: "es", now: iso,
    })).json;
  const sim9 = await at("2026-08-16T09:00:00.000Z");
  const sim3 = await at("2026-08-16T03:00:00.000Z");
  check("200", sim9 && Array.isArray(sim9.places));
  check("09:00 results never closed", (sim9.places ?? []).every((p) => p.openNow !== false));
  check("03:00 results never closed", (sim3.places ?? []).every((p) => p.openNow !== false));
  check(
    "opening hours evaluated at simulated hour (some place open=true)",
    [...sim9.places, ...sim3.places].some((p) => p.openNow === true)
  );

  // 2b. interest keyword — should return 200 with places; keyword hits are a
  // quality signal, warn (not fail) when the pool has no name matches
  console.log("recommend (keyword):");
  const kw = (await post("/api/recommend", {
    lat: 35.681619, lng: 139.7653303, budget: "afternoon", types: [], mode: "transit", lang: "es",
    keyword: "pokemon",
  })).json;
  check("keyword request 200 + places", kw && (kw.places ?? []).length > 0);
  const kwHits = (kw.places ?? []).filter((p) => (p.reasons ?? []).some((x) => x.key === "keywordMatch")).length;
  if (kwHits === 0) console.log("⚠ warn: keyword 'pokemon' produced 0 name matches (pool:", kw.candidates, ")");
  else console.log(`✓ ${kwHits} keyword matches in top-${kw.places.length}`);

  // 3. geocode
  console.log("geocode:");
  const geo = await fetch(`${BASE}/api/geocode?q=${encodeURIComponent("Ofukacho, Osaka")}`).then((x) => x.json());
  check("coords for Ofukacho", Math.abs(geo.lat - 34.70) < 0.1 && Math.abs(geo.lng - 135.49) < 0.1);

  // 4. photo proxy (uses a place from the recommend response)
  console.log("photo proxy:");
  const withPhoto = (r.json?.places ?? []).find((p) => p.photoRef || (p.photoRefs ?? []).length > 0);
  if (withPhoto) {
    const ref = withPhoto.photoRefs?.[0] ?? withPhoto.photoRef;
    const p1 = await fetch(`${BASE}/api/photo?ref=${ref}&id=${withPhoto.id}`);
    const bytes1 = (await p1.arrayBuffer()).byteLength;
    const p2 = await fetch(`${BASE}/api/photo?ref=${ref}&id=${withPhoto.id}`);
    const bytes2 = (await p2.arrayBuffer()).byteLength;
    check("photo 200 + bytes", p1.status === 200 && bytes1 > 0, `status ${p1.status}`);
    check("photo cached (same bytes)", bytes1 === bytes2);
  } else {
    check("photo proxy (skipped: no photo in results)", true, "sin foto en resultados");
  }

  // 5. feedback round trip
  console.log("feedback:");
  const fb = await post("/api/feedback", { placeId: "e2e-probe", liked: true, tags: ["onsen"] });
  check("vote accepted", fb.status === 200, `status ${fb.status}`);
  const profile = (await fetch(`${BASE}/api/feedback`).then((x) => x.json())).profile ?? {};
  check("profile updated", (profile.onsen ?? 0) >= 1, JSON.stringify(profile));

  // 6. narrate (async phase, best-effort: provider may be rate-limited)
  console.log("narrate (best-effort):");
  const narr = await post("/api/narrate", {
    lat: 34.7048, lng: 135.4944, budget: "afternoon", mode: "walking", types: [],
    lang: "es", places: (r.json?.places ?? []).slice(0, 3).map((p) => ({
      id: p.id, name: p.name, distanceKm: p.distanceKm, travelMin: p.travelMin,
      rating: p.rating, tags: p.tags,
    })),
  });
  check("narrate responds", narr.status === 200, `status ${narr.status}`);

  // 7. persisted logs endpoint
  console.log("logs:");
  const logs = await fetch(`${BASE}/api/logs?tail=20`).then((x) => x.json()).catch(() => null);
  check("logs endpoint returns entries", Array.isArray(logs?.entries) && logs.entries.length > 0);
  check(
    "entries include recommend results",
    logs?.entries.some((e) => e.type === "recommend" && Array.isArray(e.top))
  );

  console.log(failures === 0 ? "\n✅ E2E smoke passed" : `\n❌ ${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("E2E smoke crashed:", e.message);
  process.exit(1);
});
