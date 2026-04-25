try {
  if (localStorage.getItem("manicbot_web_theme") === "light") {
    document.documentElement.classList.remove("dark");
  } else {
    document.documentElement.classList.add("dark");
  }
} catch (e) {
  document.documentElement.classList.add("dark");
}
