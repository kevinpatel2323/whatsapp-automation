import type { Config } from "tailwindcss";

export default {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-body)", "Inter", "system-ui", "sans-serif"],
        display: [
          "NeueHaasGrotesk",
          "var(--font-display)",
          "Inter",
          "system-ui",
          "sans-serif",
        ],
        body: ["var(--font-body)", "Inter", "system-ui", "sans-serif"],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        card: {
          DEFAULT: "var(--card)",
          foreground: "var(--card-foreground)",
        },
        popover: {
          DEFAULT: "var(--popover)",
          foreground: "var(--popover-foreground)",
        },
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
        },
        secondary: {
          DEFAULT: "var(--secondary)",
          foreground: "var(--secondary-foreground)",
        },
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          foreground: "var(--accent-foreground)",
        },
        destructive: "var(--destructive)",
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
        chart: {
          "1": "var(--chart-1)",
          "2": "var(--chart-2)",
          "3": "var(--chart-3)",
          "4": "var(--chart-4)",
          "5": "var(--chart-5)",
        },
        // Design system surface / accent / text tokens
        void: "#050708",
        "deep-teal": "#061012",
        "dark-forest": "#0a1a1c",
        forest: "#122a28",
        "card-border": "#1f3533",
        "neon-green": "#36f4a4",
        "muted-text": "#9ca3af",
        "shade-50": "#6b7280",
        "shade-70": "#3f4a48",
      },
      boxShadow: {
        card: "inset 0 1px 0 rgba(255,255,255,0.04), 0 12px 40px -12px rgba(0,0,0,0.45), 0 0 0 1px rgba(54,244,164,0.05)",
      },
    },
  },
  plugins: [],
} satisfies Config;
