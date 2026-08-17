#!/bin/bash
# Tabimichi — Vercel deployment setup
# Run: bash scripts/setup-vercel.sh

set -e

echo "╔══════════════════════════════════════════════╗"
echo "║  Tabimichi — Vercel Deployment Setup         ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# Check vercel CLI
if ! command -v vercel &> /dev/null && ! command -v npx &> /dev/null; then
  echo "❌ Install Vercel CLI: npm i -g vercel"
  exit 1
fi

echo "📋 Step 1: Login to Vercel"
echo "   You'll be redirected to vercel.com to authorize."
echo ""
vercel login

echo ""
echo "📋 Step 2: Link project to Vercel"
echo "   Answer the prompts:"
echo "   - Set up and deploy? → Y"
echo "   - Which scope? → select your account"
echo "   - Link to existing project? → N (create new)"
echo "   - Project name? → tabimichi"
echo "   - Directory? → ./."
echo "   - Override settings? → N"
echo ""
vercel link

echo ""
echo "📋 Step 3: Set environment variables (API keys)"
echo "   These stay on Vercel's servers — never exposed to the client."
echo ""

# Function to set env var
set_env() {
  local name=$1
  local desc=$2
  echo ""
  read -p "   $desc (leave blank to skip): " value
  if [ -n "$value" ]; then
    echo "$value" | vercel env add "$name" production
    echo "   ✅ $name set for production"
  else
    echo "   ⏭️  Skipped $name"
  fi
}

echo "   ── API Keys (optional, app works without them) ──"
set_env "GOOGLE_PLACES_API_KEY" "Google Places API key"
set_env "GEOAPIFY_API_KEY" "Geoapify API key"
set_env "OVERPASS_ENDPOINT" "Overpass endpoint (blank = public mirrors)"
set_env "OPENCODE_API_KEY" "OpenCode Zen (free LLM)"
set_env "OPENCODE_GO_API_KEY" "OpenCode Go (paid LLM)"

echo ""
echo "📋 Step 4: Get GitHub secrets for CI/CD"
echo ""
ORG_ID=$(cat .vercel/project.json 2>/dev/null | grep -o '"orgId":"[^"]*"' | cut -d'"' -f4)
PROJ_ID=$(cat .vercel/project.json 2>/dev/null | grep -o '"projectId":"[^"]*"' | cut -d'"' -f4)
echo "   Your Vercel project IDs:"
echo "   ┌─────────────────────────────────────────┐"
echo "   │  VERCEL_ORG_ID:     $ORG_ID"
echo "   │  VERCEL_PROJECT_ID: $PROJ_ID"
echo "   └─────────────────────────────────────────┘"
echo ""
echo "   Add these as GitHub Secrets:"
echo "   → https://github.com/Luisarg03/tabimichi/settings/secrets/actions"
echo ""
echo "   Required secrets:"
echo "   • VERCEL_TOKEN     — Get from https://vercel.com/account/tokens"
echo "   • VERCEL_ORG_ID    — $ORG_ID"
echo "   • VERCEL_PROJECT_ID — $PROJ_ID"
echo ""

echo "📋 Step 5: Deploy!"
echo ""
echo "   Preview (PR):   vercel"
echo "   Production:     vercel --prod"
echo ""
echo "   Or push to main — GitHub Actions will deploy automatically."
echo ""
echo "✅ Setup complete!"
