#!/usr/bin/env bash
# Create the Raah PostgreSQL database on Mac or Linux.
#   ./backend/scripts/setup_postgres.sh
# Uses Docker if it is installed; otherwise installs PostgreSQL 16 (Homebrew or apt) and creates
# the role "raah" (password "raah") and the database "raah". Then writes DATABASE_URL to backend/.env.
set -euo pipefail
cd "$(dirname "$0")/../.."
URL="postgresql://raah:raah@localhost:5432/raah"

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  docker compose up -d db
else
  if ! command -v psql >/dev/null 2>&1; then
    if command -v brew >/dev/null 2>&1; then brew install postgresql@16 && brew services start postgresql@16
    elif command -v apt-get >/dev/null 2>&1; then sudo apt-get update && sudo apt-get install -y postgresql && sudo service postgresql start
    else echo "Install PostgreSQL 16 from https://www.postgresql.org/download/ and run this again."; exit 1; fi
  fi
  if command -v brew >/dev/null 2>&1; then PSQL=(psql -d postgres); else PSQL=(sudo -u postgres psql); fi
  "${PSQL[@]}" -tc "SELECT 1 FROM pg_roles WHERE rolname='raah'" | grep -q 1 || "${PSQL[@]}" -c "CREATE ROLE raah LOGIN PASSWORD 'raah'"
  "${PSQL[@]}" -tc "SELECT 1 FROM pg_database WHERE datname='raah'" | grep -q 1 || "${PSQL[@]}" -c "CREATE DATABASE raah OWNER raah"
fi

[ -f backend/.env ] || cp backend/.env.example backend/.env
if grep -q '^DATABASE_URL=' backend/.env; then
  sed -i.bak "s|^DATABASE_URL=.*|DATABASE_URL=$URL|" backend/.env && rm -f backend/.env.bak
else
  echo "DATABASE_URL=$URL" >> backend/.env
fi
echo "PostgreSQL is ready: $URL"
