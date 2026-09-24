# Environments: develop → staging → main

Laboratorio de deploy para un solo usuario. Tres ramas fijas, rigor creciente.

```
feat/* ──PR──▶ develop ──PR──▶ staging ──PR──▶ main ──auto──▶ prod
              Preview         Preview               Production
              (sandbox)       (sandbox)             (prod)
```

| Rama | Workflow | Gates | Destino |
|------|----------|-------|---------|
| `develop` | `develop.yml` | typecheck + lint + test + build | Vercel Preview → Supabase sandbox `rjsrzuqyoyxuonvcrpec` |
| `staging` | `staging.yml` | lo de develop + migraciones + smoke vs build | Vercel Preview → Supabase sandbox |
| `main` | `ci.yml` + `deploy.yml` | typecheck + lint + test + build, deploy `--prod` automático | Vercel Production → Supabase prod `yfwslmehyaftomzmkafs` |

Las efímeras siguen como siempre: `feat/<slug>`, `fix/<slug>`, `chore/<slug>` desde `develop` (no desde `main`).

## Vercel (Hobby: 1 Production + N Previews)

Hobby no tiene staging cloud separado: `develop` y `staging` comparten el
pool de Preview. Configurar una sola vez en el dashboard:

- Project → Settings → Git → **Production Branch = `main`**.
- Preview deployments: habilitado para todas las ramas (default).
- Env vars: **Preview** → 5 vars del sandbox (`sb_*`); **Production** → 5 vars
  de prod. Verificar con `vercel env pull --environment=preview|production`
  y comparar valores, no nombres. `NEXT_PUBLIC_*` exige redeploy al cambiar.
- `develop`/`staging` nunca llevan `--prod`; solo `main` con `vercel-args: '--prod'`.

## Supabase

- Local: `supabase start` (dev y E2E browser).
- Sandbox `rjsrzuqyoyxuonvcrpec`: CLI + Preview. Migraciones primero acá.
- Prod `yfwslmehyaftomzmkafs`: solo `--project-ref` explícito, nunca `link`.
- `staging.yml` valida numeración `001…NNN` sin huecos y, si existe el secret
  `SUPABASE_ACCESS_TOKEN`, hace `db push --dry-run` al sandbox.

## Secrets (GitHub → Settings → Secrets and variables → Actions)

| Secret | Uso |
|--------|-----|
| `VERCEL_TOKEN` / `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` | `deploy.yml` (IDs buenos en la nota Bitwarden `Tabi admin`) |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | jobs `build` (valores sandbox; el build solo necesita presencia) |
| `SUPABASE_ACCESS_TOKEN` (opcional) | dry-run de migraciones en `staging` |

Fuente única de verdad: Bitwarden (`Tabi dev (local)`, `Tabi sandbox`,
`Tabi production`, `Tabi admin`). Los `.env` son artefactos (`pnpm secrets`).

## Branch protection (una vez, a mano)

- `develop`: require `Develop` verde para mergear PRs.
- `staging`: require `Staging` verde; solo recibe PRs desde `develop`.
- `main`: require `CI` verde; solo recibe PRs desde `staging`.
- Nunca push directo a las tres (todo entra por PR).

## Crear las ramas (una vez, tras mergear esto a main)

```bash
git switch main && git pull
git branch develop main
git branch staging main
git push origin develop staging   # solo esto se pushea directo; el resto va por PR
```

## Hotfix de prod

Sale de `main` (`fix/<slug>`), se mergea a `main` y luego se baja:
`main → staging → develop` (fast-forward o PR, en ese orden).
