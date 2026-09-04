/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          amber: "#F59E0B",
          indigo: "#6366F1",
          emerald: "#10B981",
        },
      },
    },
  },
  plugins: [],
};
