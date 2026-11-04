import type { Metadata } from "next";
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
      <body>{children}</body>
    </html>
  );
}
