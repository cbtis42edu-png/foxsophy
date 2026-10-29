import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Foxsophie",
  description: "Preguntas, ideas y respuestas para aprender en grupo.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body>{children}</body></html>;
}