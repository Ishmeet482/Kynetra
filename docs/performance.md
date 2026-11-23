# Kynetra performance audit

Audit date: 19 November 2026. Measurements below describe this machine and test workload, not a universal frame-rate guarantee.

## What caused the lag

The original animation callback called `HandLandmarker.detectForVideo()` before updating or rendering the scene. That API is synchronous. On the audit machine it occupied roughly 64 ms per inference. Since inference was allowed every 50 ms, almost every frame became another long inference task: camera mode ran at about 16 FPS while the same scene without tracking ran at about 60 FPS.

The scene was not especially complex: 16 draw calls in assembly, 15 in simulation, and 3,630 rendered triangles in either mode. Lighting was one hemisphere light and two directional lights; shadow maps were already disabled. Changing the visual design or removing lights was not justified by these results.

Secondary findings:

| Area | Finding | Change |
| --- | --- | --- |
| Animation/rendering | Static assemblies redrew continuously; camera matrices were rebuilt even at rest | Skip unchanged rendering and camera transforms; retain a sparse 250 ms redraw heartbeat |
| Tracking | Synchronous inference inside the animation loop; no separation of compute and display | Independent video/timer scheduler; single-flight worker jobs; bounded inference duty cycle |
| Picking | Stationary cursor raycast every frame; selectable arrays and projection vectors recreated | Stable selectable array, reusable hit/projection buffers, cursor/camera/selection revision checks |
| Geometry/materials | Fins had separate copies of the same geometry; every shot allocated and destroyed a line | Share fin geometry and rotate meshes; reuse beam buffers/materials |
| Materials | Per-piece highlight state needs independent emissive values | Keep those materials independent; avoid writing unchanged values |
| Scene traversal | Forced world-matrix updates accompanied every hover pick | Perform picking only when its inputs change; retain fresh matrices for actual picks |
| DOM | Cursor results read layout and wrote left/top; repeated class/style writes; score changes rebuilt component presentation | Resize-observer bounds, coalesced transforms, changed-value guards, state-aware updates |
| Listeners/lifecycle | Pointer listeners already used abort cleanup; tracking lived inside render scheduling | Preserve listener cleanup; cancel video callbacks/timers and terminate workers on stop; reject late results |

A fully idle renderer initially introduced a separate regression: an approximately one-second RAF timestamp gap appeared without a corresponding long JavaScript task in a Chrome trace. A 250 ms redraw heartbeat removed that repeatable gap in the traced scenario. Static scenes still submit far fewer frames than before. A brief cold hover/driver spike remained in mouse measurements; mean FPS and p95 are both reported rather than hiding it.

## Matched results

Environment: headless Chrome 157 on macOS, ANGLE Metal on an AMD Radeon Pro 5500M, 1280 × 900 viewport, device pixel ratio 1, development Vite server with the same lightweight instrumentation. The video source was Chrome's synthetic camera, 640 × 480 at 20 FPS. It contains no real hands.

Each scenario warmed for 1.8 seconds, reset counters, then ran the same 30 mouse moves separated by 250 ms. All six pieces were placed through pointer interactions before entering simulation. The original instrumented source was kept in a separate temporary copy. The table uses the primary baseline and final optimized run; a baseline confirmation also recorded the camera settings and returned 14.9–15.3 camera-mode FPS with 66–67 ms inference, consistent with the original bottleneck. Runs were sequential, not competing browser benchmarks.

| Scenario | Before FPS | After FPS | Before frame p95 | After frame p95 | Before inference mean | After inference mean |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Assembly, mouse | 59.6 | 59.6 | 16.8 ms | 16.8 ms | — | — |
| Assembly, camera | 15.7 | 60.0 | 66.7 ms | 16.7 ms | 64.1 ms | 16.2 ms |
| Simulation, mouse | 60.0 | 60.0 | 16.8 ms | 16.7 ms | — | — |
| Simulation, camera | 16.0 | 60.0 | 66.8 ms | 16.8 ms | 64.6 ms | 18.4 ms |

After optimization, measured camera inference frequency was 19.7–19.9 Hz, compared with 15.3–15.4 Hz originally. Capture-to-result age averaged 16.9 ms in assembly and 19.0 ms in simulation. This age excludes the camera sensor/decoder delay and subsequent gesture dwell, so it is not an end-to-end gesture latency measurement.

Draw calls and triangle counts remain unchanged per rendered frame. Under the scripted assembly motion, redraw frequency fell from approximately 60 Hz to 12.7 Hz without a camera and 8.5 Hz with a camera; simulation continued drawing at approximately 60 Hz. Loop FPS describes input/update scheduling, not necessarily a new GPU image on every callback. Render timings measure JavaScript/WebGL submission, not GPU completion or total CPU utilization.

A separate worker-only delegate probe discarded six warmup samples and collected 44 timings for each delegate: CPU mean 74.6 ms, p95 90.1 ms; GPU mean 17.0 ms, p95 25.9 ms. The earlier CPU-worker prototype also restored camera-mode rendering to roughly 60 FPS while inference itself still took about 65 ms. That established that moving computation off-thread improved responsiveness before the GPU delegate was adopted.

Raw primary and intermediate measurements are retained in [performance-results.json](performance-results.json). They include the unsuccessful fully-idle-render experiment, so the optimization history is reviewable. Intermediate runs are diagnostic and are not interchangeable with the final matched result.

## Worker and fallback behavior

The installed MediaPipe 0.10.32 loader uses `importScripts()` for its WASM glue. A classic worker can use that loader normally; simply creating a module worker would require a different loading arrangement. The implementation uses a classic worker that dynamically imports the pinned ESM bundle, supplies an OffscreenCanvas, warms and validates the chosen delegate, then accepts transferred ImageBitmaps.

Startup tries GPU worker, CPU worker, then a lazy main-thread CPU model when worker features or initialization are unavailable. There is only one frame capture/inference in flight, including asynchronous bitmap capture. Frames arriving during that job are skipped, not queued. Stopped sessions cannot deliver results into a new session, and processed/transferred bitmaps are closed. A stuck inference times out rather than leaving the interface permanently active without results.

Inference is paced independently of rendering. Video-frame callbacks are supplemented by a guarded 50 ms timer because hidden video elements can receive callbacks less often than their currentTime advances. Unchanged video frames, hidden documents, busy jobs, and frames before the next deadline are skipped. A small deadline tolerance avoids accidentally halving the rate when a camera frame arrives just before a nominal interval boundary.

Worker scheduling caps nominal input frequency at 20 Hz and adapts the interval to average inference cost. The main-thread fallback gets a larger interval and stricter compute budget; it cannot make a synchronous library call nonblocking. Its limitations remain visible in the monitor rather than being treated as a GPU-resolution problem. The fallback also warms its interpreter before reporting readiness. Forced-failure browser checks verified both fallback paths, continued inference, camera release, and zero remaining worker targets after shutdown; these short functional smoke results are included separately in the raw data.

Gesture filtering now uses capture timestamps, rejects non-increasing timestamps, has a 70 ms stable-state dwell instead of 110 ms, and uses faster time-aware cursor damping. At 10 Hz, a stable gesture commits after one new sample rather than waiting for two. The existing jitter, fist anchoring, tracking-loss, snapping, and release protections remain covered by tests.

## Adaptive quality and lifecycle

The initial pixel-ratio ceiling is 1.5, with antialiasing and the existing lights/materials retained. Two consecutive slow two-second windows reduce resolution in 0.25 steps, down to 0.75. Recovery needs four fast windows. Known main-thread inference stalls are excluded from resolution decisions. At minimum resolution, sustained load enables a 30 FPS update/render cap; after ten seconds it probes full-rate operation again.

These thresholds are tested as control logic, not claimed as measured performance on low-end hardware. They cannot guarantee 30 FPS on a device whose individual inference or rendering tasks take longer than a frame budget.

Hidden tabs stop the frame loop, cancel grabs, release the webcam, and terminate tracking work. The animation loop resumes without integrating the hidden interval. Camera access remains explicitly opt-in after returning. Teardown disconnects observers, aborts listeners, closes models or terminates workers, cancels callbacks/timers, and disposes renderer resources and the beam pool.

## Monitor and reproduction

`npm run dev` collects diagnostics with the panel hidden by default. Open `?perf=1` to reveal the styled diagnostics dock. `?perf=0` prevents loading it, while **Hide monitor** only hides its DOM. The visible panel refreshes once per second. It shows loop FPS, frame mean/p95, redraw rate, render/update CPU time, inference time/rate, result age, backend, DPR, draw calls, and triangles.

Production excludes its module and global hook by default. A temporary instrumented build can be created with `VITE_PERF_MONITOR=true npm run build`; use an ordinary build to remove it again. In monitored development sessions:

```js
window.__kynetraPerf.reset();
// Exercise the same scenario for a fixed interval.
console.table(window.__kynetraPerf.report());
```

The optional `scripts/benchmark.cjs` uses Playwright, which is intentionally not added to application dependencies. On macOS, with Google Chrome installed, one way to reproduce the harness is:

```bash
npm install --prefix /private/tmp/kynetra-profile --no-save playwright
npm run dev
```

Then, in another terminal at the project root:

```bash
KYNETRA_PLAYWRIGHT_PATH=/private/tmp/kynetra-profile/node_modules/playwright \
KYNETRA_CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
node scripts/benchmark.cjs http://127.0.0.1:5173 /private/tmp/kynetra-profile/result.json
```

The script performs real pointer placements, uses a synthetic webcam, fails on browser errors, records the actual GPU and camera settings, and closes its browser. It does not test physical gesture accuracy. Its camera projection helper matches the current home view and should be updated if that view changes. `KYNETRA_DPR=2` can select a higher device pixel ratio for a separate experiment. `?tracking=main` forces the compatibility path in development; `?quality=high` holds the normal DPR ceiling for fixed-quality comparisons.

## Limits of this audit

- Real hands, two-hand occlusion, sensor latency, physical touch devices, Safari/Firefox, integrated GPUs, and thermally constrained devices were not benchmarked. Synthetic camera results do not establish recognition accuracy or universal 60 FPS.
- Runs are short samples, not a statistical benchmark suite. OS background activity, thermal state, driver caches, and real display presentation were not controlled.
- First-time shader, script, model, and delegate compilation still incur startup costs. The steady-state sampling window excludes startup.
- GPU inference can contend with rendering on other hardware. CPU-worker and main-thread fallbacks remain available, but this is not a cross-device delegate auto-benchmark.
- The main-thread fallback can still produce long frames. No small scheduling change can remove the synchronous cost of that path.
- Render submission time, RAF cadence, and draw counts are not measurements of GPU execution time, battery consumption, or total CPU usage.

API grounding: [MediaPipe Hand Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker?tab=Web) documents synchronous video detection; [its script-loader source](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/web/graph_runner/run_script_helper.ts.template) explains classic/module worker loading. The worker decision also rests on successful initialization, warmup, transferred-frame inference, and matched measurements with the pinned installed version.
