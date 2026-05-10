import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "#f0ebe2",
        ink: "#1c1a16",
        mid: "#7a7268",
        dim: "#c0b9ae",
        line: "#ddd7cc",
        accent: "#8c3a20",
        panel: "#faf7f2",
        "bg-dark": "#141210",
        "ink-dark": "#e8e2d8",
        "accent-dark": "#d4622a",
      },
      fontFamily: {
        serif: ['"Cormorant Garamond"', "Georgia", "serif"],
        mono: ['"DM Mono"', "ui-monospace", "monospace"],
      },
      transitionTimingFunction: {
        snap: "cubic-bezier(.16,1,.3,1)",
      },
    },
  },
  plugins: [],
};

export default config;
