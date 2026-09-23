import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import "./design-system.css";

const interTight = localFont({
  src: './fonts/inter-tight-normal.woff2',
  weight: '100 900',
  display: 'swap',
  variable: "--font-sans",
});

const fraunces = localFont({
  src: [
    { path: './fonts/fraunces-normal.woff2', weight: '100 900', style: 'normal' },
    { path: './fonts/fraunces-italic.woff2', weight: '100 900', style: 'italic' },
  ],
  display: 'swap',
  variable: "--font-display",
});

const jetbrainsMono = localFont({
  src: './fonts/jetbrains-mono-normal.woff2',
  weight: '100 800',
  display: 'swap',
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Hired Billing Support | CRM",
  description: "Practice relationships, sales, and revenue management.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en" data-theme="dark" suppressHydrationWarning
      className={`${interTight.variable} ${fraunces.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try {
  const theme = localStorage.getItem('theme')
  if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme)
} catch {}`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
