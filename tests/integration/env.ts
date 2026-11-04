import "dotenv/config";

// Las pruebas de integración siempre apuntan a la BD de pruebas, nunca a la de desarrollo.
if (!process.env.DATABASE_URL_TEST) {
  throw new Error("Falta DATABASE_URL_TEST (ver .env.example)");
}
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
