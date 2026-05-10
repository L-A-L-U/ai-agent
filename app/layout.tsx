import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Ops Agent — ai.lalu.dev",
  description:
    "Agente de operaciones con acceso de solo lectura al homelab de Luis Eduardo García. Live tool-use sobre infraestructura real.",
  openGraph: {
    title: "AI Ops Agent — ai.lalu.dev",
    description:
      "Habla con un agente que consulta en vivo el servidor casero de Luis: métricas, intrusiones SSH, geografía de ataques.",
    url: "https://ai.lalu.dev",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;1,300;1,400;1,500&family=DM+Mono:wght@300;400&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
