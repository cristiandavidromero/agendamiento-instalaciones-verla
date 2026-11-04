import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agendamiento de instalaciones",
  description: "Asignación automática de cuadrillas y franjas al cerrar una venta",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body>
        <header className="encabezado">
          <nav>
            <Link href="/" className="marca">
              Agendamiento de instalaciones
            </Link>
            <Link href="/">Cerrar venta</Link>
            <Link href="/agenda">Agenda</Link>
            <Link href="/admin">Administración</Link>
          </nav>
        </header>
        <main className="contenido">{children}</main>
      </body>
    </html>
  );
}
