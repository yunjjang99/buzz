"""Deploy the static /chat/ UI while preserving all existing relay routes."""

import datetime
import hashlib
import pathlib
import shutil
import subprocess
import sys

source = pathlib.Path(__file__).resolve().parent
build = source.parent / "web-dist"
server = pathlib.Path(sys.argv[1]).resolve() if len(sys.argv) == 2 else pathlib.Path.home() / "Servers/buzz"
original_caddy = "{$BUZZ_DOMAIN} {\n  encode zstd gzip\n  reverse_proxy relay:3000\n}\n"
new_caddy = (source / "Caddyfile").read_text()
caddy_file = server / "Caddyfile"
home_file = server / "compose.home.yml"
old_caddy = caddy_file.read_text()
old_home = home_file.read_text()
if old_caddy not in (original_caddy, new_caddy):
    raise SystemExit("Existing Caddy configuration differs. Review it before deploying.")
anchor = "      - ./Caddyfile:/etc/caddy/Caddyfile:ro\n"
mount = "      - ./web-client:/srv/buzz-chat:ro\n"
if anchor not in old_home:
    raise SystemExit("Caddy volume binding was not found; no server changes were made.")
new_home = old_home if mount in old_home else old_home.replace(anchor, anchor + mount)
if not (build / "index.html").is_file() or not (build / "assets").is_dir():
    raise SystemExit("Build the browser client before deploying.")
upstream = pathlib.Path((server / "upstream.path").read_text().strip()).resolve()
if not upstream.is_relative_to(server / "upstream") or not (upstream / "compose.yml").is_file():
    raise SystemExit("Invalid home-server source path.")
compose = ["/usr/local/bin/docker", "compose", "--project-name", "buzz-home", "--project-directory", str(server), "--env-file", str(server / ".env"), "-f", str(upstream / "compose.yml"), "-f", str(home_file)]


def run(command):
    """Bound each operation and preserve failures without printing secret config."""
    subprocess.run(command, cwd=server, check=True, timeout=60)


version = hashlib.sha256((build / "index.html").read_bytes()).hexdigest()[:12]
stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
backup = server / "web-deploy-backups" / f"{stamp}-{version}"
backup.mkdir(parents=True, exist_ok=False)
(backup / "Caddyfile").write_text(old_caddy)
(backup / "compose.home.yml").write_text(old_home)
destination = server / "web-client"
destination.mkdir(exist_ok=True)
if (destination / "index.html").is_file():
    shutil.copy2(destination / "index.html", backup / "index.html")
# Retain old hashed assets for already-open browser tabs; publish the entry last.
shutil.copytree(build / "assets", destination / "assets", dirs_exist_ok=True)
entry = destination / ".index-next.html"
shutil.copy2(build / "index.html", entry)
entry.replace(destination / "index.html")
try:
    caddy_file.write_text(new_caddy)
    home_file.write_text(new_home)
    run(compose + ["config", "--quiet"])
    run(["/usr/local/bin/docker", "exec", "buzz-home-caddy-1", "caddy", "validate", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"])
    run(compose + ["up", "-d", "--no-deps", "--no-build", "caddy"])
    run(["/usr/local/bin/docker", "exec", "buzz-home-caddy-1", "caddy", "reload", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"])
except Exception:
    if (backup / "index.html").is_file():
        shutil.copy2(backup / "index.html", destination / ".index-rollback.html")
        (destination / ".index-rollback.html").replace(destination / "index.html")
    caddy_file.write_text(old_caddy)
    home_file.write_text(old_home)
    run(compose + ["up", "-d", "--no-deps", "--no-build", "caddy"])
    run(["/usr/local/bin/docker", "exec", "buzz-home-caddy-1", "caddy", "reload", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"])
    raise
print(f"Web UI deployed: https://buzz.kovar.kr/chat/ (build {version})")
print(f"Configuration rollback copies: {backup}")
