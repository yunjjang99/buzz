"""Publish strategy assets without replacing concurrent chat/login releases."""
from pathlib import Path
import shutil
import datetime
import sys

root = Path(__file__).resolve().parents[1]
build = root / 'desktop/korean/web-dist'
server = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / 'Servers/buzz'
dest = server / 'web-client'
entry = dest / 'index.html'
old = entry.read_text()
if 'name="buzz-strategy-bundled" content="1"' in old:
    raise SystemExit('Strategy is bundled with chat. Use the full deploy-home.py workflow for this release.')
if not (build / 'strategy.html').is_file() or '</body>' not in old:
    raise SystemExit('Build strategy.html and verify the existing chat entry first.')
import json
manifest = json.loads((build / '.vite/manifest.json').read_text())
embed = manifest['strategy/embed.tsx']
# Import shared CSS dependencies before the embedding module.
css = set()
visited = set()
def collect(key):
    if key in visited: return
    visited.add(key)
    item = manifest[key]
    css.update(item.get('css', []))
    for dependency in item.get('imports', []): collect(dependency)
collect('strategy/embed.tsx')
marker = ''.join(f'<link rel="stylesheet" href="/chat/{file}" data-buzz-strategy>' for file in sorted(css))
marker += f'<script type="module" src="/chat/{embed["file"]}" data-buzz-strategy></script>'
# Replace only our own bootstrap, never a chat bundle or authentication service.
import re
updated = re.sub(r'<script defer src="/chat/assets/strategy-link-[a-f0-9]+\.js" data-buzz-strategy></script>', '', old)
updated = re.sub(r'<(?:script|link)\b[^>]*data-buzz-strategy[^>]*>(?:</script>)?', '', updated)
updated = updated.replace('</body>', marker + '</body>')
stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
backup = server / 'web-deploy-backups' / ('strategy-' + stamp)
backup.mkdir(parents=True)
shutil.copy2(entry, backup / 'index.html')
if (dest / 'strategy.html').exists():
    shutil.copy2(dest / 'strategy.html', backup / 'strategy.html')
shutil.copytree(build / 'assets', dest / 'assets', dirs_exist_ok=True)
if entry.read_text() != old:
    raise SystemExit('Chat deployment changed concurrently; no entry was replaced. Retry.')
next_strategy = dest / '.strategy-next.html'
next_strategy.write_text('<!doctype html><html lang="ko"><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=/chat/#strategy"><title>Buzz 전략실</title><a href="/chat/#strategy">Buzz 전략실 열기</a></html>')
next_strategy.replace(dest / 'strategy.html')
next_index = dest / '.strategy-chat-next.html'
next_index.write_text(updated)
next_index.replace(entry)
print(f'Strategy published. Prior entries: {backup}')
