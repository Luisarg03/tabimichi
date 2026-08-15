"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

export type Locale = "es" | "en";

type Dict = Record<string, unknown>;

const es: Dict = {
  app: { name: "Tabi", tagline: "Descubrí qué hacer hoy, cerca tuyo" },
  nav: { settings: "Ajustes", back: "Volver" },
  panel: {
    where: "¿Dónde estás?",
    searchPlaceholder: "Ciudad o lugar (ej: Nagano, Osaka, Kioto…)",
    useMyLocation: "Usar mi ubicación",
    timeBudget: "Tiempo disponible",
    budget: { lunch: "Almuerzo", afternoon: "Tarde", full_day: "Día completo" },
    modeLabel: "Cómo te movés",
    mode: { walking: "Caminando", transit: "Tren/Bus", car: "Auto" },
    vibe: "Qué tengo ganas de hacer",
    type: {
      any: "Cualquier cosa",
      onsen: "Onsen",
      temple: "Templos",
      viewpoint: "Miradores",
      food: "Comida",
      market: "Mercados",
      museum: "Museos",
      park: "Parques",
      trekking: "Trekking",
      sakura: "Sakura",
      shopping: "Compras",
      nightlife: "Vida nocturna",
    },
    discover: "Descubrir",
    discovering: "Descubriendo…",
    needLocation: "Ingresá un lugar o usá tu ubicación",
    source: {
      google: "Datos: Google Places",
      geoapify: "Datos: Geoapify",
      overpass: "Datos: OpenStreetMap",
      cache: "Datos: cache local",
      none: "Datos no disponibles: OpenStreetMap está saturado. Probá de nuevo en un momento o configurá Google Places en Ajustes.",
    },
  },
  weather: {
    title: "Hoy",
    feels: "Sensación {t}°",
    wind: "Viento {w} km/h",
    precip: "Lluvia {p} mm",
    snow: "Nieve {s} cm",
    rainChance: "Prob. lluvia {p}%",
    cond: {
      clear: "Despejado",
      cloudy: "Nublado",
      fog: "Niebla",
      drizzle: "Llovizna",
      snow: "Nieve",
      showers: "Chubascos",
      snow_showers: "Nevadas",
      thunderstorm: "Tormenta",
    },
  },
  card: {
    distance: "A {km} km",
    travel: "~{min} min",
    open: "Abierto ahora",
    closed: "Cerrado ahora",
    rating: "{r}",
    reviews: "({n} reseñas)",
    price: "{n}/5",
    openInMaps: "Cómo llegar",
    viewInMaps: "Ver en Maps",
    reasonsTitle: "Por qué ahora",
    why: "El guía dice",
    summaryTitle: "Resumen del día",
    narrator: { free: "capa gratuita", paid: "capa paga" },
    voteQuestion: "¿Te gusta esta idea?",
    like: "Me gusta",
    dislike: "No me gusta",
    voted: "¡Anotado!",
  },
  profile: { title: "Tus gustos" },
  sim: {
    label: "Simular hora (Japón)",
    now: "Ahora",
    morning: "Día · 9h",
    afternoon: "Tarde · 15h",
    evening: "Noche · 21h",
    late: "Madrugada · 3h",
    active: "Simulando",
  },
  reasons: {
    weatherRainIndoor: "Hoy llueve — ideal para {type}",
    weatherRainOutdoor: "Hoy llueve — mejor evitar {type} al aire libre",
    weatherSnowIndoor: "Nevando — perfecto para {type}",
    weatherSnowOnsen: "Nieve afuera, calor adentro — onsen perfecto",
    weatherGoodOutdoor: "Buen clima para {type}",
    weatherCold: "Día frío — {type} abrigado",
    distanceGood: "A {min} min en {mode} de donde estás",
    highRated: "Muy bien valorado ({r}★)",
    popular: "Muy visitado ({n} reseñas)",
    openNow: "Abierto ahora",
    profileLiked: "Coincide con tu perfil ({type})",
  },
  status: {
    discovering: "Buscando lugares…",
    guideThinking: "El guía está escribiendo el resumen…",
    error: "No se pudo obtener datos. Probá de nuevo.",
    empty: "No encontramos lugares con esos filtros. Probá otra zona o tipo.",
    geocodeError: "No encontramos ese lugar.",
  },
  settings: {
    title: "Ajustes",
    intro:
      "Las API keys se guardan localmente en data/config.json y nunca salen de tu máquina. También podés usar variables de entorno (GOOGLE_PLACES_API_KEY, OPENCODE_API_KEY, OPENCODE_GO_API_KEY).",
    google: "Google Places API key (opcional)",
    googleHelp:
      "Sin key usamos OpenStreetMap (gratis, sin registro). Con key obtenés ratings, horarios y fotos. Crédito mensual $200 (~6.000 consultas) — gratis de facto para uso personal.",
    geoapify: "Geoapify API key (gratis)",
    geoapifyHelp:
      "3.000 consultas/día gratis, sin tarjeta (geoapify.com). Data de OpenStreetMap con categorías curadas.",
    overpass: "Overpass propio (osm3s) — endpoint",
    overpassHelp:
      "Opcional: apuntá a tu instancia local (Docker) para descubrimiento ilimitado y confiable, ej. http://localhost:8080/api/interpreter. Si queda vacío, usamos mirrors públicos.",
    opencodeZen: "OpenCode Zen API key (guía LLM — próxima fase)",
    opencodeGo: "OpenCode Go API key (próxima fase)",
    save: "Guardar",
    saved: "Guardado ✓",
    connected: "Conectado",
    notConnected: "No configurado",
  },
  map: {
    nearby: "Cerca de tu zona",
    youAreHere: "Estás acá",
    approx: "Ubicación aproximada (dirección buscada)",
    exact: "Ubicación exacta (GPS)",
  },
};

const en: Dict = {
  app: { name: "Tabi", tagline: "Discover what to do today, nearby" },
  nav: { settings: "Settings", back: "Back" },
  panel: {
    where: "Where are you?",
    searchPlaceholder: "City or place (e.g. Nagano, Osaka, Kyoto…)",
    useMyLocation: "Use my location",
    timeBudget: "Time available",
    budget: { lunch: "Lunch", afternoon: "Afternoon", full_day: "Full day" },
    modeLabel: "How you get around",
    mode: { walking: "Walking", transit: "Train/Bus", car: "Car" },
    vibe: "What am I in the mood for",
    type: {
      any: "Anything",
      onsen: "Onsen",
      temple: "Temples",
      viewpoint: "Viewpoints",
      food: "Food",
      market: "Markets",
      museum: "Museums",
      park: "Parks",
      trekking: "Hiking",
      sakura: "Sakura",
      shopping: "Shopping",
      nightlife: "Nightlife",
    },
    discover: "Discover",
    discovering: "Discovering…",
    needLocation: "Enter a place or use your location",
    source: {
      google: "Data: Google Places",
      geoapify: "Data: Geoapify",
      overpass: "Data: OpenStreetMap",
      cache: "Data: local cache",
      none: "No data available: OpenStreetMap is overloaded. Try again in a moment or configure Google Places in Settings.",
    },
  },
  weather: {
    title: "Today",
    feels: "Feels like {t}°",
    wind: "Wind {w} km/h",
    precip: "Rain {p} mm",
    snow: "Snow {s} cm",
    rainChance: "Rain chance {p}%",
    cond: {
      clear: "Clear",
      cloudy: "Cloudy",
      fog: "Fog",
      drizzle: "Drizzle",
      snow: "Snow",
      showers: "Showers",
      snow_showers: "Snow showers",
      thunderstorm: "Thunderstorm",
    },
  },
  card: {
    distance: "{km} km away",
    travel: "~{min} min",
    open: "Open now",
    closed: "Closed now",
    rating: "{r}",
    reviews: "({n} reviews)",
    price: "{n}/5",
    openInMaps: "Directions",
    viewInMaps: "View on Maps",
    reasonsTitle: "Why now",
    why: "The guide says",
    summaryTitle: "Day summary",
    narrator: { free: "free tier", paid: "paid tier" },
    voteQuestion: "Do you like this idea?",
    like: "Like",
    dislike: "Dislike",
    voted: "Got it!",
  },
  profile: { title: "Your tastes" },
  sim: {
    label: "Simulate time (Japan)",
    now: "Now",
    morning: "Day · 9h",
    afternoon: "Afternoon · 15h",
    evening: "Evening · 21h",
    late: "Late night · 3h",
    active: "Simulating",
  },
  reasons: {
    weatherRainIndoor: "Rainy today — great for {type}",
    weatherRainOutdoor: "Rainy today — better to skip {type} outdoors",
    weatherSnowIndoor: "Snowing — perfect for {type}",
    weatherSnowOnsen: "Snow outside, warmth inside — perfect onsen day",
    weatherGoodOutdoor: "Great weather for {type}",
    weatherCold: "Cold day — cozy {type}",
    distanceGood: "{min} min by {mode} from where you are",
    highRated: "Highly rated ({r}★)",
    popular: "Very popular ({n} reviews)",
    openNow: "Open now",
    profileLiked: "Matches your profile ({type})",
  },
  status: {
    discovering: "Looking for places…",
    guideThinking: "The guide is writing the summary…",
    error: "Could not fetch data. Try again.",
    empty: "No places found with these filters. Try another area or type.",
    geocodeError: "Could not find that place.",
  },
  settings: {
    title: "Settings",
    intro:
      "API keys are stored locally in data/config.json and never leave your machine. You can also use environment variables (GOOGLE_PLACES_API_KEY, OPENCODE_API_KEY, OPENCODE_GO_API_KEY).",
    google: "Google Places API key (optional)",
    googleHelp:
      "Without a key we use OpenStreetMap (free, no signup). With a key you get ratings, hours and photos. $200/month free credit (~6,000 calls) — effectively free for personal use.",
    geoapify: "Geoapify API key (free)",
    geoapifyHelp:
      "3,000 requests/day free, no credit card (geoapify.com). OpenStreetMap data with curated categories.",
    overpass: "Self-hosted Overpass (osm3s) — endpoint",
    overpassHelp:
      "Optional: point to your local instance (Docker) for unlimited, reliable discovery, e.g. http://localhost:8080/api/interpreter. Empty = public mirrors.",
    opencodeZen: "OpenCode Zen API key (LLM guide — next phase)",
    opencodeGo: "OpenCode Go API key (next phase)",
    save: "Save",
    saved: "Saved ✓",
    connected: "Connected",
    notConnected: "Not configured",
  },
  map: {
    nearby: "Near your area",
    youAreHere: "You are here",
    approx: "Approximate position (searched address)",
    exact: "Exact position (GPS)",
  },
};

const DICTS: Record<Locale, Dict> = { es, en };

function lookup(dict: Dict, path: string): unknown {
  let cur: unknown = dict;
  for (const part of path.split(".")) {
    if (typeof cur !== "object" || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export function translate(locale: Locale, path: string, params?: Record<string, string | number>): string {
  const raw = lookup(DICTS[locale], path);
  let str = typeof raw === "string" ? raw : path;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      str = str.replaceAll(`{${k}}`, String(v));
    }
  }
  return str;
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (path: string, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    if (typeof window === "undefined") return "es";
    return (localStorage.getItem("tabi.locale") as Locale) || "es";
  });

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem("tabi.locale", l);
    } catch {
      // private mode
    }
  }, []);

  const t = useCallback(
    (path: string, params?: Record<string, string | number>) => translate(locale, path, params),
    [locale]
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
