#!/usr/bin/env bash
# Start Raah on this laptop.
#   ./run.sh         http://localhost:8000 (phone: http://<laptop-ip>:8000, no microphone)
#   ./run.sh https   public https link for phones, through a Cloudflare quick tunnel (needs internet)
#   ./run.sh lan     https://<laptop-ip>:8443 on this Wi-Fi, self-signed certificate (no internet needed)
cd "$(dirname "$0")/backend"
pip install -q -r requirements.txt
case "$1" in
  https) exec python3 scripts/serve_https.py ;;
  lan)   exec python3 scripts/serve_https.py --lan ;;
  *)     exec python3 -m uvicorn raah.main:app --host 0.0.0.0 --port 8000 ;;
esac
