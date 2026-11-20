import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: "#F6F5F2",
        surface: "#FFFFFF",
        raised: "#F1F0EC",
        line: "rgba(20,20,19,0.08)",
        ink: "#141413",
        muted: "#62625D",
        faint: "#76766F",
        coral: "#FF4D2E",
        slate: "#3D4BD6",
        mint: "#0E9F63",
      },
      borderRadius: { card: "32px", btn: "20px", pill: "999px" },
      boxShadow: {
        soft: "0 24px 48px -16px rgba(20,20,19,0.22), 0 2px 6px rgba(20,20,19,0.06)",
        card: "0 1px 2px rgba(20,20,19,0.04), 0 8px 24px -12px rgba(20,20,19,0.12)",
      },
      fontFamily: { sans: ["var(--font-sans)", "system-ui", "sans-serif"] },
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
