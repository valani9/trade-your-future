import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: "#0A0B0D",
        surface: "#14161A",
        raised: "#1C1F25",
        line: "rgba(255,255,255,0.08)",
        ink: "#F5F5F7",
        muted: "#8A8F98",
        faint: "#5C616B",
        coral: "#FF5A4E",
        slate: "#7C8CFF",
        mint: "#34D399",
      },
      borderRadius: { card: "24px", btn: "14px", pill: "999px" },
      boxShadow: { soft: "0 20px 60px rgba(0,0,0,0.45)" },
      fontFamily: { sans: ["var(--font-inter)", "Inter", "system-ui", "sans-serif"] },
      letterSpacing: { tightest: "-0.03em", tighter: "-0.02em" },
      transitionTimingFunction: { out: "cubic-bezier(0.22, 1, 0.36, 1)" },
      maxWidth: { app: "430px" },
      keyframes: {
        shimmer: { "0%": { opacity: "0.45" }, "50%": { opacity: "0.9" }, "100%": { opacity: "0.45" } },
        rise: { "0%": { opacity: "0", transform: "translateY(8px)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
        sheet: { "0%": { transform: "translateY(100%)" }, "100%": { transform: "translateY(0)" } },
      },
      animation: {
        shimmer: "shimmer 1.6s ease-in-out infinite",
        rise: "rise 240ms cubic-bezier(0.22,1,0.36,1) both",
        sheet: "sheet 260ms cubic-bezier(0.22,1,0.36,1) both",
      },
    },
  },
  plugins: [],
};
export default config;
