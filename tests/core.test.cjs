const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const CODE = path.join(__dirname, '../vault/90-其他/工作台');
const organization = require(path.join(CODE, 'project-organization.js'));
const store = require(path.join(CODE, 'task-store.js'));
const weekly = require(path.join(CODE, 'weekly.js'));

function mockVault(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'presales-test-'));
  t.after(() => fs.rmSync(base, {recursive: true, force: true}));
  const put = (rel, content) => {const p = path.join(base, rel); fs.mkdirSync(path.dirname(p), {recursive: true}); fs.writeFileSync(p, content);};
  function file(rel) {
    const p = path.join(base, rel);
    if (!fs.existsSync(p)) return null;
    const stat = fs.statSync(p), name = path.basename(rel);
    const info = {path: rel, name, parent: {path: path.dirname(rel), name: path.basename(path.dirname(rel))}, stat: {size: stat.size, mtime: stat.mtimeMs, ctime: stat.ctimeMs}};
    if (stat.isDirectory()) info.children = [];
    else Object.assign(info, {extension: path.extname(rel).slice(1), basename: name.slice(0, -path.extname(rel).length || undefined)});
    return info;
  }
  function files(root = '') {
    if (!fs.existsSync(path.join(base, root))) return [];
    return fs.readdirSync(path.join(base, root)).flatMap(name => {
      const rel = path.posix.join(root, name), p = path.join(base, rel);
      return fs.lstatSync(p).isDirectory() ? files(rel) : [file(rel)];
    });
  }
  const app = {vault: {
    adapter: {getBasePath: () => base, exists: async rel => fs.existsSync(path.join(base, rel)),
      read: async rel => fs.readFileSync(path.join(base, rel), 'utf8'), write: async (rel, s) => put(rel, s)},
    getAbstractFileByPath: file, getFiles: files, getMarkdownFiles: () => files().filter(f => f.extension === 'md'),
    createFolder: async rel => fs.mkdirSync(path.join(base, rel), {recursive: true}),
    create: async (rel, text) => {assert.equal(file(rel), null); put(rel, text); return file(rel);},
    cachedRead: async f => fs.readFileSync(path.join(base, f.path), 'utf8'),
    process: async (f, fn) => put(f.path, fn(fs.readFileSync(path.join(base, f.path), 'utf8'))),
    modify: async (f, text) => put(f.path, text),
    trash: async f => fs.rmSync(path.join(base, f.path), {recursive: true}),
  }, metadataCache: {getFileCache: () => ({frontmatter: {}})}};
  return {base, put, app};
}

test('organizing preserves business text, source bytes and manually selected versions', async t => {
  const {base, put, app} = mockVault(t), folder = '30-近期工作/示例';
  const original = '# Existing business decisions\n\nKeep this paragraph.\n';
  put(folder + '/📂 索引.md', original);
  put(folder + '/说明.md', '# The reviewed task description');
  put(folder + '/交付物/older.pdf', 'older adopted version');
  put(folder + '/交付物/newer.pdf', 'new unreviewed draft');
  await organization.apply(app, folder, {overrides: {'交付物/older.pdf': {pinned: true}}});
  const text = fs.readFileSync(path.join(base, folder, '📂 索引.md'), 'utf8');
  assert.ok(text.startsWith(original));
  assert.equal(fs.readFileSync(path.join(base, folder, '交付物/older.pdf'), 'utf8'), 'older adopted version');
  assert.equal(fs.readFileSync(path.join(base, folder, '交付物/newer.pdf'), 'utf8'), 'new unreviewed draft');
  assert.deepEqual(organization.scan(app, folder).files.filter(f => f.pinned).map(f => f.relative), ['交付物/older.pdf']);
  await organization.apply(app, folder);
  assert.equal(fs.readFileSync(path.join(base, folder, '📂 索引.md'), 'utf8').split('<!-- workbench-organization:start -->').length, 2);
});

test('undo protects business edits made after organizing', async t => {
  const {base, put, app} = mockVault(t), folder = '30-近期工作/并发示例';
  put(folder + '/📂 索引.md', '# Keep');
  await organization.apply(app, folder);
  fs.appendFileSync(path.join(base, folder, '📂 索引.md'), '\nNew decision from another editor.\n');
  await assert.rejects(organization.undo(app, folder), /新的修改/);
  assert.match(fs.readFileSync(path.join(base, folder, '📂 索引.md'), 'utf8'), /New decision/);
});

test('project navigation refuses traversal and symlink destinations', t => {
  const {base, put, app} = mockVault(t);
  put('30-近期工作/真实目录/说明.md', '# task');
  assert.throws(() => organization.context(app, '../outside'), /选择/);
  fs.symlinkSync(path.join(base, '30-近期工作/真实目录'), path.join(base, '30-近期工作/链接'));
  assert.throws(() => organization.context(app, '30-近期工作/链接'), /符号链接/);
});

test('new work commits once, keeps its reviewed description, and does not overwrite a same-named task', async t => {
  const {base, put, app} = mockVault(t);
  put('30-近期工作/同名/说明.md', 'Existing task must stay intact');
  const draft = store.createDraft({title: '同名', folder_name: '同名', background: 'A fictional task', first_action: 'Draft an outline', focus: false});
  await store.saveDraft(app, draft);
  const saved = await store.commitDraft(app, draft);
  assert.equal(saved.folder, '30-近期工作/同名-2');
  assert.equal(fs.readFileSync(path.join(base, '30-近期工作/同名/说明.md'), 'utf8'), 'Existing task must stay intact');
  const text = fs.readFileSync(path.join(base, saved.briefPath), 'utf8');
  assert.match(text, /A fictional task/);
  assert.deepEqual(await store.commitDraft(app, draft), saved);
  assert.equal(fs.readFileSync(path.join(base, saved.briefPath), 'utf8'), text);
});

test('weekly refresh data cannot replace selected candidate notes or draft prose', t => {
  const {put, app} = mockVault(t), period = {start: '2026-11-09', end: '2026-11-14'};
  const items = [{id: 'manual:1', title: 'Reviewed result', checked: true, manual_text: 'My edits'}];
  weekly.setCandidates(app, period, items);
  weekly.saveDraft(app, period, {markdown: 'My edited weekly report'});
  put('90-其他/工作台/.weekly/2026-11-09_2026-11-14/feed.json', JSON.stringify({items: [{id: 'other', title: 'new source'}]}));
  assert.deepEqual(weekly.candidates(app, period), items);
  assert.equal(weekly.draft(app, period).markdown, 'My edited weekly report');
  assert.throws(() => weekly.context(app, {start: 'bad', end: 'bad'}));
});

test('intake rejects escaping vault-relative paths', () => {
  for (const invalid of ['../outside', '/tmp/file', 'folder/../outside', '.obsidian/file', 'folder\\file']) {
    assert.throws(() => store.validPath(invalid));
  }
  assert.equal(store.validPath('30-近期工作/示例'), '30-近期工作/示例');
});
