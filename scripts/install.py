#!/usr/bin/env python3
"""Install the starter workbench without replacing any existing vault file."""
import argparse
from datetime import datetime
import json
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]
WORKBENCH = '90-其他/工作台'
FOLDERS = [
    '00-Inbox', '10-客户资料', '20-项目归档', '30-近期工作',
    '40-团队工作/解决方案', '40-团队工作/对外交流材料', '40-团队工作/各类申报材料',
    '40-团队工作/工作记录', '40-团队工作/工作汇报/周报',
    '50-会议纪要', '70-会议交流', '_MOC',
    *['60-调研学习/' + p for p in ['10-AI与前沿', '20-行业研究', '30-网络与通信', '40-产品与技术', '50-竞品公司', '80-热门项目']],
]


def inside(vault, relative):
    target = vault / relative
    if not target.resolve().is_relative_to(vault):
        raise ValueError(f'目标路径通过符号链接指向知识库之外：{relative}')
    return target


def plan(vault, demo=False, word_preview=False):
    files = {}
    for source_root in [ROOT / 'vault', *([ROOT / 'examples/demo-notes'] if demo else [])]:
        for file in source_root.rglob('*'):
            if (file.is_file() and file.suffix in {'.md', '.js', '.py', '.css', '.svg', '.json'}
                    and not any(part in {'.workbench', '.weekly', '__pycache__'} for part in file.parts)
                    and file.name not in {'runtime-config.json', 'holiday-cache.json'}):
                relative = file.relative_to(source_root)
                files[inside(vault, relative)] = file.read_bytes()
    example = ROOT / 'vault' / WORKBENCH / 'runtime-config.example.json'
    config = inside(vault, WORKBENCH + '/runtime-config.json')
    if not config.exists():
        files[config] = example.read_bytes()
    if word_preview:
        for file in (ROOT / 'optional-plugins/workbench-word-preview').iterdir():
            if file.is_file() and file.name in ['main.js', 'styles.css', 'manifest.json']:
                files[inside(vault, '.obsidian/plugins/workbench-word-preview/' + file.name)] = file.read_bytes()
    conflicts = [str(p.relative_to(vault)) for p, data in files.items() if p.exists() and (not p.is_file() or p.read_bytes() != data)]
    if conflicts:
        raise ValueError('安装已停止，没有写入文件。以下位置已有不同内容，请使用新知识库试用或手动合并：\n' + '\n'.join(conflicts))
    for folder in FOLDERS:
        p = inside(vault, folder)
        if p.exists() and not p.is_dir():
            raise ValueError('安装已停止，目录名称已被文件占用：' + folder)
    return files


def settings_plan(vault, word_preview=False):
    if not inside(vault, '.obsidian/plugins/dataview/manifest.json').is_file():
        raise ValueError('请先在 Obsidian 安装 Dataview，再使用 --enable-settings。')
    def read(relative, default):
        file = inside(vault, relative)
        return json.loads(file.read_text(encoding='utf-8')) if file.exists() else default
    appearance = read('.obsidian/appearance.json', {})
    appearance['enabledCssSnippets'] = list(dict.fromkeys(appearance.get('enabledCssSnippets', []) + ['presales-workbench']))
    plugins = read('.obsidian/community-plugins.json', [])
    plugins = list(dict.fromkeys(plugins + ['dataview'] + (['workbench-word-preview'] if word_preview else [])))
    data = read('.obsidian/plugins/dataview/data.json', {})
    data['enableJavascriptQueries'] = True
    app = read('.obsidian/app.json', {})
    app['showUnsupportedFiles'] = True
    return {'.obsidian/appearance.json': appearance, '.obsidian/community-plugins.json': plugins,
            '.obsidian/plugins/dataview/data.json': data, '.obsidian/app.json': app}


def install(vault, demo=False, word_preview=False, enable_settings=False, dry_run=False):
    vault = Path(vault).expanduser().resolve()
    if vault.exists() and not vault.is_dir():
        raise ValueError('目标知识库不是目录。')
    files = plan(vault, demo, word_preview)
    config = settings_plan(vault, word_preview) if enable_settings else {}
    if dry_run:
        return {'dry_run': True, 'files_to_add': sum(not p.exists() for p in files), 'settings_to_merge': list(config)}
    vault.mkdir(parents=True, exist_ok=True)
    for folder in FOLDERS:
        inside(vault, folder).mkdir(parents=True, exist_ok=True)
    created = 0
    for target, data in files.items():
        if target.exists():
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open('xb') as stream:
            stream.write(data)
        created += 1
    if config:
        backup = vault / '.presales-workbench-backups' / datetime.now().strftime('%Y%m%d-%H%M%S-%f')
        for relative, value in config.items():
            file = inside(vault, relative)
            if file.exists():
                saved = backup / relative
                saved.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(file, saved)
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return {'vault': str(vault), 'files_added': created, 'settings_merged': list(config), 'existing_content_replaced': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--vault', required=True, help='目标 Obsidian 知识库目录，建议先用新库试用')
    parser.add_argument('--demo', action='store_true', help='加入标记为虚构的演示项目和工作记录')
    parser.add_argument('--word-preview', action='store_true', help='安装仅支持 macOS + Microsoft Word 的可选插件')
    parser.add_argument('--enable-settings', action='store_true', help='备份并合并 Dataview、CSS 与文件显示设置；先关闭目标库')
    parser.add_argument('--dry-run', action='store_true', help='只检查安装计划，不创建文件')
    args = parser.parse_args()
    try:
        print(json.dumps(install(args.vault, args.demo, args.word_preview, args.enable_settings, args.dry_run), ensure_ascii=False, indent=2))
    except (ValueError, OSError) as error:
        parser.exit(1, str(error) + '\n')


if __name__ == '__main__':
    main()
