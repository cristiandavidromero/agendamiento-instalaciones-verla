import { execSync } from "node:child_process";
import "./env";

// Aplica las migraciones a la BD de pruebas una vez antes de todas las suites.
export default function setup() {
  execSync("npx prisma migrate deploy", { stdio: "inherit", env: process.env });
}
