// Slides each .feature-row in from its data-reveal side the first time it
// scrolls into view.
const rows = document.querySelectorAll(".feature-row");

const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add("in-view");
        observer.unobserve(entry.target);
      }
    }
  },
  { threshold: 0.25, rootMargin: "0px 0px -10% 0px" }
);

rows.forEach((row) => observer.observe(row));
