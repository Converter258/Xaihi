/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        "vscode-bg": "#1e1e1e",
        "vscode-sidebar": "#252526",
        "vscode-panel": "#181818",
        "vscode-border": "#333333",
        "vscode-hover": "#2a2d2e",
        "vscode-accent": "#0e639c",
        "vscode-text": "#cccccc",
        "vscode-muted": "#9d9d9d",
      },
    },
  },
  plugins: [],
};
