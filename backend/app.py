import os
from flask_cors import CORS
from datetime import datetime, timezone
from pymongo import MongoClient
from pymongo.errors import ConnectionFailure, ServerSelectionTimeoutError
from flask import Flask, request, jsonify, send_from_directory
from GA import run_genetic_algorithm
from CSP import run_csp_solver

app = Flask(__name__)

# Determine frontend directory (supports both EB root layout and original repo layout)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if os.path.isdir(os.path.join(BASE_DIR, "frontend")):
    FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")
else:
    FRONTEND_DIR = os.path.abspath(os.path.join(BASE_DIR, "..", "frontend"))

# CORS: restrict to known origins via env var (comma-separated).
# Default allows localhost dev. Set CORS_ORIGINS in production.
_cors_origins = os.environ.get(
    "CORS_ORIGINS",
    "http://localhost,http://127.0.0.1,http://localhost:8080,http://127.0.0.1:8080,null"
).split(",")
CORS(app, origins=[o.strip() for o in _cors_origins])

MONGO_URI = os.environ.get("MONGO_URI", "mongodb://localhost:27017/")

try:
    client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
    db = client["diet_optimizer"]
except Exception as exc:
    print(f"ERROR: Could not initialise MongoDB client: {exc}")
    raise


# ─── Health Check ────────────────────────────────────────────────────────────
@app.route("/health", methods=["GET"])
def health():
    try:
        client.admin.command("ping")
        return jsonify({"status": "ok", "db": "connected"})
    except Exception as exc:
        return jsonify({"status": "error", "db": str(exc)}), 503


# ─── Foods ───────────────────────────────────────────────────────────────────
@app.route("/foods", methods=["GET"])
def get_foods():
    try:
        foods = list(db["foods"].find({}, {"_id": 0}))
        return jsonify(foods)
    except Exception as exc:
        return jsonify({"error": f"Database error: {exc}"}), 503


@app.route("/foods", methods=["POST"])
def add_food():
    food = request.json or {}

    required = ["name", "calories", "protein", "carbs", "fat", "price"]
    for field in required:
        if field not in food:
            return jsonify({"error": f"Missing field: {field}"}), 400

    try:
        food_doc = {
            "name": str(food["name"]).strip(),
            "calories": float(food["calories"]),
            "protein": float(food["protein"]),
            "carbs": float(food["carbs"]),
            "fat": float(food["fat"]),
            "price": float(food["price"]),
        }
    except (ValueError, TypeError):
        return jsonify({"error": "Invalid field types; numeric fields must be numbers."}), 400

    if not food_doc["name"]:
        return jsonify({"error": "Food name cannot be empty."}), 400

    if any(
        x < 0
        for x in (food_doc["calories"], food_doc["protein"], food_doc["carbs"], food_doc["fat"], food_doc["price"])
    ):
        return jsonify({"error": "Numeric fields must be non-negative."}), 400

    try:
        # Prevent duplicate food names (#16)
        if db["foods"].find_one({"name": food_doc["name"]}, {"_id": 1}):
            return jsonify({"error": f"Food '{food_doc['name']}' already exists."}), 409
        db["foods"].insert_one(food_doc)
    except Exception as exc:
        return jsonify({"error": f"Database error: {exc}"}), 503

    return jsonify({"status": "success", "message": f"'{food_doc['name']}' added successfully."})


@app.route("/foods/<name>", methods=["DELETE"])
def delete_food(name):
    try:
        res = db["foods"].delete_one({"name": name})
        return jsonify({"deleted_count": res.deleted_count})
    except Exception as exc:
        return jsonify({"error": f"Database error: {exc}"}), 503


# ─── Optimize ────────────────────────────────────────────────────────────────
@app.route("/optimize", methods=["POST"])
def optimize():
    data = request.json or {}

    technique = data.get("technique", "ga").lower()
    if technique not in ("ga", "csp", "both"):
        return jsonify({"error": 'Invalid technique. Use "ga", "csp", or "both".'}), 400

    targets = data.get("targets")
    if not isinstance(targets, dict):
        return jsonify({"error": 'Missing or invalid "targets" object.'}), 400

    for k in ("calories", "protein", "carbs", "fat"):
        if k not in targets:
            return jsonify({"error": f"Missing target: {k}"}), 400
        try:
            targets[k] = float(targets[k])
        except (TypeError, ValueError):
            return jsonify({"error": f"Invalid target value for {k}; must be a number."}), 400

    try:
        budget = float(data.get("budget", 0))
        population_size = int(data.get("population_size", 30))
        generations = int(data.get("generations", 50))
        tolerance = float(data.get("tolerance", 0.25))
        seed = data.get("seed")  # Optional: integer for reproducible GA runs
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid numeric parameter(s) for budget/population_size/generations."}), 400

    if budget < 0:
        return jsonify({"error": "Budget must be non-negative."}), 400

    if technique in ("ga", "both"):
        if population_size <= 0 or generations <= 0:
            return jsonify({"error": "population_size and generations must be positive integers."}), 400

    try:
        foods = list(
            db["foods"].find(
                {
                    "name": {"$exists": True},
                    "calories": {"$exists": True},
                    "protein": {"$exists": True},
                    "carbs": {"$exists": True},
                    "fat": {"$exists": True},
                    "price": {"$exists": True},
                },
                {"_id": 0},
            )
        )
    except Exception as exc:
        return jsonify({"error": f"Database error: {exc}"}), 503

    if not foods:
        return jsonify({"error": "Food database is empty. Add foods first."}), 400

    # Build a clean, validated input dict — never pass raw request data (#2)
    algo_input = {
        "food_db": foods,
        "targets": targets,
        "budget": budget,
        "population_size": population_size,
        "generations": generations,
        "tolerance": tolerance,
        "technique": technique,
        "seed": seed,
    }

    now = datetime.now(timezone.utc).isoformat()  # Fix deprecated utcnow() (#6)

    try:
        if technique == "ga":
            result = run_genetic_algorithm(algo_input)
            result["technique"] = "Genetic Algorithm"
        elif technique == "csp":
            result = run_csp_solver(algo_input)
            result["technique"] = "CSP"
        else:  # both
            ga_result = run_genetic_algorithm(algo_input)
            ga_result["technique"] = "Genetic Algorithm"
            csp_result = run_csp_solver(algo_input)
            csp_result["technique"] = "CSP"

            combined_result = {"ga": ga_result, "csp": csp_result, "technique": "both"}

            result_doc = {
                "inputs": {
                    "targets": targets,
                    "budget": budget,
                    "population_size": population_size,
                    "generations": generations,
                    "technique": "both",
                },
                "ga_result": ga_result,
                "csp_result": csp_result,
                "created_at": now,
            }
            try:
                db.results.insert_one(result_doc)
                result_doc.pop("_id", None)  # Remove non-serialisable ObjectId (#1)
            except Exception as exc:
                return jsonify({"error": f"Failed to save result: {exc}"}), 503

            return jsonify(combined_result)
    except Exception as exc:
        return jsonify({"error": f"Optimization error: {exc}"}), 500

    result_doc = {
        "inputs": {
            "targets": targets,
            "budget": budget,
            "population_size": population_size,
            "generations": generations,
            "technique": result.get("technique"),
        },
        "diet": result.get("diet", []),
        "score": result.get("score"),
        "totals": result.get("totals", {}),
        "cost": result.get("cost"),
        "technique": result.get("technique"),
        "created_at": now,
    }

    try:
        db.results.insert_one(result_doc)
        result_doc.pop("_id", None)
    except Exception as exc:
        return jsonify({"error": f"Failed to save result: {exc}"}), 503

    return jsonify(result_doc)


# ─── Results ─────────────────────────────────────────────────────────────────
@app.route("/results", methods=["GET"])
def get_results():
    try:
        results = list(db.results.find({}, {"_id": 0}))
        return jsonify(results)
    except Exception as exc:
        return jsonify({"error": f"Database error: {exc}"}), 503


# ─── Frontend & Static Routes ────────────────────────────────────────────────
@app.route("/", methods=["GET"])
def serve_index():
    return send_from_directory(FRONTEND_DIR, "home.html")


@app.route("/home.html", methods=["GET"])
def serve_home():
    return send_from_directory(FRONTEND_DIR, "home.html")


@app.route("/foods.html", methods=["GET"])
def serve_foods_page():
    return send_from_directory(FRONTEND_DIR, "foods.html")


@app.route("/history.html", methods=["GET"])
def serve_history_page():
    return send_from_directory(FRONTEND_DIR, "history.html")


@app.route("/app.js", methods=["GET"])
def serve_app_js():
    return send_from_directory(FRONTEND_DIR, "app.js")


@app.route("/style.css", methods=["GET"])
def serve_style_css():
    return send_from_directory(FRONTEND_DIR, "style.css")


@app.route("/assets/<path:filename>", methods=["GET"])
def serve_assets(filename):
    return send_from_directory(os.path.join(FRONTEND_DIR, "assets"), filename)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
