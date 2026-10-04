"""Install only the new stats vhost, issue TLS, then enable collection."""
from pathlib import Path
import subprocess

assert Path('/opt/dcelysion-umami/OWNER').read_text().strip() == 'dcelysion-umami-20261004'
source=Path('/home/ubuntu/nginx-umami.conf').read_text()
target=Path('/etc/nginx/sites-available/dcelysion-umami')
enabled=Path('/etc/nginx/sites-enabled/dcelysion-umami')
assert not target.exists() and not enabled.exists(), 'Existing vhost: review manually'
target.write_text(source.split('\nserver {\n    listen 443')[0])
enabled.symlink_to(target)
def run(*args):
    subprocess.run(args, check=True)
try:
    run('nginx','-t')
except Exception:
    enabled.unlink()
    raise
run('systemctl','reload','nginx')
assert Path('/opt/dcelysion-umami/cloudflare-dns.ini').is_file(), 'Protected DNS credential required'
run('certbot','certonly','--dns-cloudflare',
    '--dns-cloudflare-credentials','/opt/dcelysion-umami/cloudflare-dns.ini',
    '--dns-cloudflare-propagation-seconds','30',
    '-d','stats.dcelysion.cn','--non-interactive','--agree-tos',
    '--account','79a27108c030dc59dc8acfc355bb918b', '--deploy-hook','systemctl reload nginx')
target.write_text(source)
run('nginx','-t')
run('systemctl','reload','nginx')
print('stats TLS enabled; administration restricted to loopback.')
