# Bundled fonts

These are the Latin variable WOFF2 fonts used by the existing design: Inter Tight, Fraunces (normal and italic), and JetBrains Mono. Their Google Fonts download URLs are recorded in `sources.json`. Each family includes its SIL Open Font License and copyright notice in the corresponding `*-OFL.txt` file.

Next.js loads these files with `next/font/local`; production builds no longer download fonts. Other character sets use the existing CSS fallback fonts.
