"""The deploy check accepts generated Android outputs, never unrelated source changes."""
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import check_production as production


class GeneratedAppFollowupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.git('init', '-q', '-b', 'main')
        self.git('config', 'user.name', 'Release check test')
        self.git('config', 'user.email', 'release-check@example.invalid')
        self.base = self.commit({'server/core/api.js': 'original API',
                                 'download/app.json': 'original metadata',
                                 'download/two-state-casino.apk': 'original APK'})

    def git(self, *args):
        return subprocess.check_output(['git', *args], cwd=self.root, stderr=subprocess.DEVNULL).decode().strip()

    def commit(self, files):
        for name, text in files.items():
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text)
        self.git('add', '.')
        self.git('commit', '-qm', 'test release')
        return self.git('rev-parse', 'HEAD')

    def accepts(self, deployed, expected=None):
        return production.generated_app_followup(expected or self.base, deployed, root=self.root)

    def test_exact_commit(self):
        self.assertTrue(self.accepts(self.base))

    def test_generated_apk_and_metadata(self):
        followup = self.commit({'download/app.json': 'next metadata',
                                'download/two-state-casino.apk': 'next APK'})
        self.assertTrue(self.accepts(followup))

    def test_api_change_is_rejected_even_with_apk(self):
        followup = self.commit({'server/core/api.js': 'different API',
                                'download/two-state-casino.apk': 'next APK'})
        self.assertFalse(self.accepts(followup))

    def test_other_output_is_rejected(self):
        self.assertFalse(self.accepts(self.commit({'download/other.json': 'unverified'})))

    def test_sibling_is_not_a_followup(self):
        expected = self.commit({'download/app.json': 'expected metadata'})
        self.git('checkout', '-q', '--detach', self.base)
        sibling = self.commit({'download/app.json': 'other branch metadata'})
        self.assertFalse(self.accepts(sibling, expected))

    def test_unknown_or_malformed_commit_is_rejected(self):
        for value in [None, '', '--help', 'f' * 40]:
            with self.subTest(commit=value):
                self.assertFalse(self.accepts(value))

    def test_shallow_checkout_can_verify_generated_followup(self):
        with tempfile.TemporaryDirectory() as checkout:
            subprocess.run(['git', 'clone', '-q', '--depth=1', self.root.as_uri(), checkout],
                           check=True, capture_output=True)
            followup = self.commit({'download/app.json': 'next metadata'})
            self.assertFalse(production.generated_app_followup(self.base, followup, root=checkout))
            self.assertTrue(production.generated_app_followup(self.base, followup, root=checkout, fetch=True))
            head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=checkout).decode().strip()
            self.assertEqual(head, self.base)

    def test_missing_source_commit_is_rejected(self):
        version = json.dumps({'sourceBuild': 'expected'}).encode()
        with patch.object(production, 'read', return_value=(200, 'application/json', version)):
            with self.assertRaisesRegex(ValueError, 'live source commit'):
                production.check('https://example.invalid', 'expected', self.base)


if __name__ == '__main__':
    unittest.main()
