import type { Config } from "tailwindcss";
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: { extend: { colors: { bg: "#F8FAFC", ink: "#0F172A", line: "#E2E8F0", accent: "#DC2626" } } },
} satisfies Config;
