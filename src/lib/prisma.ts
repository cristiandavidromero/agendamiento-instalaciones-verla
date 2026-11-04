import { PrismaClient } from "@prisma/client";

// Una sola instancia por proceso; en desarrollo se reutiliza entre recargas de Next.js.
const globalParaPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalParaPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalParaPrisma.prisma = prisma;
}
