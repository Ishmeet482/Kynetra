const VISION_VERSION = '0.10.32';
const CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VISION_VERSION}`;
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const abortError = () => new DOMException('Tracking stopped', 'AbortError');

async function workerEngine(signal, workerUrl, delegate) {
  const worker = new Worker(workerUrl); // Classic worker is required by the pinned WASM loader.
  let pending = null;
  let rejectStartup;
  let timer;
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(timer);
    signal.removeEventListener('abort', dispose);
    worker.terminate();
    rejectStartup?.(abortError());
    pending?.reject(abortError());
    pending = null;
  };
  signal.addEventListener('abort', dispose, { once: true });
  try {
    await new Promise((resolve, reject) => {
      rejectStartup = reject;
      timer = setTimeout(() => reject(new Error('Worker startup timed out')), 20000);
      worker.onerror = (event) => {
        event.preventDefault();
        const error = new Error('Tracking worker failed');
        if (pending) { pending.reject(error); pending = null; }
        else reject(error);
      };
      worker.onmessage = ({ data }) => {
        if (data.type === 'ready') resolve();
        else if (data.type === 'result') {
          pending?.resolve(data);
          pending = null;
        } else if (data.type === 'error') {
          const error = new Error(data.message);
          if (pending) { pending.reject(error); pending = null; }
          else reject(error);
        }
      };
      worker.postMessage({ type: 'init', delegate, visionUrl: `${CDN}/vision_bundle.mjs`, wasmUrl: `${CDN}/wasm`, modelUrl: MODEL_URL });
      if (signal.aborted) dispose();
    });
    rejectStartup = null;
    clearTimeout(timer);
  } catch (error) { dispose(); throw error; }

  return {
    backend: 'worker',
    delegate,
    async process(video, timestamp) {
      if (disposed) throw abortError();
      if (pending) throw new Error('Inference already in flight');
      const bitmap = await createImageBitmap(video);
      if (disposed) { bitmap.close(); throw abortError(); }
      return new Promise((resolve, reject) => {
        pending = { resolve, reject };
        try { worker.postMessage({ type: 'frame', bitmap, timestamp }, [bitmap]); }
        catch (error) { bitmap.close(); pending = null; reject(error); }
      });
    },
    dispose,
  };
}

export async function createInferenceEngine({ signal, workerUrl = './hand-worker.js', forceMain = false } = {}) {
  if (signal.aborted) throw abortError();
  if (!forceMain && typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap === 'function') {
    for (const delegate of ['GPU', 'CPU']) {
      try { return await workerEngine(signal, workerUrl, delegate); }
      catch (error) { if (signal.aborted) throw error; }
    }
  }
  const { HandLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
  const files = await FilesetResolver.forVisionTasks(`${CDN}/wasm`);
  if (signal.aborted) throw abortError();
  const model = await HandLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
    runningMode: 'VIDEO', numHands: 2,
    minHandDetectionConfidence: 0.65, minHandPresenceConfidence: 0.65, minTrackingConfidence: 0.65,
  });
  if (signal.aborted) { model.close(); throw abortError(); }
  try {
    // Pay the first interpreter/shader compilation cost during startup, not an active gesture.
    const warmup = document.createElement('canvas');
    warmup.width = 640;
    warmup.height = 480;
    warmup.getContext('2d').fillRect(0, 0, 640, 480);
    model.detectForVideo(warmup, 0);
  } catch (error) { model.close(); throw error; }
  let disposed = false;
  return {
    backend: 'main',
    async process(video, timestamp) {
      if (disposed) throw abortError();
      const started = performance.now();
      const result = model.detectForVideo(video, timestamp);
      return { landmarks: result.landmarks, timestamp, inferenceMs: performance.now() - started };
    },
    dispose() { if (!disposed) { disposed = true; model.close(); } },
  };
}
