# Auditoría de Seguridad — Tabimichi (tabi)

**Fecha:** 2026-08-18
**Alcance:** código fuente (`src/`), migraciones Supabase, configuración (Next.js, Vercel, Supabase, GitHub Actions), dependencias y prácticas de gestión de secretos.
**Metodología:** revisión estática manual de las rutas de API, políticas RLS, manejo de secretos e historial git; escaneo de dependencias con `npm audit`.

---

## Resumen ejecutivo

| Nivel | Cantidad |
| --- | --- |
| Crítico | 0 |
| Alto | 2 |
| Medio | 4 |
| Bajo / Informativo | 8 |

La base es sólida: secretos bien excluidos de git, RLS de Supabase correcta y granular, consultas SQL parametrizadas (sin SQLi), sin XSS de salida (React por defecto, sin `dangerouslySetInnerHTML`), y 0 vulnerabilidades conocidas en dependencias. Los dos hallazgos Altos están relacionados con **abuso de recursos del servidor**: un SSRF a través del endpoint Overpass configurable por el usuario y la ausencia de autenticación/rate-limiting en los endpoints que consumen las claves API del propietario.

---

## Hallazgos

### 🔴 ALTO

#### A1. SSRF mediante `overpass_endpoint` controlable por el usuario

- **Dónde:** `src/app/api/user-keys/route.ts` (POST acepta `overpassEndpoint`) → `src/lib/places/index.ts:56` (`setOverpassEndpoint(config.overpassEndpoint)`) → `src/lib/places/overpass.ts:133` (`fetch(endpoint, { method: "POST", body: query })`).
- **Qué pasa:** cualquier usuario autenticado (el registro está abierto) guarda su propio `overpass_endpoint` —**sin validación de esquema ni de host**— y luego, al llamar `/api/recommend` (forzando el fallback a Overpass, p. ej. con coordenadas donde Google no devuelve resultados), el servidor hace un `POST` HTTP a esa URL arbitraria. La respuesta se parsea como JSON de Overpass y **parte de ella (nombres, coordenadas) se devuelve en la respuesta de la API**.
- **Impacto:** lectura de respuestas JSON de servicios internos (metadata de cloud `http://169.254.169.254/...`, servicios en localhost/red interna), escaneo de red interna y abuso de infraestructura. En Vercel el acceso a IMDS suele estar bloqueado, pero en despliegues self-hosted (el proyecto soporta `node start` + SQLite local) el impacto es pleno.
- **Agravante:** `setOverpassEndpoint` escribe una variable **global de módulo** (`customEndpoint`), no aislada por petición → contaminación de configuración entre peticiones concurrentes de distintos usuarios (también hallazgo M3).

#### A2. Endpoints de alto coste sin autenticación ni rate limiting

- **Dónde:** `src/app/api/recommend/route.ts`, `src/app/api/narrate/route.ts` (y en menor medida `geocode`, `photos`, `photo`).
- **Qué pasa:** los endpoints no exigen token; si no hay token (o el usuario no tiene claves), **caen a las claves del propietario vía `process.env`** (`getKeysForRequest`). No existe ningún rate limiting en la aplicación (verificado por grep: solo manejo de 429 del proveedor).
- **Impacto:** un atacante anónimo puede agotar la cuota/crédito del propietario con pocas peticiones: `narrate` dispara llamadas LLM (OpenCode) de hasta 1200 tokens de salida cada una; `recommend` hace múltiples llamadas paginadas a Google Places (crédito mensual) y Geoapify (3.000/día). Es un vector de **agotamiento de coste/disponibilidad**.

---

### 🟠 MEDIO

#### M1. `/api/logs` sin autenticación (fuga de información)

- **Dónde:** `src/app/api/logs/route.ts` + `src/lib/logger.ts` (JSONL persistido en `data/logs/requests.jsonl`).
- **Qué pasa:** la ruta devuelve el tail de todos los logs sin token. Los registros incluyen **consultas de geocoding del usuario, coordenadas lat/lng, traceIds y errores internos** (`error: String(e)`).
- **Impacto:** en self-hosted es una fuga de privacidad e información interna real. En Vercel el FS es efímero/read-only y probablemente devuelva `[]`, pero la ruta de depuración no debería estar expuesta en producción. Mitigación: exigir rol admin o eliminar la ruta en producción.

#### M2. Registro abierto sin confirmación de email + contraseñas débiles

- **Dónde:** `supabase/config.toml` → `[auth] enable_signup = true`, `[auth.email] enable_confirmations = false`; `minimum_password_length = 6` (sin requisitos de complejidad).
- **Qué pasa:** cualquier persona crea cuentas al instante con un email arbitrario, lo que hace triviales los vectores A1 y A2 (abuso masivo). Las contraseñas de 6 caracteres son débiles.
- **Acción:** activar confirmación de email, subir a 8+ caracteres (recomendado 12) y **verificar que el proyecto remoto de Supabase refleja estos ajustes** (este `config.toml` es el local; los settings remotos se gestionan en el Dashboard).

#### M3. Estado global compartido entre usuarios (aislamiento roto)

- **Dónde:** `src/lib/places/overpass.ts:31` (`let customEndpoint`) y `index.ts:56`.
- **Qué pasa:** la configuración por usuario se inyecta en una variable de módulo; en un servidor Node de larga vida, peticiones concurrentes de usuarios distintos pueden leer el endpoint de otro usuario (correctitud y aislamiento). En serverless el impacto es menor pero el diseño es frágil.
- **Acción:** pasar el endpoint como parámetro de función en lugar de estado global.

#### M4. Ausencia de cabeceras de seguridad

- **Dónde:** `next.config.ts` (vacío) y `vercel.json` (solo `Cache-Control` para `/api`).
- **Qué falta:** CSP, `X-Frame-Options`/`frame-ancestors` (clickjacking), `Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`.
- **Impacto:** sin CSP, una eventual XSS no tiene mitigación de segundo nivel; sin frame-ancestors, la app puede ser embebida en iframes de terceros (clickjacking). Acción: definir `headers()` en `next.config.ts`.

---

### 🟡 BAJO / INFORMATIVO

| ID | Hallazgo | Detalle |
| --- | --- | --- |
| B1 | Errores internos al cliente | `/api/narrate` y `/api/photo` devuelven `error: String(e)` (posible fuga de detalles del proveedor/URLs). Usar mensajes genéricos y loguear el detalle. |
| B2 | Prompt injection en LLM | Nombres de lugares (datos de terceros: OSM/Google) y `keyword` se interpolan en el prompt que se ejecuta con la clave del propietario. Impacto limitado (la salida solo se parsea como JSON de narración), pero conviene delimitar el contenido de terceros. |
| B3 | Claves API en claro en BD | `api_keys.key_value` sin cifrado a nivel de columna (el cifrado en reposo lo provee la infraestructura de Supabase). Considerar `pgcrypto`/Vault si se requiere defensa en profundidad. |
| B4 | JWT en localStorage | Sesión de Supabase en `localStorage` (comportamiento por defecto) → expuesta ante XSS. Mitigación principal: CSP estricta (M4). Práctica estándar, anotada por completitud. |
| B5 | Datos de geolocalización y búsquedas en logs | `logEntry` persiste `query`, `lat`, `lng` del usuario. Combinado con M1, es un problema de privacidad. Considerar anonimización/rotación de logs. |
| B6 | `/api/geocode`, `/api/photo`, `/api/photos` públicos | Sin auth ni rate limit: abuso de Nominatim (política de uso), del proxy de fotos y consumo de la clave Google del propietario. Parte del hallazgo A2. |
| B7 | `EXECUTE` público en funciones trigger | `update_updated_at()`, `handle_new_user()`, `sync_user_email()` mantienen el grant por defecto a `PUBLIC` en Postgres. Llamadas directas fallan (referencian `NEW`), pero por higiene conviene `REVOKE EXECUTE ... FROM PUBLIC`. |
| B8 | `profiles.email` en claro | El email se copia a `profiles` (visible al propio usuario y a admins). Esperado, pero mantener el principio de mínimo privilegio al exponer columnas en las consultas. |

---

## Aspectos verificados y correctos ✅

- **Secretos:** `.env*`, `data/`, `.vercel/`, `supabase/.temp/` están en `.gitignore`; **nada sensible está trackeado ni aparece en el historial git** (verificado con `git rev-list --all --objects`). El `.env.local` local no está commiteado.
- **Dependencias:** `npm audit` → **0 vulnerabilidades** (Next 16.3.1, React 19.2.8, supabase-js 2.112.3).
- **Inyección SQL:** SQLite (`src/lib/db.ts`) usa exclusivamente consultas parametrizadas (`?`); las consultas a Supabase van por el cliente tipado.
- **RLS de Supabase:** correcta y granular en `api_keys`, `profiles`, `feedback`, `profile_weights` (solo dueño; admins vía `public.is_admin()` con `security definer` + `search_path` fijado). Sin grants a `anon`.
- **Privilegio de administración:** `requireAdmin` valida el rol en servidor con el cliente service-role (no confía en claims del JWT); bloquea auto-modificación/auto-eliminación en `/api/admin/users/[id]`. Sin escalada posible vía `update_display_name` (solo `display_name`, solo fila propia, tope 40 chars).
- **Path traversal:** `photoCachePath` sanea `id` y `ref` (solo `[a-zA-Z0-9_-]`, recorte de longitud).
- **XSS de salida:** sin `dangerouslySetInnerHTML`/`innerHTML` en todo `src/`; React escapa por defecto.
- **Caché/privacidad:** `Cache-Control: no-store` en todas las rutas `/api` (vercel.json).
- **Auth general:** JWT con expiración 1 h, rotación de refresh habilitada, `SameSite=Lax` en la cookie de locale, eliminación de cuenta vía service-role server-side.

---

## Recomendaciones priorizadas

1. **Neutralizar el SSRF (A1):** validar `overpass_endpoint` — solo esquema `https://`, host en allowlist (los mirrors públicos conocidos o un dominio propio), resolución DNS y bloqueo de rangos privados/reservados (`10/8`, `172.16/12`, `192.168/16`, `127/8`, `169.254/16`, `::1`, `fc00::/7`, `fe80::/10`). Alternativa más simple: eliminar el endpoint por-usuario y usar solo los mirrors fijos + `OVERPASS_ENDPOINT` de entorno (controlado por el operador).
2. **Rate limiting + auth para coste (A2):** añadir límites por IP/token en todas las rutas `/api` (p. ej. Upstash Ratelimit + Vercel KV, o middleware), y **no** usar las claves del propietario para peticiones anónimas (o exigir token para `recommend`/`narrate`).
3. **Proteger o eliminar `/api/logs` (M1).**
4. **Endurecer auth (M2):** confirmación de email obligatoria, `minimum_password_length >= 8`, y auditar los settings del proyecto remoto.
5. **Cabeceras de seguridad (M4)** en `next.config.ts`: CSP (`default-src 'self'; img-src 'self' data: https://*.tile.openstreetmap.org https://*.basemaps.cartocdn.com https://*.arcgisonline.com; connect-src 'self' https://*.supabase.co; frame-ancestors 'none'; base-uri 'self'`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Strict-Transport-Security`, `Permissions-Policy`.
6. **Aislar la configuración por usuario (M3):** pasar `overpassEndpoint` como parámetro, eliminar el estado global.
7. **Errores genéricos al cliente (B1)** y delimitar datos de terceros en prompts (B2).
8. **Higiene SQL (B7):** `REVOKE EXECUTE ON FUNCTION update_updated_at() FROM PUBLIC;` (y las otras funciones trigger).

---

## Estado de remediación (2026-08-18)

Cambios aplicados en el código:

- **A1 / M3 — SSRF y estado global:** `overpass_endpoint` se valida al guardarlo (`src/app/api/user-keys/route.ts`, solo `https:`, sin credenciales, sin IPs privadas literales) y se re-verifica contra rangos privados/reservados al usarlo (`src/lib/security.ts` → `assertResolvedPublic`). El endpoint ya no es estado global de módulo: viaja como opción por petición (`overpass.ts`), marcado como *trusted* solo cuando proviene de env del operador; si el guard falla, se usan los mirrors públicos.
- **A2 — Coste/abuso:** rate limiting en memoria (ventana fija por IP y por usuario autenticado) en todas las rutas `/api` (`src/lib/security.ts` → `enforceRateLimit`; límites en cada ruta: recommend 15/min, narrate 10/min, geocode 30/min, photo 120/min, etc.). Nota: el contador es por instancia — en Vercel serverless es *best-effort*; para garantía dura usar un store compartido (Upstash/Vercel KV). `narrate` limita `places` a 12.
- **M1 — `/api/logs`:** ahora exige rol admin (`requireAdmin`). El smoke test tolera 401/403.
- **B1 — Errores internos:** `/api/recommend`, `/api/narrate`, `/api/photo`, `/api/feedback`, `/api/profile` devuelven mensajes genéricos; el detalle se loguea en servidor.
- **B2 — Prompt LLM:** el system prompt instruye tratar nombres/tags de lugares como datos, no como instrucciones.
- **M4 — Cabeceras de seguridad:** CSP estricta con nonce por petición (`src/proxy.ts`, siguiendo la guía oficial de Next) + `X-Frame-Options: DENY`, `nosniff`, HSTS, `Referrer-Policy`, `Permissions-Policy`, COOP/CORP, `poweredByHeader: false` (`next.config.ts`).
- **M2 — Auth:** `enable_confirmations = true`, `minimum_password_length = 8` + `password_requirements = letters_digits` (`supabase/config.toml`); formularios e i18n actualizados a 8 caracteres. **Pendiente de aplicar en el proyecto remoto** (Dashboard de Supabase) y de configurar SMTP para el envío de emails de confirmación en producción.
- **B7 — Grants SQL:** `supabase/migrations/003_security_hardening.sql` revoca `EXECUTE` a `PUBLIC` de las funciones trigger.

Verificación: `npm test` (209 tests), `npm run lint` (0 errores) y `npm run build` (Next 16.3.1, proxy incluido) pasan; cabeceras y nonce verificados en vivo.

---

## Notas de verificación pendientes (requieren acceso externo)

- Confirmar en el **Dashboard de Supabase remoto**: `enable_signup`, `enable_confirmations`, `minimum_password_length`, allowlist de redirect URLs, y que el `SUPABASE_SERVICE_ROLE_KEY` de producción está rotado y limitado.
- Confirmar que las variables de entorno en **Vercel** (`SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_PLACES_API_KEY`, `OPENCODE_*`) son secretos de entorno (no `NEXT_PUBLIC_*` salvo URL/anon) y están rotadas periódicamente.
- El service-role key en `.env.local` local es para desarrollo local; si el proyecto remoto usa las mismas credenciales, rotarlas.
