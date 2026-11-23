/* Classic worker: MediaPipe's WASM loader uses importScripts, which module workers reject. */
let model = null;

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') {
      const { HandLandmarker, FilesetResolver } = await import(data.visionUrl);
      const files = await FilesetResolver.forVisionTasks(data.wasmUrl);
      model = await HandLandmarker.createFromOptions(files, {
        canvas: new OffscreenCanvas(640, 480),
        baseOptions: { modelAssetPath: data.modelUrl, delegate: data.delegate ?? 'CPU' },
        runningMode: 'VIDEO', numHands: 2,
        minHandDetectionConfidence: 0.65, minHandPresenceConfidence: 0.65, minTrackingConfidence: 0.65,
      });
      // Compile and validate the delegate before reporting readiness or accepting camera frames.
      const warmup = new OffscreenCanvas(640, 480);
      warmup.getContext('2d').fillRect(0, 0, 640, 480);
      model.detectForVideo(warmup, 0);
      self.postMessage({ type: 'ready' });
    } else if (data.type === 'frame' && model) {
      const started = performance.now();
      try {
        const result = model.detectForVideo(data.bitmap, data.timestamp);
        self.postMessage({ type: 'result', landmarks: result.landmarks, timestamp: data.timestamp, inferenceMs: performance.now() - started });
      } finally { data.bitmap.close(); }
    }
  } catch (error) {
    data.bitmap?.close();
    self.postMessage({ type: 'error', message: error.message });
  }
};
