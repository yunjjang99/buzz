"""Deploy the static /chat/ UI while preserving all existing relay routes."""

import datetime
import hashlib
import pathlib
import re
import shutil
import subprocess
import sys

source = pathlib.Path(__file__).resolve().parent
build = source.parent / "web-dist"
server = pathlib.Path(sys.argv[1]).resolve() if len(sys.argv) == 2 else pathlib.Path.home() / "Servers/buzz"
original_caddy = "{$BUZZ_DOMAIN} {\n  encode zstd gzip\n  reverse_proxy relay:3000\n}\n"
new_caddy = (source / "Caddyfile").read_text()
previous_caddy = new_caddy.replace("  handle /chat-api/* {\n    reverse_proxy buzz-login:3101\n  }\n", "")
login_build = source.parent / "login-dist"
if not (login_build / "server.mjs").is_file():
    raise SystemExit("Build the login service before deploying.")
login_version = hashlib.sha256((login_build / "server.mjs").read_bytes()).hexdigest()[:12]
login_image = f"local/buzz-login:{login_version}"
# Public identifier only; never read the owner key or the server .env contents.
owner_result = subprocess.run(["/usr/local/bin/docker", "exec", "buzz-home-postgres-1", "psql", "-U", "buzz", "-d", "buzz", "-Atc", "SELECT pubkey FROM relay_members WHERE role='owner' LIMIT 2"], capture_output=True, text=True, check=True, timeout=15)
owner = owner_result.stdout.strip()
if not re.fullmatch(r"[a-f0-9]{64}", owner):
    raise SystemExit("A single existing relay owner is required.")
caddy_file = server / "Caddyfile"
home_file = server / "compose.home.yml"
old_caddy = caddy_file.read_text()
old_home = home_file.read_text()
if old_caddy not in (original_caddy, previous_caddy, new_caddy):
    raise SystemExit("Existing Caddy configuration differs. Review it before deploying.")
anchor = "      - ./Caddyfile:/etc/caddy/Caddyfile:ro\n"
mount = "      - ./web-client:/srv/buzz-chat:ro\n"
if anchor not in old_home:
    raise SystemExit("Caddy volume binding was not found; no server changes were made.")
new_home = old_home if mount in old_home else old_home.replace(anchor, anchor + mount)
login_service = f"""  # BEGIN BUZZ LOGIN
  buzz-login:
    image: {login_image}
    restart: unless-stopped
    networks: [buzz-net]
    environment:
      BUZZ_LOGIN_ORIGIN: https://buzz.kovar.kr
      BUZZ_LOGIN_OWNER: {owner}
      BUZZ_LOGIN_RELAY_INTERNAL: http://relay:3000
    volumes:
      - buzz-login-data:/data
    read_only: true
    cap_drop: [ALL]
    security_opt: [no-new-privileges:true]
    tmpfs: [/tmp:size=16m]
    mem_limit: 768m
    pids_limit: 64
    healthcheck:
      test: [CMD, node, -e, "fetch('http://127.0.0.1:3101/chat-api/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 5s
      retries: 3
  # END BUZZ LOGIN
"""
if "# BEGIN BUZZ LOGIN" in new_home:
    new_home, replacements = re.subn(r"  # BEGIN BUZZ LOGIN\n.*?  # END BUZZ LOGIN\n", login_service, new_home, flags=re.S)
    if replacements != 1:
        raise SystemExit("Unexpected login service configuration; review before deploying.")
else:
    if "\nvolumes:\n" not in new_home or "  buzz-login:" in new_home:
        raise SystemExit("Unexpected home compose structure; review before deploying.")
    new_home = new_home.replace("\nvolumes:\n", "\n" + login_service + "\nvolumes:\n", 1)
if "  buzz-login-data:" not in new_home:
    new_home = new_home.replace("\nvolumes:\n", "\nvolumes:\n  buzz-login-data:\n", 1)
if not (build / "index.html").is_file() or not (build / "assets").is_dir():
    raise SystemExit("Build the browser client before deploying.")
upstream = pathlib.Path((server / "upstream.path").read_text().strip()).resolve()
if not upstream.is_relative_to(server / "upstream") or not (upstream / "compose.yml").is_file():
    raise SystemExit("Invalid home-server source path.")
compose = ["/usr/local/bin/docker", "compose", "--project-name", "buzz-home", "--project-directory", str(server), "--env-file", str(server / ".env"), "-f", str(upstream / "compose.yml"), "-f", str(home_file)]


def run(command, timeout=60):
    """Bound each operation and preserve failures without printing secret config."""
    subprocess.run(command, cwd=server, check=True, timeout=timeout)


# Build only public application code, never account data or .env.
shutil.copy2(source / "login-service/Dockerfile", login_build / "Dockerfile")
run(["/usr/local/bin/docker", "build", "--tag", login_image, str(login_build)], timeout=180)

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
    run(compose + ["up", "-d", "--no-deps", "--no-build", "--wait", "--wait-timeout", "40", "buzz-login"])
    run(["/usr/local/bin/docker", "exec", "buzz-home-buzz-login-1", "node", "-e", "fetch('http://127.0.0.1:3101/chat-api/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"])
    run(compose + ["up", "-d", "--no-deps", "--no-build", "caddy"])
    run(["/usr/local/bin/docker", "exec", "buzz-home-caddy-1", "caddy", "reload", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"])
except Exception:
    if (backup / "index.html").is_file():
        shutil.copy2(backup / "index.html", destination / ".index-rollback.html")
        (destination / ".index-rollback.html").replace(destination / "index.html")
    caddy_file.write_text(old_caddy)
    home_file.write_text(old_home)
    if "# BEGIN BUZZ LOGIN" in old_home:
        run(compose + ["up", "-d", "--no-deps", "--no-build", "buzz-login"])
    else:
        subprocess.run(["/usr/local/bin/docker", "stop", "buzz-home-buzz-login-1"], cwd=server, timeout=20, check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    run(compose + ["up", "-d", "--no-deps", "--no-build", "caddy"])
    run(["/usr/local/bin/docker", "exec", "buzz-home-caddy-1", "caddy", "reload", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"])
    raise
print(f"Web UI deployed: https://buzz.kovar.kr/chat/ (build {version})")
print(f"Configuration rollback copies: {backup}")
