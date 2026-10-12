import copy
import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location('usage', pathlib.Path(__file__).with_name('media-host-usage.py'))
usage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(usage)


class Admission(unittest.TestCase):
    def setUp(self):
        self.state = dict(bootId='boot1', lastRx=100, lastTx=200, observedBytes=1000,
                          mediaStopAtBytes=2000, cycleEndsAt=10000, fault=None)

    def test_increment_and_threshold(self):
        state, allowed = usage.observe(copy.deepcopy(self.state), 'boot1', 200, 300, 100)
        self.assertTrue(allowed)
        self.assertEqual(state['observedBytes'], 1200)
        state, allowed = usage.observe(state, 'boot1', 1000, 300, 101)
        self.assertFalse(allowed)
        self.assertEqual(state['observedBytes'], 2000)

    def test_reboot_counter_rollback_and_expiry_remain_locked(self):
        for boot, rx, tx, now in [('boot2', 200, 300, 100), ('boot1', 99, 300, 100),
                                   ('boot1', 200, 199, 100), ('boot1', 200, 300, 10000)]:
            state, allowed = usage.observe(copy.deepcopy(self.state), boot, rx, tx, now)
            self.assertFalse(allowed)
            self.assertIsNotNone(state['fault'])
            state, allowed = usage.observe(state, 'boot1', 300, 400, 200)
            self.assertFalse(allowed)


if __name__ == '__main__':
    unittest.main()
