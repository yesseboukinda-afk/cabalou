import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cabalou",
  description: "Espace marketing local de Cabalou. Les contenus restent des brouillons jusqu’à leur validation.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
