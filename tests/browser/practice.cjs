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
    const boxes = [...bar.children].filter(el => getComputedStyle(el).display !== 'none' && getComputedStyle(el).position !== 'absolute').map(el => el.getBoundingClientRect());
    const centers = boxes.map(box => box.top + box.height / 2);
    return {
      aligned: Math.max(...centers) - Math.min(...centers) < 1,
      contained: boxes.every(box => box.left >= bounds.left && box.right <= bounds.right),
    };
  });
  assert.ok(layout.aligned && layout.contained, `Offset controls must fit on one row at ${width}px: ${JSON.stringify(layout)}`);
}

async function assertMixRow(page, width) {
  const layout = await page.locator('.audio-toggle').evaluate(bar => {
    const bounds = bar.getBoundingClientRect();
    const boxes = ['btnInstrumental', 'vocalMixSlider', 'btnOriginal'].map(id => document.getElementById(id).getBoundingClientRect());
    const centers = boxes.map(box => box.top + box.height / 2);
    return {
      aligned: Math.max(...centers) - Math.min(...centers) < 1,
      contained: boxes.every(box => box.left >= bounds.left && box.right <= bounds.right),
      sliderWidth: boxes[1].width,
    };
  });
  assert.ok(layout.aligned && layout.contained && layout.sliderWidth >= 60, `Accompaniment, mix slider and original must fit on one usable row at ${width}px: ${JSON.stringify(layout)}`);
}

async function assertNativeFullscreen(page) {
  const video = page.locator('#mainVideo');
  await video.hover();
  const bounds = await video.boundingBox();
  // Chromium's built-in fullscreen control sits beside its overflow menu.
  await page.mouse.click(bounds.x + bounds.width - 72, bounds.y + bounds.height - 48);
  await page.waitForFunction(() => document.fullscreenElement === document.querySelector('#mainVideo'));
  assert.equal(await video.evaluate(element => {
    const box = element.getBoundingClientRect();
    return element.controls && box.width >= innerWidth - 1 && box.height >= innerHeight - 1;
  }), true);
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForFunction(() => !document.fullscreenElement);
}

async function assertNativeVolume(page) {
  const session = await page.context().newCDPSession(page);
  async function nativeControl(pseudo) {
    const { root } = await session.send('DOM.getDocument', { depth:-1, pierce:true });
    const candidates = [];
    function visit(node) {
      const attributes = Object.fromEntries((node.attributes || []).reduce((pairs, value, index, all) => index % 2 ? pairs : [...pairs, [value,all[index+1]]], []));
      if (attributes.pseudo === pseudo && attributes['aria-hidden'] !== 'true' && !attributes.style?.includes('display: none')) candidates.push({ node,attributes });
      for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) visit(child);
    }
    visit(root);
    assert.ok(candidates.length, `Native control missing: ${pseudo}`);
    const { node,attributes } = candidates[0];
    assert.equal(Object.hasOwn(attributes,'disabled'), false, `Native control disabled: ${pseudo}`);
    const { model } = await session.send('DOM.getBoxModel', { nodeId:node.nodeId });
    return { x:model.border[0], y:model.border[1], width:model.border[2]-model.border[0], height:model.border[5]-model.border[1] };
  }
  async function gains(volume, mix) {
    await page.waitForFunction(({volume,mix}) => {
      const nodes = window.__testTrackGains;
      return nodes?.length >= 2 && Math.abs(nodes[0].gain.value - volume * (1-mix)) < 0.003 && Math.abs(nodes[1].gain.value - volume * mix) < 0.003;
    }, { volume,mix });
  }
  async function clickMute(expected) {
    const button = await nativeControl('-webkit-media-controls-mute-button');
    await page.mouse.click(button.x + button.width/2, button.y + button.height/2);
    await page.waitForFunction(muted => document.querySelector('#mainVideo').muted === muted, expected);
  }
  try {
    await page.locator('#vocalMixSlider').evaluate(slider => { slider.value='35'; slider.dispatchEvent(new Event('input')); });
    await gains(0.8,0.35);
    await page.locator('#mainVideo').hover();
    const button = await nativeControl('-webkit-media-controls-mute-button');
    await page.mouse.move(button.x + button.width/2, button.y + button.height/2);
    let slider;
    await until(async () => {
      slider = await nativeControl('-webkit-media-controls-volume-slider');
      return slider.width >= 50;
    }, 'Native volume slider did not expand');
    await page.mouse.click(slider.x + slider.width * 0.4, slider.y + slider.height/2);
    await page.waitForFunction(() => {
      const volume = document.querySelector('#mainVideo').volume;
      return volume > 0.2 && volume < 0.6 && document.querySelector('#volumeSlider').value === String(Math.round(volume*100));
    });
    const volume = await page.locator('#mainVideo').evaluate(video => Math.round(video.volume*100)/100);
    assert.equal(await page.locator('#volumeSlider').inputValue(), String(Math.round(volume*100)));
    await gains(volume,0.35);
    await clickMute(true);
    await gains(0,0.35);
    assert.equal(await page.locator('#volumeValue').textContent(), '靜音');
    await page.locator('#vocalMixSlider').evaluate(slider => { slider.value='75'; slider.dispatchEvent(new Event('input')); });
    await page.locator('#keySelect').selectOption('1');
    await page.waitForFunction(() => document.querySelector('#keySelect').value === '1' && document.querySelector('#keyStatus').textContent === '');
    assert.equal(await page.locator('#mainVideo').evaluate(video => video.muted), true);
    await gains(0,0.75);
    await page.locator('#keySelect').selectOption('0');
    await page.waitForFunction(() => document.querySelector('#keySelect').value === '0' && document.querySelector('#keyStatus').textContent === '');
    await page.locator('#mainVideo').hover();
    await clickMute(false);
    await gains(volume,0.75);
    await page.locator('#volumeSlider').evaluate(slider => { slider.value='65'; slider.dispatchEvent(new Event('input')); });
    await page.waitForFunction(() => Math.abs(document.querySelector('#mainVideo').volume-0.65)<0.001);
    await gains(0.65,0.75);
    await page.locator('.player-logo').focus();
    await page.keyboard.press('ArrowDown');
    await page.waitForFunction(() => Math.abs(document.querySelector('#mainVideo').volume-0.55)<0.001);
    await gains(0.55,0.75);
    await page.locator('#mainVideo').evaluate(video => { video.volume=0.8; });
    await page.locator('#btnInstrumental').click();
    await gains(0.8,0);
  } finally {
    await session.detach();
  }
}

async function settingsTab(page, name) {
  await page.waitForFunction(() => {
    const phone = innerWidth <= 760 || (innerWidth <= 960 && innerHeight <= 500);
    return document.querySelector('#playerSettingsContent')?.parentElement.id === (phone ? 'mobileSettings' : 'desktopSettings');
  });
  if (await page.locator('#mobileSettings #playerSettingsContent').count()) {
    if (!await page.locator('#mobileSettings').evaluate(el => el.open)) await page.locator('#mobileSettingsOpen').click();
    await page.locator(`#mobileTab${name}`).click();
  }
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
    await context.addInitScript(() => {
      window.__testTrackGains = [];
      const create = AudioContext.prototype.createGain;
      AudioContext.prototype.createGain = function() {
        const gain = create.call(this);
        window.__testTrackGains.push(gain);
        return gain;
      };
    });
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
    for (const id of ['offsetMinus', 'offsetFineMinus', 'offsetFinePlus', 'offsetPlus', 'mobilePitchVisible', 'volumeSlider', 'keySelect']) assert.equal(await page.locator(`#${id}`).isVisible(), true, `Desktop control hidden: ${id}`);
    assert.equal(await page.locator('#desktopSoundSettings #playbackSettings').count(), 1);
    assert.equal(await page.locator('#desktopLyricSettings #offsetSettings').count(), 1);
    assert.equal(await page.locator('#desktopPitchSettings #mobilePitchVisible').count(), 1);
    assert.equal(await page.locator('#autoLyricAlignment').count(), 0);
    assert.equal(await page.locator('#mobileFullscreen').count(), 0);
    assert.equal(await page.locator('#mainVideo').evaluate(video => video.controlsList.contains('nofullscreen')), false);
    await page.waitForFunction(() => !document.querySelector('#pitchMicToggle').disabled);
    await page.locator('#pitchPanel').evaluate(el => { el.open = true; });
    await page.locator('#pitchMicToggle').click();
    await page.waitForFunction(() => document.querySelector('#pitchMicToggle').textContent === '關閉麥克風');
    await page.locator('#mainVideo').focus();
    await page.keyboard.press('Space');
    await page.waitForFunction(() => document.querySelector('#pitchSungNote').textContent === 'A4' && document.querySelector('#pitchStatus').dataset.grade === 'close');
    await assertNativeVolume(page);
    await page.locator('#mainVideo').focus();
    await page.keyboard.press('Space');
    await page.waitForFunction(() => document.querySelector('#mainVideo').paused);
    const desktopMv = await page.evaluate(() => {
      const video = document.querySelector('.video-wrap').getBoundingClientRect();
      const sound = document.querySelector('#desktopSoundSettings').getBoundingClientRect();
      return { soundOnRight:sound.left >= video.right - 1 && Math.abs(sound.top - video.top) < 2, videoHeight:video.height, nativeControls:document.querySelector('#mainVideo').controls, overlays:document.querySelector('.video-wrap').querySelectorAll('button,a').length, stageHeight:document.querySelector('#mvStage').getBoundingClientRect().height };
    });
    assert.ok(desktopMv.soundOnRight && desktopMv.nativeControls && desktopMv.overlays === 0 && desktopMv.videoHeight >= 390, `Desktop native MV and sound controls are misplaced: ${JSON.stringify(desktopMv)}`);
    await assertMixRow(page, 1366);
    await page.locator('#mobileMvToggle').click();
    assert.ok(await page.locator('#mvStage').evaluate(el => el.getBoundingClientRect().height) < desktopMv.stageHeight - 100, 'Hiding MV leaves an empty tall panel');
    const collapsedDesktop = await page.locator('#mainVideo').boundingBox();
    await page.mouse.click(collapsedDesktop.x + collapsedDesktop.width * 0.6, collapsedDesktop.y + collapsedDesktop.height - 22);
    await page.waitForFunction(() => {
      const video = document.querySelector('#mainVideo');
      return video.controls && video.currentTime > 8 && video.currentTime < 12;
    });
    await page.locator('#mobileMvToggle').click();
    await page.locator('#mainVideo').evaluate(video => { video.currentTime = 1; });
    await page.waitForFunction(() => document.querySelector('.lyric-line.active')?.textContent === '第一句');
    await page.locator('#nextLine').click();
    await page.waitForFunction(() => document.querySelector('.lyric-line.active')?.textContent === '第二句');
    await page.locator('#previousLine').click();
    await page.waitForFunction(() => document.querySelector('.lyric-line.active')?.textContent === '第一句');
    await settingsTab(page, 'Lyrics');
    assert.deepEqual(await page.locator('#offsetSettings button').allTextContents(), ['−0.5s', '−0.2s', '+0.2s', '+0.5s', '重置']);
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
    await page.locator('#offsetFinePlus').click();
    assert.equal(await page.locator('#offsetValue').textContent(), '+0.20 s');
    await page.locator('#offsetFinePlus').click();
    assert.equal(await page.locator('#offsetValue').textContent(), '+0.40 s');
    await page.locator('#offsetMinus').click();
    assert.equal(await page.locator('#offsetValue').textContent(), '-0.10 s');
    await page.locator('#offsetFineMinus').click();
    assert.equal(await page.locator('#offsetValue').textContent(), '-0.30 s');
    await page.locator('#offsetPlus').click();
    assert.equal(await page.locator('#offsetValue').textContent(), '+0.20 s');
    await page.locator('#offsetFineMinus').click();
    assert.equal(await page.locator('#offsetValue').textContent(), '+0.00 s');
    await page.locator('#offsetMinus').click();
    await page.locator('#offsetReset').click();
    assert.equal(await page.locator('#offsetValue').textContent(), '+0.00 s');
    await page.locator('#offsetPlus').click();
    await until(async () => await savedOffset(a.id) === 0.5, 'Lyric offset was not saved');
    await settingsTab(page, 'Pitch');
    await page.locator('#pitchTolerance').selectOption('relaxed');
    await page.locator('#mobilePitchAdvanced > summary').click();
    await page.locator('#pitchSensitivity').selectOption('quiet');
    await page.locator('#pitchDelaySlider').evaluate(el => { el.value = '120'; el.dispatchEvent(new Event('input')); });
    await page.locator('#mobilePitchAdvanced > summary').click();
    assert.ok(await page.locator('#mainVideo').evaluate(el => el.getBoundingClientRect().height >= 100), 'Video collapsed when pitch panel opened');
    await page.locator('.player-main').evaluate(el => { el.scrollTop = 0; });
    await settingsTab(page, 'Lyrics');
    await assertOffsetRow(page, 1366);
    await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#lyricsAutoStatus').textContent.includes('已還原'));
    assert.equal(await page.locator('#pitchTolerance').inputValue(), 'relaxed');
    assert.equal(await page.locator('#pitchSensitivity').inputValue(), 'quiet');
    assert.equal(await page.locator('#pitchDelaySlider').inputValue(), '120');
    assert.equal(await page.locator('#autoLyricAlignment').count(), 0);
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
    if (!await page.locator('#lyricsSearchPanel').evaluate(el => el.open)) await page.locator('#mobileChangeLyrics').click();
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

    let testedSettingsKey = false;
    for (const [width,height] of [[1280,720],[800,844],[768,844],[430,932],[390,844],[390,700],[320,568]]) {
      await page.setViewportSize({ width, height });
      await settingsTab(page, 'Sound');
      await assertMixRow(page, width);
      await settingsTab(page, 'Lyrics');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow at ${width}px`);
      await page.screenshot({ path: path.join(output, `settings-${width}-${height}.png`), fullPage: true });
      if (width <= 760) {
        const before = await page.locator('#mainVideo').evaluate(video => video.currentTime);
        await page.locator('#mobileTabLyrics').focus();
        await page.keyboard.press('ArrowRight');
        assert.equal(await page.locator('#mobileTabPitch').getAttribute('aria-selected'), 'true');
        assert.ok(Math.abs(await page.locator('#mainVideo').evaluate(video => video.currentTime) - before) < 0.1, 'Changing settings tabs sought the song');
        await page.keyboard.press('Escape');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'mobileSettingsOpen');
        assert.equal(await page.locator('#mobileLyricSettings #offsetSettings').count(), 1);
        assert.equal(await page.locator('#offsetMinus').isVisible(), true);
        await page.locator('#offsetMinus').click();
        await page.locator('#offsetPlus').click();
        assert.equal(await page.locator('#mobileSettings').evaluate(el => el.open), false, 'Live lyric adjustment opened the settings modal');
        assert.equal(await page.locator('#mobileMixSettings #vocalMixSlider').count(), 1);
        assert.equal(await page.locator('#vocalMixSlider').isVisible(), true);
        await assertMixRow(page, width);
        await page.locator('#btnOriginal').click();
        assert.equal(await page.locator('#vocalMixValue').textContent(), '100%');
        await page.locator('#vocalMixSlider').evaluate(slider => {
          slider.value = '35';
          slider.dispatchEvent(new Event('input', { bubbles:true }));
        });
        assert.equal(await page.locator('#vocalMixValue').textContent(), '35%');
        await page.locator('#btnInstrumental').click();
        assert.equal(await page.locator('#vocalMixValue').textContent(), '0%');
        assert.equal(await page.locator('#mobileSoundPanel #keySelect').count(), 1);
        assert.equal(await page.locator('.player-main #keySelect').count(), 0);
        assert.equal(await page.locator('#keySelect').isVisible(), false);
        await settingsTab(page, 'Sound');
        assert.equal(await page.locator('#keySelect').isVisible(), true, 'Key controls cannot be reached in settings');
        if (!testedSettingsKey) {
          await page.locator('#mobileKeyUp').click();
          await page.waitForFunction(() => document.querySelector('#keySelect').value === '1' && document.querySelector('#keyStatus').textContent === '');
          await page.locator('#mobileKeyDown').click();
          await page.waitForFunction(() => document.querySelector('#keySelect').value === '0' && document.querySelector('#keyStatus').textContent === '');
          testedSettingsKey = true;
        }
        await page.locator('#mobileSettingsClose').click();
        if (height >= 800) {
          await page.waitForFunction(() => document.querySelector('#pitchCanvas').clientHeight >= 110);
          assert.ok(await page.locator('#lyricsStage').evaluate(stage => stage.clientHeight) >= 180, 'Larger pitch chart squeezed the lyrics');
        }
        assert.equal(await page.locator('#keySelect').count(), 1);
        assert.equal(await page.locator('#vocalMixSlider').count(), 1);
      }
      await assertOffsetRow(page, width);
      const beforeFineAdjustment = await page.locator('#offsetValue').textContent();
      await page.locator('#offsetFineMinus').click();
      await page.locator('#offsetFinePlus').click();
      assert.equal(await page.locator('#offsetValue').textContent(), beforeFineAdjustment);
      assert.equal(await page.locator('#autoLyricAlignment').count(), 0);
      assert.equal(await page.locator('#mobileFullscreen').count(), 0);
      assert.equal(await page.locator('#mainVideo').evaluate(video => video.controlsList.contains('nofullscreen')), false);
      const layout = await page.evaluate(() => {
        const video = document.querySelector('.video-wrap').getBoundingClientRect();
        const lyrics = document.querySelector('#lyricsStage').getBoundingClientRect();
        const pitch = document.querySelector('#mobilePitchCard').getBoundingClientRect();
        const visibleLines = [...document.querySelectorAll('.lyric-line')].filter(el => getComputedStyle(el).display !== 'none').length;
        const source = document.querySelector('#mainVideo');
        const phone = innerWidth <= 760;
        const offset = document.querySelector(phone ? '#mobileLyricSettings' : '#desktopLyricSettings').getBoundingClientRect();
        const previous = document.querySelector('#previousLine').getBoundingClientRect();
        const next = document.querySelector('#nextLine').getBoundingClientRect();
        const sound = document.querySelector('#desktopSoundSettings').getBoundingClientRect();
        const live = document.querySelector('#mobileLiveSound').getBoundingClientRect();
        return { ordered: video.bottom <= offset.top + 1 && offset.bottom <= lyrics.top + 1 && lyrics.bottom <= pitch.top + 1 && (!phone || video.bottom <= live.top + 1 && live.bottom <= offset.top + 1), visible: pitch.bottom <= innerHeight + 1, ratio: video.width / video.height, sourceRatio:source.videoWidth / source.videoHeight, overlays:document.querySelector('.video-wrap').querySelectorAll('button,a').length, nativeControls:source.controls, rails:previous.height >= 88 && next.height >= 88 && previous.right <= lyrics.left + 1 && next.left >= lyrics.right - 1, soundOnRight:phone || sound.left >= video.right - 1, lyricsHeight: lyrics.height, visibleLines };
      });
      assert.ok(layout.ordered && layout.visible && layout.soundOnRight, `MV, lyrics, pitch and sound controls are misplaced: ${JSON.stringify(layout)}`);
      assert.equal(layout.visibleLines, 5, 'Some lyrics were hidden instead of scrollable');
      assert.equal(layout.overlays, 0, 'Extra buttons cover the native video controls');
      assert.equal(layout.nativeControls, true);
      assert.equal(layout.rails, true, 'Previous/next are not tall buttons beside the lyrics');
      assert.equal(await page.locator('#mobileTransport').count(), 0);
      assert.equal(await page.locator('.player-header #youtubeLink').count(), 1);
      if (width <= 760) {
        assert.ok(Math.abs(layout.ratio - layout.sourceRatio) < 0.01, 'Phone MV does not use its source aspect ratio');
        assert.equal(await page.locator('#mobileVideoActions #mobileMvToggle').count(), 1);
      }
      if (width === 320) {
        await page.locator('#lyricsStage').evaluate(el => { el.scrollTop = el.scrollHeight; });
        assert.ok(await page.locator('#lyricsStage').evaluate(el => el.scrollTop > 0), 'Full lyrics cannot be scrolled');
        await page.locator('#mainVideo').evaluate(video => { video.currentTime = 6.5; });
        await page.waitForFunction(() => document.querySelector('.lyric-line.active')?.textContent === '第三句');
        await page.waitForFunction(() => getComputedStyle(document.querySelector('.lyric-line.active')).color === 'rgb(255, 60, 172)');
        assert.equal(await page.evaluate(() => scrollY), 0, 'Lyric following scrolled the whole page');
      }
      await page.screenshot({ path: path.join(output, `player-${width}-${height}.png`), fullPage: true });
    }

    // Native video controls keep audio and lyrics synchronized while settings are open.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#mainVideo').focus();
    await page.keyboard.press('Space');
    await page.waitForFunction(() => !document.querySelector('#mainVideo').paused);
    const playingAt = await page.locator('#mainVideo').evaluate(video => video.currentTime);
    await settingsTab(page, 'Sound');
    await page.waitForFunction(time => document.querySelector('#mainVideo').currentTime > time + 0.3, playingAt);
    await page.locator('#mobileMvToggle').click();
    await page.waitForFunction(() => document.querySelector('.video-wrap').classList.contains('mv-collapsed'));
    assert.equal(await page.locator('#mainVideo').evaluate(video => video.controls && !video.paused), true);
    assert.equal(await page.locator('.video-wrap').evaluate(el => el.hidden), false, 'Hiding MV removed native playback controls');
    await page.locator('#mobileSettingsClose').click();
    await page.locator('#mainVideo').focus();
    await page.keyboard.press('Space');
    await page.waitForFunction(() => document.querySelector('#mainVideo').paused);
    const collapsedVideo = await page.locator('#mainVideo').boundingBox();
    await page.mouse.click(collapsedVideo.x + collapsedVideo.width * 0.6, collapsedVideo.y + collapsedVideo.height - 22);
    await page.waitForFunction(() => {
      const time = document.querySelector('#mainVideo').currentTime;
      return time > 8 && time < 12;
    });
    await settingsTab(page, 'Sound');
    await page.locator('#mobileMvToggle').click();
    await page.locator('#mobileSettingsClose').click();
    await page.locator('#mainVideo').evaluate(video => { video.currentTime = 6.5; });
    await page.waitForFunction(() => Math.abs(document.querySelector('#mainVideo').currentTime - 6.5) < 0.1);
    await page.locator('#nextLine').click();
    await page.waitForFunction(() => document.querySelector('.lyric-line.active')?.textContent === '第四句');
    await settingsTab(page, 'Pitch');
    await page.locator('#mobilePitchVisible').uncheck();
    assert.equal(await page.locator('#mobilePitchCard').isVisible(), false);
    await page.locator('#mobilePitchVisible').check();
    await page.locator('#mobileSettingsClose').click();
    await settingsTab(page, 'Sound');
    assert.equal(await page.locator('#youtubeLink').isVisible(), true);
    assert.equal(await page.getByRole('button', { name:/全螢幕/ }).count(), 0);
    await page.locator('#mobileSettingsClose').click();
    await assertNativeFullscreen(page);
    for (const [width,height] of [[844,390],[568,320]]) {
      await page.setViewportSize({ width,height });
      await page.waitForFunction(() => document.querySelector('#mobileSettings #playerSettingsContent'));
      assert.equal(await page.locator('#mobileSettingsOpen').isVisible(), true);
      assert.equal(await page.locator('#vocalMixSlider').isVisible(), true);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector('#mobilePitchCard').getBoundingClientRect().bottom <= innerHeight + 1 && document.querySelector('#lyricsStage').clientHeight >= 88));
      await assertOffsetRow(page, width);
      await assertMixRow(page, width);
      await page.screenshot({ path: path.join(output, `landscape-${width}.png`), fullPage: true });
      await settingsTab(page, 'Sound');
      await page.locator('#mobileMvToggle').click();
      await page.locator('#mobileSettingsClose').click();
      await page.waitForFunction(() => document.querySelector('.video-wrap').classList.contains('mv-collapsed') && document.querySelector('#lyricsStage').clientHeight >= 88);
      await assertMixRow(page, width);
      await page.screenshot({ path: path.join(output, `landscape-collapsed-${width}.png`), fullPage: true });
      await settingsTab(page, 'Sound');
      await page.locator('#mobileMvToggle').click();
      await page.locator('#mobileSettingsClose').click();
    }
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.waitForFunction(() => document.querySelector('#desktopSettings #playerSettingsContent'));
    assert.equal(await page.locator('#mobileSettings').evaluate(el => el.open), false);
    assert.equal(await page.locator('#desktopSettings #playerSettingsContent').count(), 1);
    assert.equal(await page.locator('#desktopSoundSettings #vocalMixSlider').count(), 1);
    assert.equal(await page.locator('#desktopSoundSettings #keySelect').count(), 1);
    await assertMixRow(page, 1366);
    assert.equal(await page.locator('#pitchCanvas').count(), 1);
    assert.equal(await page.getByRole('button', { name:/全螢幕/ }).count(), 0);
    assert.equal(await page.locator('#mainVideo').evaluate(video => video.controls), true);
    await assertNativeFullscreen(page);

    // Even a legacy enabled setting and clear vocal starts must not change lyric timing.
    const aligned = { ...a, id: 444444 };
    const reference = { version: 1, hop_seconds: 0.02, midi: Array(850).fill(null) };
    for (const time of [0.1, 2.6, 5.6, 8.6, 11.6]) reference.midi.fill(69, Math.round(time / 0.02), Math.round((time + 0.8) / 0.02));
    const alignmentPage = await context.newPage();
    alignmentPage.setDefaultTimeout(15000);
    alignmentPage.on('pageerror', error => errors.push(error.message));
    await alignmentPage.addInitScript(() => {
      const settings = JSON.parse(localStorage.getItem('ktv-practice-settings') || '{}');
      localStorage.setItem('ktv-practice-settings', JSON.stringify({ ...settings, autoLyricAlignment:true }));
    });
    await alignmentPage.route('**/api/pitch/pitchdemo01', route => route.fulfill({ json:reference }));
    await alignmentPage.route('**/api/lyrics/auto?**', route => route.fulfill({ json: { query: aligned.trackName, results: [aligned], selected: aligned } }));
    await alignmentPage.route('**/api/selection/pitchdemo01', route => route.request().method() === 'GET' ? route.fulfill({ status: 204 }) : route.continue());
    const offsetWrites = [];
    await alignmentPage.route('**/api/offset/pitchdemo01/**', route => {
      if (route.request().method() === 'POST') offsetWrites.push(route.request().postDataJSON());
      return route.continue();
    });
    await alignmentPage.goto(`${fixture.url}/player?id=pitchdemo01&title=${encodeURIComponent(aligned.trackName)}&artist=KTV`);
    await alignmentPage.waitForFunction(() => document.querySelector('#lyricsAutoStatus').textContent.includes('已自動選用') && !document.querySelector('#pitchMicToggle').disabled);
    await alignmentPage.waitForTimeout(900); // Catch a background correction being saved after pitch data arrives.
    assert.equal(await alignmentPage.locator('#offsetValue').textContent(), '+0.00 s');
    assert.equal(await savedOffset(aligned.id), 0);
    assert.deepEqual(offsetWrites, []);
    assert.equal((await selection()).synced_lyrics, aligned.syncedLyrics);
    await alignmentPage.locator('#offsetFinePlus').click();
    assert.equal(await alignmentPage.locator('#offsetValue').textContent(), '+0.20 s');
    await until(async () => await savedOffset(aligned.id) === 0.2, 'Fine manual adjustment was not saved');
    await alignmentPage.unroute('**/api/selection/pitchdemo01');
    await alignmentPage.reload();
    await alignmentPage.waitForFunction(() => document.querySelector('#lyricsAutoStatus').textContent.includes('已還原') && !document.querySelector('#pitchMicToggle').disabled);
    await alignmentPage.waitForTimeout(900);
    assert.equal(await alignmentPage.locator('#offsetValue').textContent(), '+0.20 s');
    assert.equal(await alignmentPage.locator('#autoLyricAlignment').count(), 0);
    assert.deepEqual(offsetWrites, [{ offset:0.2 }]);
    await alignmentPage.locator('#offsetReset').click();
    await until(async () => await savedOffset(aligned.id) === 0, 'Reset did not save zero');
    await alignmentPage.close();

    // Clearing forgets a bad choice and cancels pending offsets, including across reloads.
    const clearPage = await context.newPage();
    await clearPage.setViewportSize({ width:390, height:844 });
    clearPage.on('pageerror', error => errors.push(error.message));
    await clearPage.goto(`${fixture.url}/player?id=pitchdemo01&title=${encodeURIComponent(a.trackName)}&artist=KTV`);
    await clearPage.waitForFunction(() => document.querySelector('#lyricsAutoStatus').textContent.includes('已還原'));
    await settingsTab(clearPage, 'Lyrics');
    await clearPage.locator('#mobileSettingsClose').click();
    await clearPage.locator('#offsetPlus').click();
    await settingsTab(clearPage, 'Lyrics');
    const searchesBeforeClear = automaticSearches;
    await clearPage.locator('#lyricsClearMemory').click();
    await until(async () => (await selection()).cleared === true, 'Selection was not cleared');
    await clearPage.waitForTimeout(900); // Allow a canceled debounce to reveal an accidental late write.
    assert.equal(await savedOffset('444444'), 0);
    assert.equal(await clearPage.locator('.lyric-line').count(), 0);
    assert.equal(await clearPage.locator('#offsetValue').textContent(), '+0.00 s');
    await clearPage.reload();
    await clearPage.waitForFunction(() => document.querySelector('#lyricsAutoStatus').textContent.includes('記憶已清除'));
    assert.equal(automaticSearches, searchesBeforeClear, 'Reload automatically chose the cleared lyrics again');
    assert.equal(await clearPage.locator('.lyric-line').count(), 0);

    const wrong = { id:666666, trackName:'錯誤版本', artistName:'KTV', duration:17, syncedLyrics:null };
    await clearPage.route('**/api/lyrics/search?**', route => route.fulfill({ json:[wrong,a] }));
    await clearPage.route('**/api/lyrics/666666', route => route.fulfill({ json:{ syncedLyrics:null } }));
    await settingsTab(clearPage, 'Lyrics');
    await clearPage.locator('#lyricsSearchInput').fill('測試');
    await clearPage.locator('#lyricsSearchBtn').click();
    await clearPage.getByText('錯誤版本', { exact:true }).click();
    await until(async () => (await selection()).lrclib_id === '666666', 'A new choice did not replace cleared state');
    assert.equal(await clearPage.locator('.lyric-line').count(), 0);
    assert.equal(await clearPage.locator('#lyricsClearMemory').isEnabled(), true, 'A version without synced lyrics cannot be cleared');

    // A selection POST already in flight must complete before DELETE, so it cannot resurrect memory.
    let releaseSelection;
    let savingSelection = false;
    const selectionGate = new Promise(resolve => { releaseSelection = resolve; });
    await clearPage.route('**/api/selection/pitchdemo01', async route => {
      if (route.request().method() === 'POST') { savingSelection = true; await selectionGate; }
      await route.continue();
    });
    await clearPage.getByText(a.trackName, { exact:true }).last().click();
    await until(() => savingSelection, 'Selection save did not start');
    await clearPage.locator('#lyricsClearMemory').click();
    releaseSelection();
    await until(async () => (await selection()).cleared === true, 'Late selection save restored cleared memory');
    await clearPage.waitForFunction(() => document.querySelector('#mobileVersionName').textContent === '尚未選擇');
    await clearPage.getByText('錯誤版本', { exact:true }).click();
    await until(async () => (await selection()).lrclib_id === '666666', 'Plain version was not selected');
    await clearPage.route('**/api/selection/pitchdemo01', route => route.request().method() === 'DELETE'
      ? route.fulfill({ status:500, json:{ error:'test failure' } }) : route.fallback());
    await clearPage.locator('#lyricsClearMemory').click();
    await clearPage.waitForFunction(() => document.querySelector('#lyricsAutoStatus').textContent.includes('清除失敗'));
    assert.equal((await selection()).lrclib_id, '666666', 'Failed deletion lost the saved version');
    assert.equal(await clearPage.locator('#mobileVersionName').textContent(), '錯誤版本');
    assert.equal(await clearPage.locator('#lyricsClearMemory').isEnabled(), true);
    await clearPage.unroute('**/api/selection/pitchdemo01');
    await clearPage.locator('#lyricsClearMemory').click();
    await until(async () => (await selection()).cleared === true, 'Retry did not clear lyrics memory');
    await clearPage.close();

    // A read-only media volume (as on iOS) must keep the settings volume on mute/unmute.
    const readonlyPage = await context.newPage();
    readonlyPage.on('pageerror', error => errors.push(error.message));
    await readonlyPage.setViewportSize({width:390,height:844});
    await readonlyPage.addInitScript(() => {
      Object.defineProperty(HTMLMediaElement.prototype, 'volume', { configurable:true, get:()=>1, set(){} });
    });
    await readonlyPage.goto(`${fixture.url}/player?id=pitchdemo01&title=KTV`);
    await readonlyPage.waitForFunction(() => document.querySelector('#mainVideo').readyState >= 2 && document.querySelector('#audioStatus').textContent === '');
    await readonlyPage.locator('#mainVideo').focus();
    await readonlyPage.keyboard.press('Space');
    await settingsTab(readonlyPage,'Sound');
    await readonlyPage.locator('#volumeSlider').evaluate(slider => { slider.value='35'; slider.dispatchEvent(new Event('input')); });
    await readonlyPage.waitForFunction(() => Math.abs(window.__testTrackGains[0].gain.value-0.35)<0.003);
    await readonlyPage.locator('#mainVideo').evaluate(video => { video.muted=true; });
    await readonlyPage.waitForFunction(() => window.__testTrackGains.slice(0,2).every(node => Math.abs(node.gain.value)<0.003));
    await readonlyPage.locator('#mainVideo').evaluate(video => { video.muted=false; });
    await readonlyPage.waitForFunction(() => Math.abs(window.__testTrackGains[0].gain.value-0.35)<0.003);
    assert.equal(await readonlyPage.locator('#volumeValue').textContent(),'35%');
    assert.equal(await readonlyPage.locator('#mainVideo').evaluate(video => video.volume),1);
    await readonlyPage.close();
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ search: 'passed', microphoneA4: 'passed', automaticLyrics: 'passed', autoAlignmentDisabled:'passed', fineOffsetPersistence:'passed', lyricOffsetControls: 'passed', versionSwitchRace: 'passed', offsetPersistence: 'passed', settingsPersistence: 'passed', responsiveSettings: 'passed', desktopNativePlayback:'passed', nativeVolumeAndMute:'passed', mutedKeyChange:'passed', desktopSoundOnRight:'passed', singleRowMix:'passed', mobileLiveMix:'passed', mobileKeyInSettings:'passed', tallerMobilePitch:'passed', lyricSideNavigation:'passed', mobilePlayback: 'passed', noExtraFullscreenButtons:'passed', nativeFullscreen:'passed', clearLyricsMemory:'passed', fullLyricsScroll:'passed', layoutWidths: [1366,1280,800,768,430,390,320], pageErrors: errors, artifacts: output }));
  } finally {
    await browser?.close();
    server.kill('SIGTERM');
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
