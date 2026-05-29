/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        constructa: {
          primary:       "#FF6B35",
          dark:          "#37474F",
          warning:       "#FFA726",
          success:       "#43A047",
          progress:      "#FB8C00",
          danger:        "#E53935",
          info:          "#1E88E5",
          bg:            "#F5F3EF",
          surface:       "#EAE7E0",
          border:        "#C8C0B4",
          secondaryText: "#7A7068",
          text:          "#1E1A16",
        },
      },
      boxShadow: {
        card: "0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)",
        "card-md": "0 4px 12px rgba(0,0,0,0.08)",
      },
      borderRadius: {
        industrial: "4px",
      },
      fontFamily: {
        display: ["Plus Jakarta Sans", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      keyframes: {
        fadeInUp: {
          "0%": { opacity: "0", transform: "translateY(18px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
      },
      animation: {
        "fade-in-up": "fadeInUp 0.55s ease-out forwards",
        "fade-in": "fadeIn 0.4s ease-out forwards",
      },
    },
  },
  plugins: [],
};
