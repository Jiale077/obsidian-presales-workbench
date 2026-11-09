import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
CODE = ROOT / 'vault/90-其他/工作台'
sys.path.insert(0, str(CODE))
sys.dont_write_bytecode = True


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


installer = load('installer', ROOT / 'scripts/install.py')
weekly = load('weekly_worker', CODE / 'weekly_report_worker.py')


class InstallationTests(unittest.TestCase):
    def test_install_and_repeat_preserve_existing_notes_and_local_config(self):
        with tempfile.TemporaryDirectory() as tmp:
            vault = Path(tmp) / 'vault'
            vault.mkdir()
            (vault / 'personal.md').write_text('Keep existing business content')
            result = installer.install(vault, demo=True)
            self.assertGreater(result['files_added'], 20)
            config = vault / '90-其他/工作台/runtime-config.json'
            config.write_text('{"python_command":"my-python"}')
            self.assertEqual(installer.install(vault, demo=True)['files_added'], 0)
            self.assertEqual(config.read_text(), '{"python_command":"my-python"}')
            self.assertEqual((vault / 'personal.md').read_text(), 'Keep existing business content')

    def test_conflict_aborts_before_any_new_file_is_written(self):
        with tempfile.TemporaryDirectory() as tmp:
            vault = Path(tmp)
            (vault / '售前工作台.md').write_text('My customized dashboard')
            before = set(vault.rglob('*'))
            with self.assertRaises(ValueError):
                installer.install(vault, demo=True)
            self.assertEqual(set(vault.rglob('*')), before)
            self.assertEqual((vault / '售前工作台.md').read_text(), 'My customized dashboard')

    def test_dry_run_does_not_create_vault(self):
        with tempfile.TemporaryDirectory() as tmp:
            vault = Path(tmp) / 'absent'
            self.assertTrue(installer.install(vault, dry_run=True)['dry_run'])
            self.assertFalse(vault.exists())

    def test_symlink_cannot_redirect_installation_outside_vault(self):
        with tempfile.TemporaryDirectory() as tmp:
            vault, outside = Path(tmp) / 'vault', Path(tmp) / 'outside'
            vault.mkdir(); outside.mkdir()
            (vault / '.obsidian').symlink_to(outside, target_is_directory=True)
            with self.assertRaises(ValueError):
                installer.install(vault)
            self.assertEqual(list(outside.iterdir()), [])

    def test_settings_merge_keeps_other_preferences_and_creates_backup(self):
        with tempfile.TemporaryDirectory() as tmp:
            vault = Path(tmp)
            plugin = vault / '.obsidian/plugins/dataview'
            plugin.mkdir(parents=True)
            (plugin / 'manifest.json').write_text('{}')
            appearance = vault / '.obsidian/appearance.json'
            appearance.write_text('{"theme":"obsidian", "enabledCssSnippets":["mine"]}')
            installer.install(vault, enable_settings=True)
            merged = json.loads(appearance.read_text())
            self.assertEqual(merged['theme'], 'obsidian')
            self.assertEqual(merged['enabledCssSnippets'], ['mine', 'presales-workbench'])
            backups = list((vault / '.presales-workbench-backups').rglob('appearance.json'))
            self.assertEqual(len(backups), 1)
            self.assertEqual(json.loads(backups[0].read_text())['enabledCssSnippets'], ['mine'])


class EvidenceTests(unittest.TestCase):
    def test_weekly_scan_does_not_open_codex_history_by_default(self):
        with tempfile.TemporaryDirectory() as tmp:
            vault = Path(tmp)
            installer.install(vault, demo=True)
            with patch.object(weekly.sqlite3, 'connect', side_effect=AssertionError('must not read history')):
                result = weekly.scan(vault, weekly.period_defaults())
            self.assertTrue(result['items'])
            self.assertTrue(all(item['kind'] == '资料线索' for item in result['items']))
            self.assertFalse(result['warnings'])

    def test_weekly_evidence_refuses_an_external_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            vault = Path(tmp) / 'vault'; vault.mkdir()
            outside = Path(tmp) / 'private.txt'; outside.write_text('DO NOT READ')
            with self.assertRaises(ValueError):
                weekly.safe_path(vault, '../private.txt')
            sources = weekly.evidence(vault, [{'title': 'example', 'files': [{'path': '../private.txt'}]}])
            self.assertNotIn('DO NOT READ', json.dumps(sources))

    def test_style_reference_excludes_appended_unreviewed_drafts(self):
        text = '以下为归纳版本：\n# 本周重点工作进度\n- Adopted prose\n\n## 工作台补充初稿\n# 本周重点工作进度\n- Unreviewed prose'
        reference = weekly.summary_reference(text, 'first_summary')
        self.assertIn('Adopted prose', reference)
        self.assertNotIn('Unreviewed prose', reference)


FAKE_CODEX = '''#!/usr/bin/env python3
import json, sys
from pathlib import Path
root = Path.cwd()
work = root / 'work'; work.mkdir(exist_ok=True)
def send(value):
    print(json.dumps(value), flush=True)
for line in sys.stdin:
    msg = json.loads(line)
    method = msg.get('method')
    with (work / 'protocol.jsonl').open('a') as stream:
        stream.write(json.dumps({'method': method, 'params': msg.get('params')}) + '\\n')
    if 'id' not in msg:
        continue
    result = {}
    if method in ['thread/start', 'thread/resume']:
        result = {'thread': {'id': 'fixture-thread'}}
    if method == 'turn/start':
        result = {'turn': {'id': 'fixture-turn'}}
    send({'jsonrpc': '2.0', 'id': msg['id'], 'result': result})
    if method == 'turn/start':
        count_file = work / 'count'
        count = int(count_file.read_text()) + 1 if count_file.exists() else 1
        count_file.write_text(str(count))
        output = root / '交付物'; output.mkdir(exist_ok=True)
        (output / 'result.txt').write_text('fictional result ' + str(count))
        send({'method': 'item/completed', 'params': {'item': {'id': 'answer', 'type': 'agentMessage', 'text': 'Fixture output generated', 'phase': 'final_answer'}}})
        send({'method': 'turn/completed', 'params': {'turn': {'id': 'fixture-turn', 'status': 'completed'}}})
'''


@unittest.skipIf(sys.platform == 'win32', 'POSIX backend for first release')
class ExecutionTests(unittest.TestCase):
    def test_start_resume_and_output_tracking_without_model_access(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            vault = base / 'vault'
            installer.install(vault, demo=True)
            folder = vault / '30-近期工作/示例客户A-方案交流'
            fake = base / 'fake-codex'; fake.write_text(FAKE_CODEX); fake.chmod(0o700)
            for run in ['first', 'second']:
                job = folder / '.workbench/runs' / run
                job.mkdir(parents=True)
                request = job / 'request.json'
                request.write_text(json.dumps({'vault': str(vault), 'folder': str(folder), 'title': 'Fictional task', 'prompt': 'Use only fixture data'}))
                result = subprocess.run([sys.executable, str(CODE / 'task_work_worker.py'), str(request)],
                    env={**os.environ, 'PWB_CODEX_COMMAND': str(fake), 'PYTHONDONTWRITEBYTECODE': '1'}, capture_output=True, text=True, timeout=20)
                self.assertEqual(result.returncode, 0, result.stderr)
                state = json.loads((job / 'state.json').read_text())
                self.assertEqual(state['status'], 'completed', state)
                self.assertEqual(state['thread_id'], 'fixture-thread')
                self.assertTrue(any(f['name'] == '交付物/result.txt' for f in state['files']))
                self.assertTrue((vault / state['record_path']).exists())
            methods = [json.loads(line)['method'] for line in (folder / 'work/protocol.jsonl').read_text().splitlines()]
            self.assertEqual(methods.count('thread/start'), 1)
            self.assertEqual(methods.count('thread/resume'), 1)
            self.assertEqual((folder / '交付物/result.txt').read_text(), 'fictional result 2')


if __name__ == '__main__':
    unittest.main()
