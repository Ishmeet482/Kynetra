const { chromium } = require(process.env.KYNETRA_PLAYWRIGHT_PATH || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const baseUrl = process.argv[2] || 'http://127.0.0.1:5173';
const outputPath = process.argv[3] || 'performance-run.json';

async function benchmark() {
  const browser = await chromium.launch({
    executablePath: process.env.KYNETRA_CHROME_PATH,
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
      deviceScaleFactor: Number(process.env.KYNETRA_DPR || 1),
    });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(baseUrl);
    await page.waitForFunction(() => window.__kynetraPerf && document.getElementById('scene-loading').hidden);
    const environment = await page.evaluate(() => {
      const gl = document.querySelector('canvas').getContext('webgl2');
      const extension = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        userAgent: navigator.userAgent,
        renderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        dpr: devicePixelRatio,
        viewport: [innerWidth, innerHeight],
      };
    });
    const measurements = [];
    async function sample(name) {
      await page.waitForTimeout(1800);
      await page.evaluate(() => window.__kynetraPerf.reset());
      for (let index = 0; index < 30; index++) {
        await page.mouse.move(360 + index % 10 * 65, 380 + Math.sin(index) * 120);
        await page.waitForTimeout(250);
      }
      const result = await page.evaluate(() => {
        const settings = document.getElementById('camera-video').srcObject?.getVideoTracks()[0]?.getSettings();
        return {
          ...window.__kynetraPerf.report(),
          video: settings ? { width: settings.width, height: settings.height, frameRate: settings.frameRate } : null,
        };
      });
      measurements.push({ name, ...result });
      console.log(name, JSON.stringify(result));
    }
    async function enableCamera() {
      await page.getByRole('button', { name: 'Enable hand tracking' }).click();
      await page.waitForFunction(() => document.getElementById('camera-button').dataset.status === 'active', { timeout: 90000 });
    }
    await sample('assembly-mouse');
    await enableCamera();
    await sample('assembly-camera');
    await page.getByRole('button', { name: 'Disable hand tracking' }).click();

    const { COMPONENTS } = await import(pathToFileURL(path.resolve(__dirname, '../src/core/assembly.js')));
    // Match the home camera in world.js; fail placements rather than bypass assembly state.
    await page.evaluate(() => {
      window.projectPoint = (values) => {
        const rect = document.querySelector('canvas').getBoundingClientRect();
        const theta = 0.12;
        const phi = 1.18;
        const radius = 16.8;
        const st = Math.sin(theta);
        const ct = Math.cos(theta);
        const sp = Math.sin(phi);
        const cp = Math.cos(phi);
        const delta = [values[0] - radius * sp * st, values[1] - 2.25 - radius * cp, values[2] - radius * sp * ct];
        const vx = delta[0] * ct - delta[2] * st;
        const vy = -delta[0] * cp * st + delta[1] * sp - delta[2] * cp * ct;
        const vz = delta[0] * sp * st + delta[1] * cp + delta[2] * sp * ct;
        const fov = Math.tan(43 * Math.PI / 360);
        return {
          x: rect.x + (vx / -vz / (fov * rect.width / rect.height) + 1) / 2 * rect.width,
          y: rect.y + (1 - vy / -vz / fov) / 2 * rect.height,
        };
      };
    });
    for (const component of COMPONENTS) {
      const start = await page.evaluate((position) => window.projectPoint(position), component.start);
      const end = await page.evaluate((position) => window.projectPoint(position), component.socket);
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(end.x, end.y, { steps: 15 });
      if (component.id === 'plinth') {
        await page.mouse.wheel(0, 85);
        await page.waitForTimeout(100);
      }
      await page.waitForTimeout(500);
      await page.mouse.up();
      await page.waitForTimeout(250);
      if (!await page.locator(`[data-component="${component.id}"]`).isDisabled()) {
        throw new Error(`Assembly failed: ${component.id}`);
      }
    }
    await page.getByRole('button', { name: 'Start target practice' }).click();
    await sample('simulation-mouse');
    await enableCamera();
    await sample('simulation-camera');
    fs.writeFileSync(outputPath, JSON.stringify({ environment, measurements, errors }, null, 2));
    console.log('Saved', outputPath, environment, 'errors', errors);
    if (errors.length) throw new Error('Browser errors occurred during the benchmark');
  } finally {
    await browser.close();
  }
}

benchmark().catch((error) => { console.error(error); process.exitCode = 1; });
