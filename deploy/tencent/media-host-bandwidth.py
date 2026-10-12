#!/usr/bin/env python3
"""Owned 5Mbps eth0 egress TBF, with an mq-only prior state and safe removal."""
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path('/opt/dcelysion-media-stage3/operator')
TC = '/usr/sbin/tc'
HANDLE = '1a3b:'


def run(*args):
    return subprocess.check_output([TC, *args], text=True)


def main(mode):
    current = json.loads(run('-j', 'qdisc', 'show', 'dev', 'eth0'))
    roots = [q for q in current if q.get('root')]
    if len(roots) != 1:
        raise ValueError('expected one eth0 root')
    root = roots[0]
    owned = root['kind'] == 'tbf' and root['handle'] == HANDLE
    if mode == 'apply':
        if root['kind'] != 'mq' and not owned:
            raise ValueError('unowned root qdisc; refusing replacement')
        if not (ROOT / 'qdisc-before.json').exists():
            if root['kind'] != 'mq':
                raise ValueError('missing original mq snapshot')
            (ROOT / 'qdisc-before.json').write_text(json.dumps(current))
        run('qdisc', 'replace', 'dev', 'eth0', 'root', 'handle', HANDLE,
            'tbf', 'rate', '5mbit', 'burst', '32768', 'latency', '150ms')
    elif mode == 'remove':
        if not owned:
            return
        previous = json.loads((ROOT / 'qdisc-before.json').read_text())
        if not any(q.get('root') and q['kind'] == 'mq' for q in previous):
            raise ValueError('unexpected original; refusing removal')
        run('qdisc', 'replace', 'dev', 'eth0', 'root', 'mq')
    else:
        raise ValueError('apply or remove required')


if __name__ == '__main__':
    main(sys.argv[1])
