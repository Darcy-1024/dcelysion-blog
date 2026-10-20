#!/usr/bin/env python3
"""Operator-only immutable admin upgrade. Secrets stay in private server files."""
import argparse, hashlib, json, os, pathlib, shutil, subprocess, tarfile, time, urllib.request, urllib.error
P=pathlib.Path
ROOT=P('/opt/dcelysion-admin-stage2')
PACKAGE=P('/home/ubuntu/memos-prod-20261020-build/admin-candidate.tar.gz')
SHA='932daf74da52d1b0a73615eb3303245c6b6412d75e290d04816493c328906b34'
NAME='dc-admin-formal'; PREVIOUS=NAME+'-before-memos-20261020'
RELEASE=ROOT/'releases/20261020-memos'; STATE=ROOT/'operator/memos-20261020'
NGINX=P('/etc/nginx/sites-available/dcelysion-memos-gateway'); ENABLED=P('/etc/nginx/sites-enabled/dcelysion-memos-gateway')
def run(args):
    return subprocess.run(args,check=True,capture_output=True,text=True).stdout.strip()
def docker(*args): return run(['docker',*args])
def save(path,value):
    path.write_text(json.dumps(value,indent=2));path.chmod(0o600)
def status(url,host):
    try:
        with urllib.request.urlopen(urllib.request.Request(url,headers={'Host':host}),timeout=5) as r:return r.status
    except urllib.error.HTTPError as e:return e.code

def execute(author):
    os.umask(0o077)
    assert os.geteuid()==0
    assert author.is_file() and not author.is_symlink()
    assert author.stat().st_uid==1000 and author.stat().st_mode & 0o077==0, 'AUTHOR_PERMISSIONS'
    # Parse in place, never print credentials or inspect contents in operator output.
    assert isinstance(json.loads(author.read_text()),dict)
    assert hashlib.sha256(PACKAGE.read_bytes()).hexdigest()==SHA
    assert not STATE.exists() and not RELEASE.exists() and not NGINX.exists() and not ENABLED.exists()
    old=json.loads(docker('inspect',NAME))[0]; host=old['HostConfig'];config=old['Config']
    assert old['State']['Running'] and not host['PortBindings']
    networks=old['NetworkSettings']['Networks'];assert set(networks)=={'dcelysion_database'}
    ip=networks['dcelysion_database']['IPAddress'];assert ip=='172.18.0.7'
    assert json.loads(docker('network','inspect','dc-memos-private'))[0]['Internal']
    assert host['ReadonlyRootfs'] and host['CapDrop']==['ALL'] and config['User']=='1000:1000'
    STATE.mkdir(mode=0o700);save(STATE/'previous-inspect.json',old)
    shutil.copyfile(ROOT/'runtime.env',STATE/'runtime.before.env')
    shutil.copytree('/etc/nginx',STATE/'nginx.before',symlinks=True)
    backend=next(m['Source'] for m in old['Mounts'] if m['Destination']=='/app/backend')
    with tarfile.open(STATE/'backend.before.tar.gz','w:gz') as t:t.add(backend,arcname='.')
    RELEASE.mkdir(mode=0o755);RELEASE.chmod(0o755)
    with tarfile.open(PACKAGE) as t:
        assert all(m.isdir() or m.isfile() for m in t.getmembers())
        t.extractall(RELEASE,filter='data')
    mf=json.loads((RELEASE/'manifest.json').read_text())
    for e in mf['entries']:
        f=RELEASE/e['path'];assert hashlib.sha256(f.read_bytes()).hexdigest()==e['sha256']
    for f in RELEASE.rglob('*'):f.chmod(0o755 if f.is_dir() else 0o644)
    env=dict(e.split('=',1) for e in config['Env'])
    env.update(ADMIN_MEMOS_ORIGIN='https://memos.dcelysion.cn',ADMIN_MEMOS_BRIDGE_ENABLED='1',ADMIN_MEMOS_GATEWAY_HOST='0.0.0.0',ADMIN_MEMOS_GATEWAY_CONTAINER_ONLY='1',ADMIN_MEMOS_GATEWAY_PORT='4324',ADMIN_MEMOS_UPSTREAM='http://dc-memos-origin:5230',ADMIN_MEMOS_CREDENTIALS_FILE='/private/memos-author.json')
    envfile=STATE/'runtime.candidate.env';envfile.write_text(''.join(k+'='+v+'\n' for k,v in env.items()))
    args=['run','-d','--name',NAME,'--restart',host['RestartPolicy']['Name'],'--network','dcelysion_database','--ip',ip,'--user',config['User'],'--workdir',config['WorkingDir'],'--read-only','--memory',str(host['Memory']),'--memory-swap',str(host['MemorySwap']),'--cpus',str(host['NanoCpus']/1e9),'--pids-limit',str(host['PidsLimit']),'--env-file',str(envfile)]
    for key in ['CapDrop','CapAdd']:
        for v in host.get(key) or []:args+=['--cap-drop' if key=='CapDrop' else '--cap-add',v]
    for v in host.get('SecurityOpt') or []:args+=['--security-opt',v]
    for k,v in (host.get('Tmpfs') or {}).items():args+=['--tmpfs',k+':'+v]
    for k,v in (config.get('Labels') or {}).items():args+=['--label',k+'='+v]
    for m in old['Mounts']:
        assert m['Type']=='bind'
        src=str(RELEASE) if m['Destination']=='/app/backend' else m['Source']
        args+=['--mount','type=bind,source='+src+',target='+m['Destination']+(',readonly' if not m['RW'] else '')]
    args+=['--mount','type=bind,source='+str(author)+',target=/private/memos-author.json,readonly']
    ep=config.get('Entrypoint') or [];assert len(ep)<=1
    if ep:args+=['--entrypoint',ep[0]]
    args += [old['Image'],*(config.get('Cmd') or [])]
    renamed=False; switched=False
    try:
        docker('stop','--time','60',NAME);docker('rename',NAME,PREVIOUS);renamed=True
        docker('network','disconnect','dcelysion_database',PREVIOUS)
        docker(*args);switched=True;docker('network','connect','dc-memos-private',NAME)
        for _ in range(20):
            try:
                if status('http://'+ip+':4322/api/memos','admin.dcelysion.cn')==401:break
            except Exception:pass
            time.sleep(1)
        else:raise RuntimeError('ADMIN_ANONYMOUS_CHECK')
        assert json.loads(docker('inspect',NAME))[0]['State']['Running']
        gateway=status('http://'+ip+':4324/','memos.dcelysion.cn');assert gateway in [401,403]
        NGINX.write_text('''server {
    listen 127.0.0.1:18446;
    server_name memos.dcelysion.cn;
    access_log off;
    error_log /var/log/nginx/dc-memos-gateway-error.log crit;
    client_max_body_size 128m;
    add_header X-Robots-Tag "noindex, nofollow" always;
    if ($host != memos.dcelysion.cn) { return 421; }
    location / {
        proxy_pass http://172.18.0.7:4324;
        proxy_http_version 1.1;
        proxy_set_header Host memos.dcelysion.cn;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
''');NGINX.chmod(0o644);ENABLED.symlink_to(NGINX)
        run(['nginx','-t']);run(['systemctl','reload','nginx'])
        for _ in range(15):
            try:
                if status('http://127.0.0.1:18446/','memos.dcelysion.cn') in [401,403]:break
            except Exception:pass
            time.sleep(1)
        else:raise RuntimeError('NGINX_GATEWAY_CHECK')
        shutil.copyfile(envfile,ROOT/'runtime.env');(ROOT/'runtime.env').chmod(0o600)
        result={'ok':True,'packageSHA256':SHA,'release':str(RELEASE),'previousContainer':PREVIOUS,'adminAnonymous':401,'gatewayAnonymous':gateway,'nginxValidated':True,'hostPortsPublished':False}
        save(STATE/'result.json',result);print(json.dumps(result))
    except BaseException:
        if ENABLED.is_symlink():ENABLED.unlink()
        if NGINX.exists():NGINX.unlink()
        if renamed and subprocess.run(['docker','inspect',NAME],capture_output=True).returncode==0:
            subprocess.run(['docker','stop','--time','20',NAME],capture_output=True)
            subprocess.run(['docker','network','disconnect','dcelysion_database',NAME],capture_output=True)
            subprocess.run(['docker','network','disconnect','dc-memos-private',NAME],capture_output=True)
            subprocess.run(['docker','rename',NAME,NAME+'-failed-memos-20261020'],capture_output=True)
        if renamed:
            previous_state=json.loads(docker('inspect',PREVIOUS))[0]
            if 'dcelysion_database' not in previous_state['NetworkSettings']['Networks']:
                docker('network','connect','--ip',ip,'dcelysion_database',PREVIOUS)
            docker('rename',PREVIOUS,NAME);docker('start',NAME)
        shutil.copyfile(STATE/'runtime.before.env',ROOT/'runtime.env')
        run(['nginx','-t']);run(['systemctl','reload','nginx'])
        save(STATE/'result.json',{'ok':False,'rollback':True});raise RuntimeError('DEPLOYMENT_FAILED_ROLLED_BACK') from None
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--author-file',required=True,type=P);args=parser.parse_args()
    try:execute(args.author_file.resolve())
    except Exception as e:
        print(json.dumps({'ok':False,'errorType':type(e).__name__}));raise SystemExit(1)
