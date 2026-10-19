// Relative URLs for Elastic Beanstalk, EC2, and same-origin serving.
// Fall back to http://localhost:5000 only when testing directly via file:// protocol.
const API_BASE = window.location.protocol === "file:" ? "http://localhost:5000" : "";

let selectedTechnique = "ga";
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const fmt = (n, d = 2) => Number(n || 0).toFixed(d);
const fmtCost = (c) => (typeof c === "number" ? `$${c.toFixed(2)}` : "-");

// ─── XSS Protection (#15) ─────────────────────────────────────────────────────
// All user-supplied or server-returned strings must go through escapeHtml()
// before being interpolated into innerHTML.
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = String(str ?? "");
  return div.innerHTML;
}

// ─── Toast Notifications ──────────────────────────────────────────────────────
function showToast(message, type = "success") {
  let container = $("#toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    document.body.appendChild(container);
  }
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("toast-visible"));
  setTimeout(() => {
    toast.classList.remove("toast-visible");
    setTimeout(() => toast.remove(), 350);
  }, 3500);
}

// ─── Loading Spinner (#23) ────────────────────────────────────────────────────
function showSpinner(show) {
  const spinner = $("#optimize-spinner");
  const btn = $("#diet-form button[type='submit']");
  if (spinner) spinner.style.display = show ? "flex" : "none";
  if (btn) {
    btn.disabled = show;
    btn.textContent = show ? "Optimizing…" : "Optimize Diet";
  }
}

// ─── Chart Helper ─────────────────────────────────────────────────────────────
function createChart(canvas, type, labels, data, label, xLabel, yLabel, color = "rgba(67,160,71,0.7)") {
  if (typeof Chart === "undefined" || !canvas) return null;
  const isLine = type === "line";
  return new Chart(canvas.getContext("2d"), {
    type,
    data: {
      labels,
      datasets: [{
        label,
        data,
        backgroundColor: color,
        borderColor: isLine ? "#2e7d32" : color,
        borderWidth: isLine ? 3 : 1,
        tension: 0.2,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: xLabel
        ? {
            x: { title: { display: true, text: xLabel, font: { weight: "bold" } } },
            y: { title: { display: true, text: yLabel, font: { weight: "bold" } }, beginAtZero: true },
          }
        : {},
    },
  });
}

// ─── Technique Selector ───────────────────────────────────────────────────────
function initTechniqueSelector() {
  $$(".technique-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$(".technique-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      selectedTechnique = btn.dataset.technique;
      const hidden = $("#technique");
      if (hidden) hidden.value = selectedTechnique;
      toggleCSPTolerance(selectedTechnique);
    });
  });
  toggleCSPTolerance("ga");
}

function toggleCSPTolerance(t) {
  const toleranceEl = $(".form-group:has(#tolerance)");
  if (toleranceEl) {
    const show = t === "csp" || t === "both";
    toleranceEl.style.display = show ? "flex" : "none";
  }
  const populationEl = $(".form-group:has(#population)");
  const generationsEl = $(".form-group:has(#generations)");
  const showGA = t === "ga" || t === "both";
  if (populationEl) populationEl.style.display = showGA ? "flex" : "none";
  if (generationsEl) generationsEl.style.display = showGA ? "flex" : "none";
}

// ─── Optimize Form Submit ─────────────────────────────────────────────────────
async function handleOptimizeSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const technique = selectedTechnique || "ga";

  const inputData = {
    targets: {
      calories: +form.calories.value,
      protein: +form.protein.value,
      carbs: +form.carbs.value,
      fat: +form.fat.value,
    },
    budget: +form.budget.value,
    population_size: +form.population.value,
    generations: +form.generations.value,
    tolerance: +(form.tolerance?.value || 25) / 100,
    technique,
  };

  const resultSection = $("#result-section");
  const comparisonSection = $("#comparison-section");
  const resultSummary = $("#result-summary");
  const resultTableEl = $("#result-table");
  const resultScore = $("#result-score");
  const mealPlanSection = $("#meal-plan-section");
  const chartsSection = $("#charts-section");

  if (!resultSection || !resultSummary || !resultTableEl || !resultScore) return;
  const resultTable = resultTableEl.querySelector("tbody");

  // Reset UI state
  resultSection.style.display = "none";
  if (comparisonSection) comparisonSection.style.display = "none";
  if (mealPlanSection) mealPlanSection.style.display = "none";
  if (chartsSection) chartsSection.style.display = "none";
  resultSummary.innerHTML = "";
  resultTable.innerHTML = "";
  resultScore.innerHTML = "";

  showSpinner(true);

  try {
    const response = await fetch(`${API_BASE}/optimize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(inputData),
    });

    const result = await response.json();

    if (!response.ok) {
      // Show backend error message (#6 error feedback)
      showToast(result.error || `Optimization failed (${response.status})`, "error");
      resultSection.style.display = "block";
      resultSummary.innerHTML = `<span class="error-msg">${escapeHtml(result.error || "Optimization failed.")}</span>`;
      return;
    }

    if (technique === "both" && result.ga && result.csp) {
      displayComparisonResults(result, inputData);
      return;
    }

    if (result.diet?.length > 0) {
      resultSection.style.display = "block";
      const techniqueLabel = $("#technique-label");
      if (techniqueLabel) {
        const techName = result.technique || (technique === "csp" ? "CSP" : "Genetic Algorithm");
        techniqueLabel.innerHTML = `<span class="tech-badge">${technique === "csp" ? "🧩" : "🧬"} ${escapeHtml(techName)}</span>`;
      }

      const t = result.totals || {};
      const cost = result.cost;
      resultSummary.innerHTML = `
        <b>Targets:</b> Calories: ${escapeHtml(String(inputData.targets.calories))},
        Protein: ${escapeHtml(String(inputData.targets.protein))}g,
        Carbs: ${escapeHtml(String(inputData.targets.carbs))}g,
        Fat: ${escapeHtml(String(inputData.targets.fat))}g,
        Budget: $${escapeHtml(String(inputData.budget))}<br><br>
        <b>Achieved:</b> Calories: ${fmt(t.calories, 0)}, Protein: ${fmt(t.protein, 1)}g,
        Carbs: ${fmt(t.carbs, 1)}g, Fat: ${fmt(t.fat, 1)}g
        ${typeof cost === "number" ? `<br><b>Total Cost:</b> $${cost.toFixed(2)}` : ""}`;

      resultTable.innerHTML = result.diet
        .map((item) => `<tr><td>${escapeHtml(item.food)}</td><td>${escapeHtml(String(item.qty))}</td></tr>`)
        .join("");

      resultScore.innerHTML = `<b>Fitness Score:</b> ${fmt(result.score)} / 100`;

      showNutritionChart(result.diet);
      displayMealPlan(result.diet);   // Fix #9: actually render meal plan
      showToast(`Optimization complete! Score: ${fmt(result.score)}/100`, "success");
    } else {
      resultSection.style.display = "block";
      resultSummary.innerHTML = `<span class="error-msg">No valid diet found for the given constraints. Try relaxing your targets or increasing the budget.</span>`;
      showToast("No valid diet found. Try adjusting your constraints.", "warning");
    }
  } catch (err) {
    resultSection.style.display = "block";
    resultSummary.innerHTML = `<span class="error-msg">Error connecting to backend. Is the server running?</span>`;
    showToast("Connection error — check if the backend is running.", "error");
    console.error(err);
  } finally {
    showSpinner(false);
  }
}

// ─── Foods ────────────────────────────────────────────────────────────────────
async function loadFoods() {
  const tableBody = $("#food-table tbody");
  if (!tableBody) return;
  try {
    const res = await fetch(`${API_BASE}/foods`);
    if (!res.ok) throw new Error(`Server error: ${res.status}`);
    const foods = await res.json();
    if (!foods?.length) {
      tableBody.innerHTML = `<tr><td colspan='7' class='empty-state-cell'>No foods in database. Add one above to get started! 🥗</td></tr>`;
      return;
    }
    tableBody.innerHTML = foods
      .map(
        (f) => `
        <tr>
          <td>${escapeHtml(f.name)}</td>
          <td>${escapeHtml(String(f.calories))}</td>
          <td>${escapeHtml(String(f.protein))}</td>
          <td>${escapeHtml(String(f.carbs))}</td>
          <td>${escapeHtml(String(f.fat))}</td>
          <td>$${escapeHtml(String(Number(f.price).toFixed(2)))}</td>
          <td>
            <button class="btn-delete" onclick="deleteFood('${escapeHtml(f.name).replace(/'/g, "&#39;")}')">
              Delete
            </button>
          </td>
        </tr>`
      )
      .join("");
  } catch (err) {
    tableBody.innerHTML = `<tr><td colspan='7' class='empty-state-cell error-cell'>Error loading foods: ${escapeHtml(err.message)}</td></tr>`;
  }
}

// Fix #6: addFood with try/catch, response.ok check, and user feedback
async function addFood(e) {
  e.preventDefault();
  const fields = ["name", "calories", "protein", "carbs", "fat", "price"];
  const food = Object.fromEntries(
    fields.map((f) => [f, f === "name" ? $(`#food-${f}`).value.trim() : +$(`#food-${f}`).value])
  );

  const btn = e.target.querySelector('button[type="submit"]');
  const originalText = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = "Adding…"; }

  try {
    const res = await fetch(`${API_BASE}/foods`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(food),
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || "Failed to add food.", "error");
      return;   // Do NOT reset form on failure
    }
    showToast(data.message || `'${food.name}' added!`, "success");
    e.target.reset();
    await loadFoods();
  } catch (err) {
    showToast("Connection error — could not add food.", "error");
    console.error(err);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
  }
}

// Fix #7: deleteFood with confirmation dialog and error handling
async function deleteFood(name) {
  if (!confirm(`Are you sure you want to delete "${name}"?\nThis cannot be undone.`)) return;
  try {
    const res = await fetch(`${API_BASE}/foods/${encodeURIComponent(name)}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || "Failed to delete food.", "error");
      return;
    }
    if (data.deleted_count > 0) {
      showToast(`"${name}" deleted.`, "success");
    } else {
      showToast(`"${name}" not found in database.`, "warning");
    }
    await loadFoods();
  } catch (err) {
    showToast("Connection error — could not delete food.", "error");
    console.error(err);
  }
}

// ─── History ──────────────────────────────────────────────────────────────────
function processResult(result, foodCount) {
  const diet = result.diet || [];
  diet.forEach((f) => { foodCount[f.food] = (foodCount[f.food] || 0) + (f.qty || 0); });
  return {
    foods: diet.map((f) => escapeHtml(f.food)).join(", "),
    cost: fmtCost(result.cost),
    score: result.score || 0,
  };
}

async function loadHistory() {
  const tbody = $("#history-table tbody");
  const historySection = $("#history-section");
  const historyBest = $("#history-best");
  const chartsSection = $("#charts-section");
  const emptyHistory = $("#history-empty");

  if (!tbody || !historySection || !historyBest) return;

  try {
    const res = await fetch(`${API_BASE}/results`);
    if (!res.ok) throw new Error(`GET /results failed: ${res.status}`);
    const history = await res.json();
    const foodCount = {};
    const chartData = [];
    tbody.innerHTML = "";

    // Fix #28: Show empty state when no history
    if (!history.length) {
      historySection.style.display = "none";
      if (chartsSection) chartsSection.style.display = "none";
      if (emptyHistory) emptyHistory.style.display = "block";
      return;
    }

    historySection.style.display = "block";
    if (emptyHistory) emptyHistory.style.display = "none";

    let bestScore = -Infinity;
    history.forEach((item) => {
      const dateStr = item.created_at ? new Date(item.created_at).toLocaleString() : "-";
      if (item.ga_result && item.csp_result) {
        [{ r: item.ga_result, label: "GA" }, { r: item.csp_result, label: "CSP" }].forEach(({ r, label }) => {
          const p = processResult(r, foodCount);
          if (p.score > bestScore) bestScore = p.score;
          tbody.innerHTML += `<tr>
            <td>${escapeHtml(dateStr)} <small>(${label})</small></td>
            <td>${fmt(p.score)}</td>
            <td>${p.foods}</td>
            <td>${escapeHtml(p.cost)}</td>
          </tr>`;
          chartData.push({ label: `${dateStr} (${label})`, cost: r.cost || 0 });
        });
      } else {
        const p = processResult(item, foodCount);
        if (p.score > bestScore) bestScore = p.score;
        const tech = item.technique ? ` <small>(${escapeHtml(item.technique)})</small>` : "";
        tbody.innerHTML += `<tr>
          <td>${escapeHtml(dateStr)}${tech}</td>
          <td>${fmt(p.score)}</td>
          <td>${p.foods}</td>
          <td>${escapeHtml(p.cost)}</td>
        </tr>`;
        chartData.push({ label: dateStr, cost: typeof item.cost === "number" ? item.cost : 0 });
      }
    });

    const mostUsed = Object.entries(foodCount).sort((a, b) => b[1] - a[1])[0];
    historyBest.innerHTML = `Best Score: ${fmt(bestScore)} | Most Used Food: ${escapeHtml(mostUsed?.[0] || "—")}`;

    // Fix #26: Only show charts when there is actual data
    if (chartsSection) {
      chartsSection.style.display = "block";
      try {
        if (window.historyNutritionChart) window.historyNutritionChart.destroy();
        if (window.historyCostChart) window.historyCostChart.destroy();
        window.historyNutritionChart = createChart(
          $("#nutrition-chart"), "bar",
          Object.keys(foodCount), Object.values(foodCount),
          "Total Quantity", "Food Items", "Quantity"
        );
        window.historyCostChart = createChart(
          $("#cost-chart"), "line",
          chartData.map((d) => d.label), chartData.map((d) => d.cost),
          "Total Cost", "Date / Time", "Cost ($)", "rgba(67,160,71,0.15)"
        );
      } catch (err) {
        console.error("Failed to render history charts:", err);
      }
    }
  } catch (err) {
    // Fix #8: Show user-friendly error instead of silent log
    historySection.style.display = "none";
    if (chartsSection) chartsSection.style.display = "none";
    if (emptyHistory) {
      emptyHistory.style.display = "block";
      emptyHistory.innerHTML = `<p class="error-msg">⚠️ Could not load history: ${escapeHtml(err.message)}</p>`;
    }
    console.error(err);
  }
}

// ─── Charts (#25) ─────────────────────────────────────────────────────────────
function showNutritionChart(diet) {
  const chartsSection = $("#charts-section");
  const canvas = $("#nutrition-chart");
  if (!chartsSection || !canvas || typeof Chart === "undefined") return;
  chartsSection.style.display = "block";
  if (window.nutritionChart) window.nutritionChart.destroy();
  window.nutritionChart = createChart(
    canvas, "bar",
    diet.map((f) => f.food),
    diet.map((f) => f.qty),
    "Quantity", "Food Item", "Quantity"
  );
}

// ─── Meal Plan (#9) ───────────────────────────────────────────────────────────
function splitMeals(diet) {
  const meals = { Breakfast: [], Lunch: [], Dinner: [] };
  const keys = ["Breakfast", "Lunch", "Dinner"];
  diet.forEach((item, i) => meals[keys[i % 3]].push(item));
  return meals;
}

function displayMealPlan(diet) {
  const section = $("#meal-plan-section");
  if (!section || !diet.length) return;
  const meals = splitMeals(diet);
  const icons = { Breakfast: "🌅", Lunch: "☀️", Dinner: "🌙" };
  section.innerHTML =
    `<h3>📋 Suggested Meal Split</h3><div class="meal-grid">` +
    Object.entries(meals)
      .map(
        ([meal, items]) => `
        <div class="meal-card">
          <h4>${icons[meal] || "🍽️"} ${escapeHtml(meal)}</h4>
          ${
            items.length
              ? `<ul>${items.map((item) => `<li>${escapeHtml(item.food)} <span class="meal-qty">×${escapeHtml(String(item.qty))}</span></li>`).join("")}</ul>`
              : `<p class="meal-empty">—</p>`
          }
        </div>`
      )
      .join("") +
    `</div>`;
  section.style.display = "block";
}

// ─── Comparison Results ───────────────────────────────────────────────────────
function displayComparisonResults(result, inputData) {
  const resultSection = $("#result-section");
  const comparisonSection = $("#comparison-section");
  if (!comparisonSection) return;
  if (resultSection) resultSection.style.display = "none";
  comparisonSection.style.display = "block";

  function populateCard(prefix, data) {
    const summary = $(`#${prefix}-summary`);
    const table = $(`#${prefix}-table tbody`);
    const score = $(`#${prefix}-score`);
    if (!summary || !table || !score) return;
    const t = data.totals || {};
    const cost = data.cost;
    summary.innerHTML = `<b>Achieved:</b><br>
      Calories: ${fmt(t.calories, 0)}<br>
      Protein: ${fmt(t.protein, 1)}g<br>
      Carbs: ${fmt(t.carbs, 1)}g<br>
      Fat: ${fmt(t.fat, 1)}g${typeof cost === "number" ? `<br><b>Cost:</b> $${cost.toFixed(2)}` : ""}`;
    table.innerHTML = data.diet?.length
      ? data.diet.map((item) => `<tr><td>${escapeHtml(item.food)}</td><td>${escapeHtml(String(item.qty))}</td></tr>`).join("")
      : `<tr><td colspan="2">No solution found</td></tr>`;
    score.innerHTML = `<b>Score:</b> ${fmt(data.score)} / 100`;
  }

  populateCard("ga", result.ga);
  populateCard("csp", result.csp);

  const verdict = $("#comparison-verdict");
  if (verdict) {
    const gaScore = +result.ga.score || 0;
    const cspScore = +result.csp.score || 0;
    const gaCost = +result.ga.cost || 0;
    const cspCost = +result.csp.cost || 0;
    let winner, analysis;
    if (gaScore > cspScore) {
      winner = "🧬 Genetic Algorithm";
      analysis = `GA achieved a higher fitness score (${fmt(gaScore)} vs ${fmt(cspScore)}).`;
    } else if (cspScore > gaScore) {
      winner = "🧩 CSP";
      analysis = `CSP achieved a higher fitness score (${fmt(cspScore)} vs ${fmt(gaScore)}).`;
    } else {
      winner = "🤝 Tie";
      analysis = `Both techniques achieved the same fitness score (${fmt(gaScore)}).`;
    }
    if (Math.abs(gaCost - cspCost) > 0.01) {
      const cheaper = gaCost < cspCost ? "GA" : "CSP";
      analysis += ` ${cheaper} found a cheaper solution ($${Math.min(gaCost, cspCost).toFixed(2)} vs $${Math.max(gaCost, cspCost).toFixed(2)}).`;
    }
    verdict.innerHTML = `
      <h3>🏆 Winner: ${escapeHtml(winner)}</h3>
      <p>${escapeHtml(analysis)}</p>
      <p><small><b>Note:</b> GA uses evolutionary optimisation. CSP uses constraint propagation with backtracking.</small></p>`;
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", () => {
  initTechniqueSelector();
  const dietForm = $("#diet-form");
  if (dietForm) dietForm.addEventListener("submit", handleOptimizeSubmit);
  const addFoodForm = $("#add-food-form");
  if (addFoodForm) {
    addFoodForm.addEventListener("submit", addFood);
    window.deleteFood = deleteFood;
    loadFoods().catch(console.error);
  }
  if ($("#history-table")) loadHistory().catch(console.error);
});
