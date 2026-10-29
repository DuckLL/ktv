// Deterministic rendering checks using the real player, canvas and pitch renderer.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { createInterface } = require('node:readline');
const { createServer } = require('node:net');
const { mkdir } = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const root = path.resolve(__dirname, '../..');
  const reservation = createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = String(reservation.address().port);
  await new Promise(resolve => reservation.close(resolve));
  const server = spawn(process.env.KTV_TEST_PYTHON || path.join(root, '.venv/bin/python'), [path.join(__dirname, 'server.py')], {
    cwd: root, env: { ...process.env, KTV_TEST_PORT: port },
  });
  let logs = '', browser;
  server.stderr.on('data', data => { logs += data; });
  const output = process.env.KTV_BROWSER_ARTIFACTS || '/tmp/ktv-pitch-viewport-review';
  try {
    const lines = createInterface({ input: server.stdout });
    const fixture = await Promise.race([
      once(lines, 'line').then(([line]) => JSON.parse(line)),
      once(server, 'exit').then(([code]) => { throw new Error(`Fixture exited (${code}): ${logs}`); }),
    ]);
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try { ready = (await fetch(fixture.url)).ok; } catch (_) {}
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(ready, `Fixture did not start: ${logs}`);
    await mkdir(output, { recursive: true });
    browser = await chromium.launch({ args: ['--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/lyrics/search?**', route => route.fulfill({ json: [] }));
    await page.goto(`${fixture.url}/player?id=pitchdemo01&title=平滑音高測試`);
    await page.waitForFunction(() => !document.querySelector('#pitchMicToggle').disabled);
    await page.evaluate(async () => {
      // The app's own animation stops when the panel is closed. Drive a second
      // renderer with known song/frame times, leaving the production code intact.
      document.querySelector('#pitchPanel').open = false;
      const { PitchFeedback } = await import('/static/js/pitch_feedback.js');
      const raf = window.requestAnimationFrame;
      window.requestAnimationFrame = () => 0;
      const audio = { currentTime: 2, playing: true, keySemitones: 0, context: { sampleRate: 48000 } };
      let feedback;
      try { feedback = new PitchFeedback(audio, 'render-test'); }
      finally { window.requestAnimationFrame = raf; }
      feedback.reference = {
        hop_seconds: 0.02,
        midi: Array.from({ length: 1500 }, (_, i) => {
          const t = i * 0.02;
          return t < 8 ? 69 + 0.08 * Math.sin(t * 30) : t < 13 ? 73 : t < 16 ? 81 : t < 18 ? null : 65;
        }),
        notes: [{ start: 0, end: 8, midi: 69 }, { start: 8, end: 13, midi: 73 }, { start: 13, end: 16, midi: 81 }, { start: 18, end: 30, midi: 65 }],
      };
      feedback.stream = { getTracks: () => [] };
      feedback.updateChartRange();
      const arcs = [];
      const arc = feedback.ctx.arc.bind(feedback.ctx);
      feedback.ctx.arc = (...args) => { arcs.push(args); arc(...args); };
      window.pitchRenderTest = { feedback, audio, arcs, frame: 0 };
    });
    for (const viewport of [{ width: 1366, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      if (viewport.width === 390) await page.waitForFunction(() => document.querySelector('#pitchCanvas').clientHeight >= 110);
      const render = await page.evaluate(() => {
        const { feedback, audio, arcs } = window.pitchRenderTest;
        feedback.viewport.reset();
        audio.currentTime = 2;
        feedback.history = [1.8, 1.84, 1.88, 1.92].map(time => ({ time, midi: 69.7, cents: 70 }));
        arcs.length = 0;
        feedback.draw(0);
        const [target, singer] = arcs;
        return { span: feedback.viewport.span, gap: target[1] - singer[1], height: feedback.canvas.clientHeight, sameX: target[0] === singer[0] };
      });
      assert.equal(render.span, 10);
      assert.ok(render.sameX && Math.abs(render.gap - 0.7 / 10 * render.height) < 0.001, `Pitch difference distorted: ${JSON.stringify(render)}`);
      await page.screenshot({ path: path.join(output, `smooth-pitch-${viewport.width}.png`) });
    }
    const motion = await page.evaluate(() => {
      const { feedback, audio } = window.pitchRenderTest;
      feedback.history = [];
      feedback.viewport.reset();
      let maxCenter = 0, maxSpan = 0;
      audio.currentTime = 0;
      feedback.draw(0);
      let center = feedback.viewport.center, span = feedback.viewport.span;
      const quietCenter = center;
      let still = true;
      for (let i = 1; i <= 12 * 60; i++) {
        audio.currentTime = i / 60;
        feedback.draw(i / 60);
        maxCenter = Math.max(maxCenter, Math.abs(feedback.viewport.center - center));
        maxSpan = Math.max(maxSpan, Math.abs(feedback.viewport.span - span));
        if (i <= 3 * 60 && feedback.viewport.center !== quietCenter) still = false;
        center = feedback.viewport.center;
        span = feedback.viewport.span;
      }
      audio.currentTime = 25;
      feedback.draw(12.02);
      const seekCenter = feedback.viewport.center;
      const untouched = feedback.reference.midi[400] === 73 && feedback.reference.midi[820] === null;
      audio.keySemitones = -12;
      feedback.updateChartRange();
      feedback.draw(12.04);
      return { maxCenter, maxSpan, still, seekCenter, transposedCenter: feedback.viewport.center, untouched };
    });
    assert.ok(motion.still, 'Vibrato moved the pitch axis');
    assert.ok(motion.maxCenter <= 0.100001 && motion.maxSpan <= 0.200001, `View jumped: ${JSON.stringify(motion)}`);
    assert.equal(motion.seekCenter, 65);
    assert.equal(motion.transposedCenter, 53);
    assert.ok(motion.untouched);
    const latency = await page.evaluate(() => {
      const { feedback, audio, arcs } = window.pitchRenderTest;
      audio.currentTime = 2;
      audio.keySemitones = 0;
      feedback.updateChartRange();
      return [-0.3, 0.6].map(correction => {
        feedback.history = [1.8, 1.84, 1.88, 1.92].map(time => ({ time: time - correction, receivedAt: time, midi: 69.7, cents: 70 }));
        arcs.length = 0;
        feedback.draw(13);
        return arcs.length;
      });
    });
    assert.deepEqual(latency, [2, 2], 'Latency correction hid the current pitch markers');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ pitchGapAccurate: true, smoothMotion: motion, pageErrors: errors, screenshots: output }));
  } finally {
    await browser?.close();
    server.kill('SIGTERM');
    if (server.exitCode === null) await once(server, 'exit');
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
