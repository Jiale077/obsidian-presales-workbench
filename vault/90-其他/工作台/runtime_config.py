"""Shared, non-secret configuration for the optional local AI workers."""
import json
import os
from pathlib import Path
import shutil


def settings():
    file = Path(__file__).with_name('runtime-config.json')
    return json.loads(file.read_text(encoding='utf-8')) if file.exists() else {}


def command(kind='codex'):
    configured = os.environ.get('PWB_' + kind.upper() + '_COMMAND') or settings().get(kind + '_command')
    value = os.path.expanduser(configured or ('python3' if kind == 'python' else 'codex'))
    resolved = shutil.which(value)
    if not resolved:
        raise RuntimeError(f'未找到 {kind}，请在 runtime-config.json 中设置 {kind}_command。')
    return resolved


def adapter_path(key):
    value = settings().get(key)
    if not value:
        raise RuntimeError(f'尚未配置可选云端适配器 {key}；可使用本机处理或已有转录稿。')
    file = Path(value).expanduser().resolve()
    if not file.is_file():
        raise RuntimeError(f'配置的适配器脚本不存在：{key}')
    return file


def model_args():
    value = settings().get('codex_model')
    return ['--model', value] if value else []
