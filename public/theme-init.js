// Pre-paint theme. Saved choice overrides prefers-color-scheme; markup default is light.
(() => {
  try {
    const s = localStorage.getItem("deployglass-theme");
    document.documentElement.dataset.theme =
      s === "dark" || s === "light" ? s
      : (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  } catch { /* storage blocked: keep light default */ }
})();
