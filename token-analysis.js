document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("token-form");
  const intervalSelect = document.getElementById("interval-select");
  const timeframeButtons = Array.from(document.querySelectorAll("[data-analysis-interval]"));
  const summaryTabButtons = Array.from(document.querySelectorAll("[data-summary-tab]"));
  const summaryPanels = Array.from(document.querySelectorAll("[data-summary-panel]"));

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

  if (!summaryTabButtons.length || !summaryPanels.length) return;

  const setActiveSummaryTab = (tabName) => {
    summaryTabButtons.forEach((button) => {
      const isActive = button.dataset.summaryTab === tabName;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", String(isActive));
      button.tabIndex = isActive ? 0 : -1;
    });

    summaryPanels.forEach((panel) => {
      panel.hidden = panel.dataset.summaryPanel !== tabName;
    });
  };

  summaryTabButtons.forEach((button, index) => {
    button.tabIndex = index === 0 ? 0 : -1;

    button.addEventListener("click", () => {
      setActiveSummaryTab(button.dataset.summaryTab);
    });

    button.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      event.preventDefault();
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const nextIndex = (index + direction + summaryTabButtons.length) % summaryTabButtons.length;
      const nextButton = summaryTabButtons[nextIndex];
      if (!nextButton) return;
      setActiveSummaryTab(nextButton.dataset.summaryTab);
      nextButton.focus();
    });
  });

  setActiveSummaryTab(summaryTabButtons[0].dataset.summaryTab);
});
