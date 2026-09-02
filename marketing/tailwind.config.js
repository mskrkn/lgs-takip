/** @type {import('tailwindcss').Config} */
// EduPusula marka renk/tipografi sistemi.
// Bu proje şu an bir derleme (build) hattı kullanmıyor (statik HTML/JS);
// bu dosya ileride gerçek bir Tailwind CLI/PostCSS kurulumuna geçildiğinde
// doğrudan kullanılabilir. Şimdilik marketing/index.html içinde aynı
// değerler Tailwind'in Play CDN çalışma-zamanı config'i olarak da tanımlı.
module.exports = {
  content: [
    "./marketing/**/*.html",
  ],
  darkMode: ["selector", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: "#0F172A",
          50: "#F8FAFC",
          100: "#F1F5F9",
          200: "#E2E8F0",
          400: "#94A3B8",
          600: "#475569",
          800: "#1E293B",
          900: "#0F172A",
        },
        teal: {
          DEFAULT: "#14B8A6",
          600: "#0D9488",
          700: "#0F766E",
        },
        success: "#22C55E",
        sky: "#3B82F6",
        amber: "#F59E0B",
        rose: "#EF4444",
        paper: "#F8FAFC",
        panel: "#1E293B",
      },
      fontFamily: {
        display: ["'Bricolage Grotesque'", "system-ui", "sans-serif"],
        sans: ["'Plus Jakarta Sans'", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "monospace"],
      },
      borderRadius: {
        xl2: "1.25rem",
      },
    },
  },
  plugins: [],
};
