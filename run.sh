#!/usr/bin/env bash
# Start Raah on this laptop: http://localhost:8000 (phone: http://<laptop-ip>:8000)
cd "$(dirname "$0")/backend"
# accounts live in PostgreSQL: run scripts/setup_postgres.sh (or docker compose up -d db) once first
[ -f .env ] || cp .env.example .env
pip install -q -r requirements.txt
exec python3 -m uvicorn raah.main:app --host 0.0.0.0 --port 8000
