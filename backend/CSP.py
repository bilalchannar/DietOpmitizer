from typing import Dict, Any


def run_csp_solver(input_data: Dict[str, Any]) -> Dict[str, Any]:

    food_db = input_data["food_db"]
    if not food_db:
        raise ValueError("Food database is empty. Please add foods first.")

    targets = input_data.get("targets", {"calories": 2000, "protein": 100, "carbs": 250, "fat": 70})
    budget = float(input_data.get("budget", 10))
    max_qty = int(input_data.get("max_qty_per_food", 5))   # Unified default (#10, was 4)
    tolerance = float(input_data.get("tolerance", 0.25))

    # Node limit scales with search space size (#19): larger DB → more budget
    default_limit = min(200_000, max(50_000, len(food_db) * 5_000))
    node_limit = int(input_data.get("csp_node_limit", default_limit))

    # ── Core helpers ──────────────────────────────────────────────────────────

    def calc_totals(diet):
        totals = {"calories": 0.0, "protein": 0.0, "carbs": 0.0, "fat": 0.0}
        cost = 0.0
        for i, qty in enumerate(diet):
            if qty > 0:
                food = food_db[i]
                totals["calories"] += food["calories"] * qty
                totals["protein"] += food["protein"] * qty
                totals["carbs"] += food["carbs"] * qty
                totals["fat"] += food["fat"] * qty
                cost += food["price"] * qty
        return totals, cost

    def is_valid(diet):
        """Check budget and nutrition ranges."""
        totals, cost = calc_totals(diet)
        if cost > budget:
            return False
        for nutrient in ["calories", "protein", "carbs", "fat"]:
            target = targets[nutrient]
            if totals[nutrient] < target * (1 - tolerance) or totals[nutrient] > target * (1 + tolerance):
                return False
        return True

    def calc_score(diet):
        """Score 0-100 based on proximity to all targets."""
        totals, cost = calc_totals(diet)
        if cost > budget or sum(diet) == 0:
            return 0.0
        weights = {"protein": 2.0, "calories": 1.0, "carbs": 0.6, "fat": 0.6}
        total_error = sum(
            weights.get(nut, 1.0) * abs(targets[nut] - totals[nut]) / max(targets[nut], 1)
            for nut in targets
        )
        return max(1.0, min(100.0, 100.0 - total_error * 100.0))

    def greedy_start():
        """
        Multi-objective greedy start (#20): scores each food across ALL
        nutrient dimensions, not just protein/dollar.
        """
        diet = [0] * len(food_db)
        budget_left = budget

        def food_score(i):
            food = food_db[i]
            price = max(food["price"], 0.01)
            weights = {"protein": 2.0, "calories": 1.0, "carbs": 0.6, "fat": 0.6}
            return sum(weights[nut] * food[nut] / price for nut in weights)

        food_indices = sorted(range(len(food_db)), key=food_score, reverse=True)

        for idx in food_indices:
            food = food_db[idx]
            while diet[idx] < max_qty and budget_left >= food["price"]:
                diet[idx] += 1
                budget_left -= food["price"]
                totals, _ = calc_totals(diet)
                # Roll back if any nutrient exceeds upper bound
                if any(totals[nut] > targets[nut] * (1 + tolerance) for nut in targets):
                    diet[idx] -= 1
                    budget_left += food["price"]
                    break

        return diet

    def search(diet, food_index, state):
        """
        Recursive backtracking search with mutable-state replaced by a dict
        to avoid closure hazards (#5).
        """
        state["attempts"] += 1
        if state["attempts"] > node_limit:
            return None

        if food_index >= len(food_db):
            return diet[:] if is_valid(diet) else None

        _, current_cost = calc_totals(diet)

        for qty in range(max_qty + 1):
            if current_cost + food_db[food_index]["price"] * qty > budget:
                continue
            diet[food_index] = qty
            result = search(diet, food_index + 1, state)
            if result is not None:
                return result

        diet[food_index] = 0
        return None

    # ── Run ───────────────────────────────────────────────────────────────────

    best_diet = greedy_start()
    best_score = calc_score(best_diet) if is_valid(best_diet) else 0.0

    state = {"attempts": 0}
    found_diet = search([0] * len(food_db), 0, state)

    if found_diet and is_valid(found_diet):
        found_score = calc_score(found_diet)
        if found_score > best_score:
            best_diet = found_diet
            best_score = found_score

    if is_valid(best_diet):
        totals, cost = calc_totals(best_diet)
        return {
            "diet": [
                {"food": food_db[i]["name"], "qty": int(qty)}
                for i, qty in enumerate(best_diet)
                if qty > 0
            ],
            "score": float(best_score),
            "totals": totals,
            "cost": cost,
            "nodes_explored": state["attempts"],
            "technique": "CSP",
        }

    return {
        "diet": [],
        "score": 0.0,
        "totals": {"calories": 0, "protein": 0, "carbs": 0, "fat": 0},
        "cost": 0.0,
        "nodes_explored": state["attempts"],
        "technique": "CSP",
    }