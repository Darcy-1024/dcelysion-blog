"""Focused Linux tests; no Docker, network or production directory access."""
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('sync', Path(__file__).with_name('sync-admin-content.py'))
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)


class ContentSyncTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.state = self.root / 'state'
        self.state.mkdir()
        self.content = self.root / 'repository/src/content'
        self.content.mkdir(parents=True)
        self.patches = [patch.object(sync, 'STATE', self.state), patch.object(sync, 'CONTENT', self.content)]
        for item in self.patches:
            item.start()
            self.addCleanup(item.stop)

    def blob(self, path, mode='100644'):
        return {'path': path, 'type': 'blob', 'mode': mode,
                'size': 1, 'sha': sync.git_hash(b'x')}

    def tree_fetch(self, entries, body=b'x', truncated=False):
        def fetch(url, **kwargs):
            if url.startswith(sync.TREE):
                selected = entries
                if '?recursive=1' not in url:
                    name, digest = ('content', 'd' * 40) if url.endswith('c' * 40) else ('src', 'c' * 40)
                    selected = [{'path': name, 'type': 'tree', 'mode': '040000', 'sha': digest}]
                return io.BytesIO(json.dumps({'tree': selected, 'truncated': truncated}).encode())
            return io.BytesIO(body)
        return fetch

    def test_reject_traversal_and_links(self):
        for index, entry in enumerate([self.blob('../escaped'), self.blob('posts/link', '120000')]):
            with patch.object(sync, 'fetch', side_effect=self.tree_fetch([entry])):
                with self.assertRaisesRegex(RuntimeError, 'Unsafe content'):
                    sync.prepare('a' * 40, self.root / f'extracted-{index}')
        self.assertFalse((self.root / 'escaped').exists())

    def test_valid_blobs_and_unprivileged_directory_modes(self):
        folder = self.root / 'candidate'
        entries = [self.blob('posts/post.md'), self.blob('dynamic/d.md')]
        (self.content / 'posts').mkdir()
        (self.content / 'posts/post.md').write_bytes(b'x')
        with patch.object(sync, 'fetch', side_effect=self.tree_fetch(entries)) as fetch:
            sync.prepare('a' * 40, folder)
        self.assertEqual(fetch.call_count, 4)  # three trees + only missing dynamic
        self.assertEqual((folder / 'posts/post.md').read_bytes(), b'x')
        self.assertEqual((folder / 'posts').stat().st_mode & 0o777, 0o755)

    def test_reject_truncated_tree_and_corrupt_blob(self):
        with patch.object(sync, 'fetch', side_effect=self.tree_fetch([], truncated=True)):
            with self.assertRaisesRegex(RuntimeError, 'Incomplete Git tree'):
                sync.prepare('a' * 40, self.root / 'truncated')
        with patch.object(sync, 'fetch', side_effect=self.tree_fetch([self.blob('posts/post.md')], body=b'z')):
            with self.assertRaisesRegex(RuntimeError, 'integrity mismatch'):
                sync.prepare('a' * 40, self.root / 'corrupt')

    def test_recover_missing_content_after_rename(self):
        (self.content / 'original').write_text('original')
        backup = self.state / 'backup-1'
        self.content.rename(backup)
        sync.write_json(self.state / 'pending.json', {'backup': backup.name, 'record': {}})
        with patch.object(sync, 'run') as run, patch.object(sync, 'healthy'), \
                patch.object(sync, 'live_revision', side_effect=RuntimeError('recovered before fetch')):
            with self.assertRaisesRegex(RuntimeError, 'recovered before fetch'):
                sync.main()
        self.assertEqual((self.content / 'original').read_text(), 'original')
        self.assertFalse((self.state / 'pending.json').exists())
        self.assertEqual(run.call_args_list[-1].args, ('docker', 'start', sync.CONTAINER))

    def test_failed_install_rolls_back_snapshot_and_record(self):
        (self.content / 'post').write_text('old')
        record = {'revision': 'a' * 40, 'files': sync.inventory(self.content)}
        sync.write_json(self.state / 'current.json', record)
        entries = [self.blob('posts/post.md'), self.blob('dynamic/d.md')]
        with patch.object(sync, 'live_revision', return_value='b' * 40), \
                patch.object(sync, 'fetch', side_effect=self.tree_fetch(entries)), \
                patch.object(sync, 'validate', return_value={}), \
                patch.object(sync, 'run'), \
                patch.object(sync, 'healthy', side_effect=[RuntimeError('not ready'), None]):
            with self.assertRaisesRegex(RuntimeError, 'not ready'):
                sync.synchronize()
        self.assertEqual((self.content / 'post').read_text(), 'old')
        self.assertEqual(json.loads((self.state / 'current.json').read_text()), record)
        self.assertFalse((self.state / 'pending.json').exists())

    def test_unchanged_skips_download_and_restart_and_detects_external_edits(self):
        (self.content / 'post').write_text('old')
        sync.write_json(self.state / 'current.json', {'revision': 'a' * 40, 'files': sync.inventory(self.content)})
        with patch.object(sync, 'live_revision', return_value='a' * 40), \
                patch.object(sync, 'fetch') as fetch, patch.object(sync, 'run') as run:
            sync.synchronize()
            fetch.assert_not_called()
            run.assert_not_called()
            (self.content / 'post').write_text('unexpected edit')
            with self.assertRaisesRegex(RuntimeError, 'outside synchronizer'):
                sync.synchronize()
            run.assert_not_called()


if __name__ == '__main__':
    unittest.main()
