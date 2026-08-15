import { readFileSync } from "node:fs";
const cfg = JSON.parse(readFileSync(new URL("../data/config.json", import.meta.url), "utf8"));
const key = cfg.opencodeApiKey;
const system = "Sos Tabi, un guía de viaje local experto en Japón. Respondés en español, conciso y específico. Solo JSON, sin texto extra.";
const user = `Contexto: el usuario explora cerca de su zona con tarde disponible y se mueve caminando. Clima: cloudy, 23°C, sensación 25.7°C. Intereses: temple, viewpoint. Candidatos puntuados: [{"id":"g_1","name":"Byakurembō","distanceKm":1.2,"travelMin":17,"rating":4,"tags":["viewpoint"]},{"id":"g_2","name":"Wakasato Park","distanceKm":1.7,"travelMin":22,"rating":4,"tags":["park"]}]. Redactá para los mejores 3 un "por qué ir hoy" de 1-2 frases cada uno, mencionando algo concreto (clima, momento del día, distancia en su modo de transporte, qué lo hace especial). Respondé SOLO JSON: {"narratives":[{"id":"...","why":"..."}]}`;
const res = await fetch("https://opencode.ai/zen/go/v1/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
  body: JSON.stringify({ model: "deepseek-v4-flash", messages: [{ role: "system", content: system }, { role: "user", content: user }], max_tokens: 700, temperature: 0.5 }),
  signal: AbortSignal.timeout(45000),
});
console.log("HTTP", res.status);
const j = await res.json();
console.log("choices[0].message keys:", Object.keys(j.choices?.[0]?.message ?? {}));
console.log("content type:", typeof j.choices?.[0]?.message?.content);
console.log("content:", JSON.stringify(j.choices?.[0]?.message?.content)?.slice(0, 800));
