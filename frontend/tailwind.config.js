/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        th: {
          page: "rgb(var(--th-page) / <alpha-value>)",
          base: "rgb(var(--th-base) / <alpha-value>)",
          raised: "rgb(var(--th-raised) / <alpha-value>)",
          line: "rgb(var(--th-line) / <alpha-value>)",
          "line-s": "rgb(var(--th-line-s) / <alpha-value>)",
          fg: "rgb(var(--th-fg) / <alpha-value>)",
          "fg-2": "rgb(var(--th-fg-2) / <alpha-value>)",
          "fg-3": "rgb(var(--th-fg-3) / <alpha-value>)",
          "fg-4": "rgb(var(--th-fg-4) / <alpha-value>)",
          "fg-muted": "rgb(var(--th-fg-muted) / <alpha-value>)",
          "fg-faint": "rgb(var(--th-fg-faint) / <alpha-value>)",
          accent: "rgb(var(--th-accent) / <alpha-value>)",
          "accent-fg": "rgb(var(--th-accent-fg) / <alpha-value>)",
          "accent-fg-2": "rgb(var(--th-accent-fg-2) / <alpha-value>)",
          "accent-fg-bright": "rgb(var(--th-accent-fg-bright) / <alpha-value>)",
          ok: "rgb(var(--th-ok) / <alpha-value>)",
          "ok-fg": "rgb(var(--th-ok-fg) / <alpha-value>)",
        },
      },
    },
  },
  plugins: [],
};
