import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";

// Puerto propio y sin reutilizar servidores: así nunca se prueba contra un `npm run dev`
// conectado a la BD de desarrollo.
const puerto = 3101;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  // Las pruebas comparten la BD de pruebas: una tras otra.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${puerto}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx next dev -p ${puerto}`,
    url: `http://localhost:${puerto}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { DATABASE_URL: process.env.DATABASE_URL_TEST ?? "" },
  },
});
