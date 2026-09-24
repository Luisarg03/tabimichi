import { defineConfig } from "vitest/config";
import path from "node:path";

/** Config separada: el bench mide calidad de ranking contra Google LIVE, así
 *  que no puede correr en `pnpm test` (gasta cuota y depende de la red).
 *  Se corre a mano: pnpm bench:ranking */
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["scripts/**/*.bench.ts"],
    testTimeout: 120000,
    hookTimeout: 120000,
  },
});
