#!/usr/bin/env python3
"""Conservative whole-interface observation; never a provider billing ledger.

Requires an operator-created baseline. Reboots, counter rollback, expired cycle,
or corrupt state lock media admission closed until an operator reviews the state.
Only the small permit is readable by the media runtime; metrics remain private.
"""
import fcntl
import json
import os
import pathlib
import time

ROOT = pathlib.Path('/opt/dcelysion-media-stage3')
STATE = ROOT / 'operator/host-usage.json'
PERMIT = ROOT / 'admission/permit.json'


def atomic(path, value, mode):
    temp = path.with_suffix('.tmp')
    with open(temp, 'w', encoding='utf-8') as stream:
        os.chmod(temp, mode)
        json.dump(value, stream, separators=(',', ':'))
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temp, path)


def observe(state, boot, rx, tx, now):
    # A fault persists even when subsequent counters look valid.
    if state.get('fault'):
        return state, False
    if (state['bootId'] != boot or rx < state['lastRx'] or tx < state['lastTx']
            or now >= state['cycleEndsAt']):
        state['fault'] = 'baseline-review-required'
        return state, False
    state['observedBytes'] += rx - state['lastRx'] + tx - state['lastTx']
    state.update(lastRx=rx, lastTx=tx, checkedAt=now)
    return state, state['observedBytes'] < state['mediaStopAtBytes']


def main():
    with open(ROOT / 'operator/host-usage.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        now = time.time()
        allowed = False
        try:
            state = json.loads(STATE.read_text())
            interface = state['interface']
            if interface != 'eth0':
                raise ValueError('operator must review interface')
            if state['interfaceMac'] != (pathlib.Path('/sys/class/net') / interface / 'address').read_text().strip():
                state['fault'] = 'interface-review-required'
            counters = pathlib.Path('/sys/class/net') / interface / 'statistics'
            state, allowed = observe(
                state, pathlib.Path('/proc/sys/kernel/random/boot_id').read_text().strip(),
                int((counters / 'rx_bytes').read_text()),
                int((counters / 'tx_bytes').read_text()), now)
            atomic(STATE, state, 0o600)
        except (OSError, ValueError, KeyError, TypeError):
            # Preserve an unreadable/corrupt original for review; no new baseline.
            allowed = False
        atomic(PERMIT, {'allowed': allowed, 'expiresAt': int((now + 45) * 1000)}, 0o644)


if __name__ == '__main__':
    main()
