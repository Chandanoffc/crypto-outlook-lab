document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("token-form");
  const intervalSelect = document.getElementById("interval-select");
  const timeframeButtons = Array.from(document.querySelectorAll("[data-analysis-interval]"));

  if (!form || !intervalSelect || !timeframeButtons.length) return;

  const syncActiveButton = () => {
    timeframeButtons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.analysisInterval === intervalSelect.value);
    });
  };

  timeframeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const nextInterval = button.dataset.analysisInterval;
      if (!nextInterval) return;
      intervalSelect.value = nextInterval;
      syncActiveButton();
      if (typeof form.requestSubmit === "function") {
        form.requestSubmit();
      } else {
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      }
    });
  });

  intervalSelect.addEventListener("change", syncActiveButton);
  syncActiveButton();
});
