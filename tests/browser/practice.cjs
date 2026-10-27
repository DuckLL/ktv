// Requires Playwright and FFmpeg. Starts an isolated Python fixture server.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { mkdir } = require('node:fs/promises');
const { createInterface } = require('node:readline');
const { createServer } = require('node:net');
const path = require('node:path');

async function until(check, message, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(message);
}

async function assertOffsetRow(page, width) {
  const layout = await page.locator('#offsetBar').evaluate(bar => {
    const bounds = bar.getBoundingClientRect();
    const boxes = [...bar.children].filter(el => getComputedStyle(el).display !== 'none').map(el => el.getBoundingClientRect());
    const centers = boxes.map(box => box.top + box.height / 2);
    return {
      aligned: Math.max(...centers) - Math.min(...centers) < 1,
      contained: boxes.every(box => box.left >= bounds.left && box.right <= bounds.right),
    };
  });
  assert.ok(layout.aligned && layout.contained, `Offset controls must fit on one row at ${width}px: ${JSON.stringify(layout)}`);
}

(async () => {
  const root = path.resolve(__dirname, '../..');
  const reservation = createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = process.env.KTV_TEST_PORT || String(reservation.address().port);
  await new Promise(resolve => reservation.close(resolve));
  const server = spawn(process.env.KTV_TEST_PYTHON || path.join(root, '.venv/bin/python'), [path.join(__dirname, 'server.py')], {
    cwd: root, env: { ...process.env, KTV_TEST_PORT: port },
  });
  let logs = '';
  server.stderr.on('data', data => { logs += data; });
  const output = process.env.KTV_BROWSER_ARTIFACTS || '/tmp/ktv-browser-review';
  let browser;
  try {
    const lines = createInterface({ input: server.stdout });
    const fixture = await Promise.race([
      once(lines, 'line').then(([line]) => JSON.parse(line)),
      once(server, 'exit').then(([code]) => { throw new Error(`Fixture server exited (${code}): ${logs}`); }),
    ]);
    await until(async () => {
      if (server.exitCode !== null) throw new Error(logs);
      try { return (await fetch(fixture.url)).ok; } catch (_) { return false; }
    }, 'Fixture server did not become ready');
    await mkdir(output, { recursive: true });
    browser = await chromium.launch({ args: [
      '--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${fixture.microphone}`,
    ] });
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, permissions: ['microphone'] });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const a = { id: 999999, trackName: '音準測試旋律', artistName: 'KTV', duration: 17, syncedLyrics: '[00:00.50]第一句\n[00:03.00]第二句\n[00:06.00]第三句\n[00:09.00]第四句\n[00:12.00]第五句' };
    const b = { id: 777777, trackName: '另一版本', artistName: 'KTV', duration: 17, syncedLyrics: null };
    await context.route('**/api/songs/search?**', route => route.fulfill({ json: [{ video_id: 'abcdefghijk', title: '搜尋測試歌曲', artist: '測試歌手', duration: 200 }] }));
    await context.route('**/api/process', route => route.fulfill({ status: 202, json: { status: 'queued', video_id: 'abcdefghijk' } }));
    let automaticSearches = 0;
    await context.route('**/api/lyrics/auto?**', route => {
      automaticSearches++;
      return route.fulfill({ json: { query: a.trackName, results: [a], selected: a } });
    });
    await page.goto(fixture.url);
    await page.locator('#urlInput').fill('搜尋測試');
    await page.locator('#submitBtn').click();
    await page.getByRole('button', { name: '加入練唱', exact: true }).click();
    await page.getByRole('button', { name: '已加入歌曲庫', exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, 'search.png'), fullPage: true });

    await page.goto(`${fixture.url}/player?id=pitchdemo01&title=${encodeURIComponent(a.trackName)}&artist=KTV`);
    await page.waitForFunction(() => document.querySelector('#lyricsAutoStatus').textContent.includes('已自動選用'));
    assert.equal(await page.locator('#autoLyricAlignment').isChecked(), true);
    await page.waitForFunction(() => !document.querySelector('#pitchMicToggle').disabled);
    await page.locator('#pitchPanel').evaluate(el => { el.open = true; });
    await page.locator('#pitchMicToggle').click();
    await page.waitForFunction(() => document.querySelector('#pitchMicToggle').textContent === '關閉麥克風');
    await page.locator('#mainVideo').evaluate(video => video.play());
    await page.waitForFunction(() => document.querySelector('#pitchSungNote').textContent === 'A4' && document.querySelector('#pitchStatus').dataset.grade === 'close');
    await page.locator('#mainVideo').evaluate(video => video.pause());
    assert.deepEqual(await page.locator('#offsetSettings button').allTextContents(), ['−0.5s', '+0.5s', '重置']);
    const selection = async () => (await page.request.get(`${fixture.url}/api/selection/pitchdemo01`)).json();
    const savedOffset = async id => (await (await page.request.get(`${fixture.url}/api/offset/pitchdemo01/${id}`)).json()).offset;
    assert.equal((await selection()).synced_lyrics, a.syncedLyrics);
    assert.equal(await page.locator('#offsetValue').textContent(), '+0.00 s');
    await page.locator('#offsetMinus').click();
    assert.equal(await page.locator('#offsetValue').textContent(), '-0.50 s');
    await page.locator('#offsetPlus').click();
    assert.equal(await page.locator('#offsetValue').textContent(), '+0.00 s');
    await page.keyboard.press('[');
    assert.equal(await page.locator('#offsetValue').textContent(), '-0.50 s');
    await page.keyboard.press(']');
    assert.equal(await page.locator('#offsetValue').textContent(), '+0.00 s');
    await page.locator('#offsetMinus').click();
    await page.locator('#offsetReset').click();
    assert.equal(await page.locator('#offsetValue').textContent(), '+0.00 s');
    await page.locator('#offsetPlus').click();
    await until(async () => await savedOffset(a.id) === 0.5, 'Lyric offset was not saved');
    await page.locator('#pitchTolerance').selectOption('relaxed');
    await page.locator('#pitchSensitivity').selectOption('quiet');
    await page.locator('#pitchDelaySlider').evaluate(el => { el.value = '120'; el.dispatchEvent(new Event('input')); });
    assert.ok(await page.locator('#mainVideo').evaluate(el => el.getBoundingClientRect().height >= 100), 'Video collapsed when pitch panel opened');
    await page.locator('.player-main').evaluate(el => { el.scrollTop = 0; });
    await assertOffsetRow(page, 1366);
    await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#lyricsAutoStatus').textContent.includes('已還原'));
    assert.equal(await page.locator('#pitchTolerance').inputValue(), 'relaxed');
    assert.equal(await page.locator('#pitchSensitivity').inputValue(), 'quiet');
    assert.equal(await page.locator('#pitchDelaySlider').inputValue(), '120');
    assert.equal(await page.locator('#autoLyricAlignment').isChecked(), true);
    assert.equal(automaticSearches, 1);
    assert.equal((await selection()).synced_lyrics, a.syncedLyrics);
    assert.equal(await page.locator('#offsetValue').textContent(), '+0.50 s');
    await page.locator('#offsetReset').click();

    // Hold a version's lyric response while the user adjusts the visible version's offset.
    await context.route('**/api/lyrics/search?**', route => route.fulfill({ json: [a, b] }));
    let releaseLyrics;
    let fetchingB = false;
    const gate = new Promise(resolve => { releaseLyrics = resolve; });
    await context.route('**/api/lyrics/777777', async route => {
      fetchingB = true;
      await gate;
      await route.fulfill({ json: { syncedLyrics: '[00:00.50]另一首第一句\n[00:06.00]另一首第二句' } });
    });
    await page.locator('#lyricsSearchInput').fill('測試版本');
    await page.locator('#lyricsSearchBtn').click();
    await page.getByText('另一版本', { exact: true }).waitFor();
    await page.locator('#mainVideo').evaluate(video => { video.currentTime = 1; });
    await page.waitForFunction(() => document.querySelector('.lyric-line.active')?.textContent === '第一句');
    await page.getByText('另一版本', { exact: true }).click();
    await until(() => fetchingB, 'Delayed lyric version was not requested');
    await page.locator('#offsetPlus').click();
    releaseLyrics();
    await until(async () => (await selection()).lrclib_id === '777777', 'New lyric version was not saved');
    assert.match((await selection()).synced_lyrics, /另一首第一句/);
    assert.doesNotMatch((await selection()).synced_lyrics, /\]第一句/);
    await page.locator('#offsetMinus').click();
    await page.getByText(a.trackName, { exact: true }).last().click();
    await page.waitForFunction(() => document.querySelector('#lyricsSelectionSummary').textContent === '音準測試旋律');
    assert.equal(await page.locator('#offsetValue').textContent(), '+0.50 s');
    for (const [id, offset] of [['999999', 0.5], ['777777', -0.5]]) {
      await until(async () => await savedOffset(id) === offset, `Offset lost for version ${id}`);
    }

    for (const width of [800, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      for (const id of ['pitchPanel', 'offsetSettings', 'lyricsSearchPanel']) await page.locator(`#${id}`).evaluate(el => { el.open = true; });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow at ${width}px`);
      await assertOffsetRow(page, width);
      await page.screenshot({ path: path.join(output, `mobile-${width}.png`), fullPage: true });
    }

    // Clear vocal starts support a background correction while keeping one row of controls.
    let aligned = { ...a, id: 333333 };
    const reference = { version: 1, hop_seconds: 0.02, midi: Array(850).fill(null) };
    for (const time of [0.1, 2.6, 5.6, 8.6, 11.6]) reference.midi.fill(69, Math.round(time / 0.02), Math.round((time + 0.8) / 0.02));
    const alignmentPage = await context.newPage();
    alignmentPage.setDefaultTimeout(15000);
    alignmentPage.on('pageerror', error => errors.push(error.message));
    let referenceGate = Promise.resolve();
    await alignmentPage.route('**/api/pitch/pitchdemo01', async route => {
      await referenceGate;
      await route.fulfill({ json: reference });
    });
    await alignmentPage.route('**/api/lyrics/auto?**', route => route.fulfill({ json: { query: aligned.trackName, results: [aligned], selected: aligned } }));
    await alignmentPage.route('**/api/selection/pitchdemo01', route => route.request().method() === 'GET' ? route.fulfill({ status: 204 }) : route.continue());
    await alignmentPage.goto(`${fixture.url}/player?id=pitchdemo01&title=${encodeURIComponent(aligned.trackName)}&artist=KTV`);
    await alignmentPage.waitForFunction(() => document.querySelector('#offsetValue').textContent === '+0.40 s');
    await until(async () => await savedOffset(aligned.id) === 0.4, 'Background lyric correction was not saved');
    assert.equal((await selection()).synced_lyrics, aligned.syncedLyrics);
    await alignmentPage.locator('#offsetPlus').click();
    assert.equal(await alignmentPage.locator('#offsetValue').textContent(), '+0.90 s');
    await until(async () => await savedOffset(aligned.id) === 0.9, 'Manual adjustment after alignment was not saved');
    await alignmentPage.unroute('**/api/selection/pitchdemo01');
    await alignmentPage.reload();
    await alignmentPage.waitForFunction(() => document.querySelector('#lyricsAutoStatus').textContent.includes('已還原'));
    assert.equal(await alignmentPage.locator('#offsetValue').textContent(), '+0.90 s');

    // Disabling cancels a correction that is waiting for reference data.
    aligned = { ...a, id: 444444 };
    let releaseReference;
    referenceGate = new Promise(resolve => { releaseReference = resolve; });
    await alignmentPage.route('**/api/selection/pitchdemo01', route => route.request().method() === 'GET' ? route.fulfill({ status: 204 }) : route.continue());
    await alignmentPage.reload();
    await alignmentPage.waitForFunction(() => document.querySelector('#lyricsAutoStatus').textContent.includes('已自動選用'));
    await alignmentPage.locator('#autoLyricAlignment').uncheck();
    releaseReference();
    await alignmentPage.waitForFunction(() => !document.querySelector('#pitchMicToggle').disabled);
    assert.equal(await alignmentPage.locator('#offsetValue').textContent(), '+0.00 s');
    assert.equal(await savedOffset(aligned.id), 0);

    // The switch stays off on reload; enabling it aligns the currently selected lyrics.
    await alignmentPage.reload();
    await alignmentPage.waitForFunction(() => document.querySelector('#lyricsAutoStatus').textContent.includes('已自動選用') && !document.querySelector('#pitchMicToggle').disabled);
    assert.equal(await alignmentPage.locator('#autoLyricAlignment').isChecked(), false);
    assert.equal(await alignmentPage.locator('#offsetValue').textContent(), '+0.00 s');
    await alignmentPage.locator('#autoLyricAlignment').check();
    await alignmentPage.waitForFunction(() => document.querySelector('#offsetValue').textContent === '+0.40 s');
    await until(async () => await savedOffset(aligned.id) === 0.4, 'Enabling automatic alignment did not save the correction');
    await alignmentPage.locator('#autoLyricAlignment').uncheck();
    assert.equal(await alignmentPage.locator('#offsetValue').textContent(), '+0.40 s');
    await alignmentPage.close();
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ search: 'passed', microphoneA4: 'passed', automaticLyrics: 'passed', backgroundAlignment: 'passed', autoAlignmentSwitch: 'passed', lyricOffsetControls: 'passed', versionSwitchRace: 'passed', offsetPersistence: 'passed', settingsPersistence: 'passed', layoutWidths: [1366, 800, 768, 390, 320], pageErrors: errors, artifacts: output }));
  } finally {
    await browser?.close();
    server.kill('SIGTERM');
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
