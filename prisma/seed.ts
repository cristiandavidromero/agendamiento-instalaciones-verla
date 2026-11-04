import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Los datos de ejemplo (ciudades, contratistas, cuadrillas) se agregan en el Hito 1.
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
