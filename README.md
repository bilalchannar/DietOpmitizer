# 🥗 Diet Optimizer (AI)

An AI-powered meal-plan optimizer that uses **Genetic Algorithms** (GA) and **Constraint Satisfaction** (CSP) to find the best diet plan for your nutrition targets and budget.

---

## ✨ Features

- **Two optimization algorithms** — GA (evolutionary) and CSP (backtracking), or run both and compare
- **Food database** — add / delete foods with full nutritional data
- **Meal split** — suggested Breakfast / Lunch / Dinner breakdown
- **History & Analytics** — tracks every optimization run with charts
- **Docker Compose** — one command to spin up backend, database, admin UI, and frontend

---

## 🚀 Quick Start

### Option A — Docker Compose (recommended)

```bash
# 1. Copy the example env file and set credentials
cp backend/.env.example backend/.env
# Edit backend/.env and change MONGO_EXPRESS_PASS

# 2. Start all services
cd backend
docker compose up --build

# Services available at:
#   Frontend  →  http://localhost
#   Backend   →  http://localhost:5000
#   Mongo UI  →  http://localhost:8081  (admin / your_password)
```

### Option B — Local Development

**Prerequisites:** Python 3.12+, MongoDB running locally

```bash
# Backend
cd backend
python -m venv .venv
.venv\Scripts\activate          # Windows
# source .venv/bin/activate     # macOS/Linux
pip install -r requirements.txt
python app.py                   # starts on http://localhost:5000

# Frontend — open frontend/home.html directly in your browser
# (API_BASE auto-detects localhost and points to http://localhost:5000)
```

---

## 📁 Project Structure

```
Diet Optimizer(AI)/
├── backend/
│   ├── app.py            # Flask REST API
│   ├── GA.py             # Genetic Algorithm optimizer
│   ├── CSP.py            # Constraint Satisfaction solver
│   ├── requirements.txt  # Python dependencies
│   ├── Dockerfile        # Backend container (Python 3.12 + Gunicorn)
│   ├── compose.yml       # Docker Compose (app + mongo + nginx)
│   ├── nginx.conf        # Nginx config for serving the frontend
│   └── .env.example      # Template — copy to .env and fill in secrets
└── frontend/
    ├── home.html         # Optimize Diet page
    ├── foods.html        # Food Database management
    ├── history.html      # History & Analytics
    ├── app.js            # All frontend logic
    ├── style.css         # Styles
    └── assets/
        └── favicon.jpg
```

---

## 🔌 API Reference

| Method | Endpoint     | Description                                     |
|--------|--------------|-------------------------------------------------|
| GET    | `/health`    | Health check — confirms DB connection           |
| GET    | `/foods`     | List all foods in the database                  |
| POST   | `/foods`     | Add a new food                                  |
| DELETE | `/foods/<name>` | Delete a food by name                        |
| POST   | `/optimize`  | Run diet optimization (GA, CSP, or both)        |
| GET    | `/results`   | Retrieve all previous optimization results      |

### POST `/optimize` — Request Body

```json
{
  "targets": {
    "calories": 2000,
    "protein":  150,
    "carbs":    250,
    "fat":       70
  },
  "budget":          20,
  "technique":       "ga",      // "ga" | "csp" | "both"
  "population_size": 30,        // GA only
  "generations":     50,        // GA only
  "tolerance":       0.25,      // CSP only (±25%)
  "seed":            42         // optional: integer for reproducible GA runs
}
```

---

## ⚙️ Environment Variables

Copy `backend/.env.example` → `backend/.env` and configure:

| Variable              | Default              | Description                              |
|-----------------------|----------------------|------------------------------------------|
| `MONGO_EXPRESS_USER`  | `admin`              | Mongo Express web UI username            |
| `MONGO_EXPRESS_PASS`  | `changeme_please`    | Mongo Express web UI password            |
| `CORS_ORIGINS`        | `http://localhost,…` | Comma-separated allowed frontend origins |
| `MONGO_URI`           | *(set in compose)*   | MongoDB connection string                |

---

## 🧬 Algorithms

### Genetic Algorithm (GA)
- Tournament selection + two-point crossover + random mutation
- Budget-repair operator ensures all individuals stay within budget
- Optional `seed` for reproducibility

### Constraint Satisfaction (CSP)
- Greedy initialiser using a multi-objective food score (all nutrients weighted)
- Recursive backtracking with a dynamic node limit (scales with food DB size)
- Falls back to best greedy solution if backtracking exhausts the node budget

---

## 🐳 Docker Services

| Service      | Port | Description                         |
|--------------|------|-------------------------------------|
| `frontend`   | 80   | Nginx serving static HTML/CSS/JS    |
| `app`        | 5000 | Flask + Gunicorn (4 workers)        |
| `mongo`      | —    | MongoDB (internal only, not exposed)|
| `mongo-express` | 8081 | Web admin UI for MongoDB          |
