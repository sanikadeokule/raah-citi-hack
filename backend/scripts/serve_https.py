"""Serve Raah over HTTPS so phones can use the microphone and voice typing.

Phone browsers only allow the microphone on https:// pages (or localhost), so the plain
http://<laptop-ip>:8000 link works for reading but not for speaking. Run one of these
from the backend folder (Windows, macOS or Linux):

  python scripts/serve_https.py          # public https link through a Cloudflare quick tunnel
  python scripts/serve_https.py --lan    # https on this Wi-Fi only, with a self-signed certificate

Tunnel (default): needs internet. Downloads `cloudflared` into backend/data/bin the first
time, starts the app and prints an https://....trycloudflare.com link (and a QR code when
the `qrcode` package is installed). No account, no certificate to install; the link
changes every run.

LAN: works without internet. Creates a certificate for this laptop's Wi-Fi address and
serves https://<laptop-ip>:8443. The phone shows a "connection is not private" warning
once; tap Advanced, then Proceed. After that the microphone works.
"""
from __future__ import annotations

import argparse
import ipaddress
import os
import platform
import re
import shutil
import signal
import socket
import stat
import subprocess
import sys
import tarfile
import threading
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
DATA = BACKEND / "data"
RELEASES = "https://github.com/cloudflare/cloudflared/releases/latest/download/"


def lan_ip() -> str:
    """The address other devices on this Wi-Fi use to reach the laptop (no packet is sent)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def show_link(url: str) -> None:
    bar = "=" * (len(url) + 8)
    print(f"\n{bar}\n    {url}\n{bar}")
    try:
        import qrcode  # optional: pip install qrcode
        qr = qrcode.QRCode(border=1)
        qr.add_data(url)
        qr.print_ascii(invert=True)
    except ImportError:
        print("(pip install qrcode to show a QR code here for the phone to scan)")
    print("Open this link on the phone. Press Ctrl+C to stop.\n", flush=True)


def start_app(port: int, ssl: tuple[Path, Path] | None = None) -> subprocess.Popen:
    cmd = [sys.executable, "-m", "uvicorn", "raah.main:app", "--host", "0.0.0.0", "--port", str(port)]
    if ssl:
        cmd += ["--ssl-certfile", str(ssl[0]), "--ssl-keyfile", str(ssl[1])]
    return subprocess.Popen(cmd, cwd=BACKEND)


def wait_for_port(port: int, timeout: float = 30) -> bool:
    end = time.time() + timeout
    while time.time() < end:
        with socket.socket() as s:
            if s.connect_ex(("127.0.0.1", port)) == 0:
                return True
        time.sleep(0.3)
    return False


# ------------------------------------------------------------------ tunnel
def cloudflared_asset() -> str:
    system, machine = platform.system().lower(), platform.machine().lower()
    arch = "arm64" if machine in ("arm64", "aarch64") else "amd64"
    if system == "windows":
        return f"cloudflared-windows-{arch}.exe"
    if system == "darwin":
        return f"cloudflared-darwin-{arch}.tgz"
    return f"cloudflared-linux-{arch}"


def find_cloudflared() -> str:
    found = shutil.which("cloudflared")
    if found:
        return found
    exe = DATA / "bin" / ("cloudflared.exe" if os.name == "nt" else "cloudflared")
    if exe.exists():
        return str(exe)
    asset = cloudflared_asset()
    print(f"Downloading {asset} (first run only)...", flush=True)
    exe.parent.mkdir(parents=True, exist_ok=True)
    tmp = exe.parent / asset
    urllib.request.urlretrieve(RELEASES + asset, tmp)
    if asset.endswith(".tgz"):
        with tarfile.open(tmp) as t:
            t.extract("cloudflared", exe.parent)
        tmp.unlink()
    else:
        tmp.replace(exe)
    exe.chmod(exe.stat().st_mode | stat.S_IEXEC)
    return str(exe)


def run_tunnel(port: int) -> list[subprocess.Popen]:
    app = start_app(port)
    if not wait_for_port(port):
        print("The app did not start; see the error above.")
        return [app]
    tunnel = subprocess.Popen([find_cloudflared(), "tunnel", "--no-autoupdate", "--url", f"http://localhost:{port}"],
                              stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)

    def read() -> None:
        shown = False
        for line in tunnel.stdout:  # cloudflared prints the link in its log
            m = re.search(r"https://[a-z0-9-]+\.trycloudflare\.com", line)
            if m and not shown:
                shown = True
                show_link(m.group(0))
            elif "ERR" in line:
                print("cloudflared:", line.strip(), flush=True)

    threading.Thread(target=read, daemon=True).start()
    return [app, tunnel]


# ------------------------------------------------------------------ LAN, self-signed
def make_cert(ip: str) -> tuple[Path, Path]:
    """A certificate valid for this laptop's Wi-Fi address, localhost and the machine name."""
    folder = DATA / "https"
    cert, key = folder / f"raah-{ip}.crt", folder / f"raah-{ip}.key"
    if cert.exists() and key.exists():
        return cert, key
    folder.mkdir(parents=True, exist_ok=True)
    try:
        from cryptography import x509
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        from cryptography.x509.oid import NameOID
    except ImportError:
        if not shutil.which("openssl"):
            sys.exit("Needs the cryptography package: pip install cryptography")
        subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "30",
                        "-keyout", str(key), "-out", str(cert), "-subj", "/CN=Raah demo",
                        "-addext", f"subjectAltName=IP:{ip},IP:127.0.0.1,DNS:localhost"], check=True)
        return cert, key
    pk = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Raah demo")])
    now = datetime.now(timezone.utc)
    sans = [x509.IPAddress(ipaddress.ip_address(ip)), x509.IPAddress(ipaddress.ip_address("127.0.0.1")),
            x509.DNSName("localhost"), x509.DNSName(socket.gethostname())]
    c = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(pk.public_key())
         .serial_number(x509.random_serial_number()).not_valid_before(now - timedelta(minutes=5))
         .not_valid_after(now + timedelta(days=30))
         .add_extension(x509.SubjectAlternativeName(sans), critical=False)
         .sign(pk, hashes.SHA256()))
    key.write_bytes(pk.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.TraditionalOpenSSL,
                                     serialization.NoEncryption()))
    cert.write_bytes(c.public_bytes(serialization.Encoding.PEM))
    return cert, key


def run_lan(port: int) -> list[subprocess.Popen]:
    ip = lan_ip()
    app = start_app(port, make_cert(ip))
    if wait_for_port(port):
        show_link(f"https://{ip}:{port}")
        print('The phone warns "not private" once: tap Advanced, then Proceed. The phone must be on the same Wi-Fi.\n'
              "If it cannot connect, allow Python through the laptop's firewall (Windows asks the first time).", flush=True)
    return [app]


def main() -> None:
    ap = argparse.ArgumentParser(description="Serve Raah over HTTPS for phones (microphone needs https).")
    ap.add_argument("--lan", action="store_true", help="https on this Wi-Fi with a self-signed certificate (no internet needed)")
    ap.add_argument("--port", type=int, help="default 8000 for the tunnel, 8443 for --lan")
    a = ap.parse_args()
    procs = run_lan(a.port or 8443) if a.lan else run_tunnel(a.port or 8000)

    def stop(*_):
        for p in procs:
            if p.poll() is None:
                p.terminate()
        sys.exit(0)

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    while all(p.poll() is None for p in procs):
        time.sleep(0.5)
    stop()


if __name__ == "__main__":
    main()
