"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import type { ReactNode } from "react";

export type Locale = "es" | "en";

type Dict = Record<string, unknown>;

const es: Dict = {
  app: { name: "Tabimichi 旅道", tagline: "Descubrí qué hacer hoy, cerca tuyo" },
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
    interestLabel: "Interés (opcional)",
    interestPlaceholder: "ej: pokemon, gatos, book off, snoopy…",
    interestHint: "Orientá la búsqueda a un tema: lugares que lo combinen suben al top.",
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
      multi: "Datos: {sources}",
    },
    sourceName: {
      google: "Google Places",
      geoapify: "Geoapify",
      overpass: "OpenStreetMap",
      cache: "cache local",
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
    reviewsLabel: "reseñas",
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
    guideButton: "🧠 Preguntale al guía",
    guideRegenerate: "🔁 Regenerar resumen del guía",
  },
  detail: {
    close: "Cerrar",
    back: "Volver",
  },
  sheet: {
    results: "Resultados",
    placesCount: "{n} lugares",
  },
  profile: {
    title: "Tus gustos",
    hint: "Ajustá el peso de cada tipo — también se aprende solo con 👍/👎.",
    reset: "Resetear todo",
  },
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
    closedNow: "Cerrado ahora",
    profileLiked: "Coincide con tu perfil ({type})",
    keywordMatch: "Coincide con tu interés ({kw})",
    chain: "Cadena conocida",
    hotel: "Es un alojamiento, no una atracción",
  },
  status: {
    discovering: "Buscando lugares…",
    guideThinking: "El guía está escribiendo el resumen…",
    error: "No se pudo obtener datos. Probá de nuevo.",
    empty: "No encontramos lugares con esos filtros. Probá otra zona o tipo.",
    keywordMiss: "No encontramos nada para «{kw}» en tu zona — te mostramos lo mejor cerca.",
    emptyClosed: "A esta hora todo está cerrado. Probá otro horario — o usá el simulador para ver el día.",
    emptyFar: "Lo que está abierto queda lejos para tu tiempo disponible. Ampliá el tiempo o cambiá de transporte.",
    geocodeError: "No encontramos ese lugar.",
  },
  settings: {
    title: "Ajustes",
    intro:
      "Con sesión, tus API keys se guardan por usuario en Supabase y solo vos podés verlas. Sin sesión usamos las variables de entorno del servidor.",
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
    remove: "Quitar",
    removed: "Eliminada ✓",
  },
  auth: {
    loginTitle: "🔑 Iniciar sesión",
    registerTitle: "🆕 Crear cuenta",
    forgotTitle: "🔁 Recuperar contraseña",
    email: "Email",
    password: "Contraseña",
    passwordMin: "mínimo 8 caracteres",
    login: "Iniciar sesión",
    register: "Crear cuenta",
    sendReset: "Enviar link de recuperación",
    forgot: "¿Olvidaste tu contraseña?",
    forgotHint:
      "Te enviamos un link por email para elegir una contraseña nueva. Al hacer clic vas a poder cambiarla acá.",
    resetSent:
      "📬 Si existe una cuenta con ese email, te enviamos un link de recuperación.",
    noAccount: "¿No tenés cuenta?",
    createOne: "Crear una",
    haveAccount: "¿Ya tenés cuenta?",
    loginInstead: "Iniciar sesión",
    backToLogin: "← Volver a iniciar sesión",
    registerConfirm: "📬 Cuenta creada. Revisá tu email para confirmar.",
    needLoginForKeys: "🔐 Inicia sesión para gestionar tus API keys",
    needLoginForKeysHint: "Tus keys se guardan de forma segura y solo vos podés verlas.",
    sessionActive: "✅ Sesión activa: {email}",
    sessionActiveHint: "Tus API keys se guardan de forma segura en tu cuenta.",
    signOut: "Cerrar sesión",
  },
  account: {
    title: "Mi cuenta",
    displayName: "Nombre",
    displayNamePlaceholder: "Tu nombre",
    save: "Guardar nombre",
    saved: "Nombre guardado ✓",
    changeEmail: "Cambiar email",
    changeEmailHint: "Te enviamos un link de confirmación al email nuevo.",
    newEmail: "Email nuevo",
    emailChanged: "📬 Revisá tu email nuevo para confirmar el cambio.",
    changePassword: "Cambiar contraseña",
    changePasswordHint: "Elegí una contraseña nueva (mínimo 8 caracteres).",
    newPassword: "Contraseña nueva",
    confirmPassword: "Repetí la contraseña",
    passwordsMismatch: "Las contraseñas no coinciden.",
    passwordChanged: "Contraseña actualizada ✓",
    passwordTooShort: "La contraseña debe tener al menos 8 caracteres.",
    recoveryTitle: "🔑 Elegí tu contraseña nueva",
    recoveryHint: "Estás acá porque pediste recuperar tu cuenta. Definí tu nueva contraseña:",
    setPassword: "Guardar contraseña nueva",
    dangerTitle: "Zona de peligro",
    deleteTitle: "Eliminar cuenta",
    deleteHint:
      "Se borran tu cuenta, tus API keys, tus gustos y tus votos de forma permanente. Esta acción no se puede deshacer.",
    deleteConfirm: "Escribí ELIMINAR para confirmar",
    deleteWrong: "Escribí ELIMINAR para poder borrar la cuenta.",
    deleteButton: "Eliminar mi cuenta",
    deleting: "Eliminando…",
    deleted: "Cuenta eliminada. ¡Hasta pronto!",
  },
  admin: {
    title: "Administración",
    backToSettings: "← Volver a Ajustes",
    onlyAdmins: "⛔ Esta sección es solo para administradores.",
    needLogin: "🔐 Iniciá sesión como administrador para ver esta sección.",
    searchPlaceholder: "Buscar por email…",
    search: "Buscar",
    role: "Rol",
    registered: "Registro",
    lastSeen: "Último acceso",
    status: "Estado",
    active: "Activo",
    banned: "Suspendido",
    unconfirmed: "Sin confirmar",
    actions: "Acciones",
    promote: "Hacer admin",
    demote: "Quitar admin",
    ban: "Suspender",
    unban: "Reactivar",
    deleteUser: "Eliminar",
    confirmDelete: "¿Eliminar a {email}? No se puede deshacer.",
    you: " (vos)",
    prev: "← Anterior",
    next: "Siguiente →",
    noUsers: "No hay usuarios.",
    pageInfo: "Página {page}",
  },
  map: {
    nearby: "Cerca de tu zona",
    youAreHere: "Estás acá",
    approx: "Ubicación aproximada (dirección buscada)",
    exact: "Ubicación exacta (GPS)",
    locate: "Centrar en mi ubicación",
    tiles: {
      esri: "Esri (EN)",
      osm: "OSM",
      voyager: "Voyager",
      positron: "Positron",
      satellite: "Satélite",
    },
  },
};

const en: Dict = {
  app: { name: "Tabimichi 旅道", tagline: "Discover what to do today, nearby" },
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
    interestLabel: "Interest (optional)",
    interestPlaceholder: "e.g. pokemon, cats, book off, snoopy…",
    interestHint: "Orient the search to a topic: matching places rise to the top.",
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
      multi: "Data: {sources}",
    },
    sourceName: {
      google: "Google Places",
      geoapify: "Geoapify",
      overpass: "OpenStreetMap",
      cache: "local cache",
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
    reviewsLabel: "reviews",
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
    guideButton: "🧠 Ask the guide",
    guideRegenerate: "🔁 Regenerate guide summary",
  },
  detail: {
    close: "Close",
    back: "Back",
  },
  sheet: {
    results: "Results",
    placesCount: "{n} places",
  },
  profile: {
    title: "Your tastes",
    hint: "Tune the weight of each type — it also learns from 👍/👎 votes.",
    reset: "Reset all",
  },
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
    closedNow: "Closed now",
    profileLiked: "Matches your profile ({type})",
    keywordMatch: "Matches your interest ({kw})",
    chain: "Known chain",
    hotel: "Accommodation, not an attraction",
  },
  status: {
    discovering: "Looking for places…",
    guideThinking: "The guide is writing the summary…",
    error: "Could not fetch data. Try again.",
    empty: "No places found with these filters. Try another area or type.",
    keywordMiss: "Nothing found for «{kw}» near you — showing the best of the area instead.",
    emptyClosed: "Everything is closed at this hour. Try another time — or use the simulator to preview the day.",
    emptyFar: "What's open is too far for your available time. Increase the time or change transport.",
    geocodeError: "Could not find that place.",
  },
  settings: {
    title: "Settings",
    intro:
      "When signed in, your API keys are stored per-user in Supabase and only you can see them. Without a session we use the server environment variables.",
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
    remove: "Remove",
    removed: "Removed ✓",
  },
  auth: {
    loginTitle: "🔑 Sign in",
    registerTitle: "🆕 Create account",
    forgotTitle: "🔁 Reset password",
    email: "Email",
    password: "Password",
    passwordMin: "minimum 8 characters",
    login: "Sign in",
    register: "Create account",
    sendReset: "Send recovery link",
    forgot: "Forgot your password?",
    forgotHint:
      "We'll email you a link to choose a new password. After clicking it you can change it here.",
    resetSent:
      "📬 If an account exists with that email, we sent you a recovery link.",
    noAccount: "Don't have an account?",
    createOne: "Create one",
    haveAccount: "Already have an account?",
    loginInstead: "Sign in",
    backToLogin: "← Back to sign in",
    registerConfirm: "📬 Account created. Check your email to confirm.",
    needLoginForKeys: "🔐 Sign in to manage your API keys",
    needLoginForKeysHint: "Your keys are stored securely and only you can see them.",
    sessionActive: "✅ Active session: {email}",
    sessionActiveHint: "Your API keys are stored securely in your account.",
    signOut: "Sign out",
  },
  account: {
    title: "My account",
    displayName: "Name",
    displayNamePlaceholder: "Your name",
    save: "Save name",
    saved: "Name saved ✓",
    changeEmail: "Change email",
    changeEmailHint: "We'll send a confirmation link to the new email.",
    newEmail: "New email",
    emailChanged: "📬 Check your new email to confirm the change.",
    changePassword: "Change password",
    changePasswordHint: "Choose a new password (minimum 8 characters).",
    newPassword: "New password",
    confirmPassword: "Repeat password",
    passwordsMismatch: "Passwords don't match.",
    passwordChanged: "Password updated ✓",
    passwordTooShort: "Password must be at least 8 characters.",
    recoveryTitle: "🔑 Choose your new password",
    recoveryHint: "You're here because you asked to recover your account. Set your new password:",
    setPassword: "Save new password",
    dangerTitle: "Danger zone",
    deleteTitle: "Delete account",
    deleteHint:
      "Your account, API keys, tastes and votes are permanently deleted. This cannot be undone.",
    deleteConfirm: "Type DELETE to confirm",
    deleteWrong: "Type DELETE to be able to delete the account.",
    deleteButton: "Delete my account",
    deleting: "Deleting…",
    deleted: "Account deleted. Goodbye!",
  },
  admin: {
    title: "Administration",
    backToSettings: "← Back to Settings",
    onlyAdmins: "⛔ This section is for administrators only.",
    needLogin: "🔐 Sign in as an administrator to view this section.",
    searchPlaceholder: "Search by email…",
    search: "Search",
    role: "Role",
    registered: "Registered",
    lastSeen: "Last seen",
    status: "Status",
    active: "Active",
    banned: "Suspended",
    unconfirmed: "Unconfirmed",
    actions: "Actions",
    promote: "Make admin",
    demote: "Remove admin",
    ban: "Suspend",
    unban: "Reactivate",
    deleteUser: "Delete",
    confirmDelete: "Delete {email}? This cannot be undone.",
    you: " (you)",
    prev: "← Previous",
    next: "Next →",
    noUsers: "No users.",
    pageInfo: "Page {page}",
  },
  map: {
    nearby: "Near your area",
    youAreHere: "You are here",
    approx: "Approximate position (searched address)",
    exact: "Exact position (GPS)",
    locate: "Center on my location",
    tiles: {
      esri: "Esri (EN)",
      osm: "OSM",
      voyager: "Voyager",
      positron: "Positron",
      satellite: "Satellite",
    },
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

const LOCALE_KEY = "tabi.locale";

/** Locale lives in BOTH a cookie and localStorage:
 *  - the cookie lets the server (layout.tsx) render the page in the user's
 *    language from the start, so the SSR HTML and the first client render
 *    always agree (no hydration mismatch, no locale flash);
 *  - localStorage keeps the pre-cookie behavior and cross-tab sync.
 *  `readStoredLocale` returns null when nothing is stored, so the store can
 *  fall back to the server-provided `initialLocale` (the cookie value). */
function subscribeLocale(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

function readStoredLocale(): Locale | null {
  try {
    const v = localStorage.getItem(LOCALE_KEY);
    return v === "en" || v === "es" ? v : null;
  } catch {
    return null; // private mode
  }
}

export function I18nProvider({
  children,
  initialLocale,
}: {
  children: ReactNode;
  /** Locale the server rendered with (read from the `tabi.locale` cookie). */
  initialLocale: Locale;
}) {
  // During SSR and hydration React uses getServerSnapshot — the same value the
  // server rendered with — so the client's first render always matches the
  // HTML. After hydration, getSnapshot (localStorage) may correct it.
  const locale = useSyncExternalStore<Locale>(
    subscribeLocale,
    () => readStoredLocale() ?? initialLocale,
    () => initialLocale
  );

  useEffect(() => {
    // Keep <html lang> in sync after a client-side switch (the root layout's
    // <html> is server-owned and doesn't re-render on the client).
    document.documentElement.lang = locale;
    // Migrate legacy users who set the locale before cookies existed: persist
    // the stored value to the cookie so the NEXT full load renders correctly.
    try {
      const saved = readStoredLocale();
      if (saved && saved !== initialLocale) {
        document.cookie = `${LOCALE_KEY}=${saved}; path=/; max-age=31536000; SameSite=Lax`;
      }
    } catch {
      // private mode
    }
  }, [locale, initialLocale]);

  const setLocale = useCallback((l: Locale) => {
    try {
      localStorage.setItem(LOCALE_KEY, l);
      document.cookie = `${LOCALE_KEY}=${l}; path=/; max-age=31536000; SameSite=Lax`;
    } catch {
      // private mode
    }
    // `storage` events only fire in *other* tabs — notify this tab's store
    window.dispatchEvent(new Event("storage"));
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
