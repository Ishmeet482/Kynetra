import { createInferenceEngine } from './inference.js';

export function cameraErrorMessage(error) {
  const messages = {
    NotAllowedError: 'Camera permission denied. Allow camera access in your browser’s site settings, then try again. Mouse controls remain available.',
    NotFoundError: 'No webcam found. Connect a camera and try again, or use mouse controls.',
    NotReadableError: 'Camera unavailable. Close other apps using it, then try again.',
    OverconstrainedError: 'This camera cannot use the requested settings. Try another webcam.',
    SecurityError: 'Camera blocked by browser security. Open Kynetra on localhost or HTTPS.',
  };
  return messages[error.name] ?? 'Hand tracking could not start. Check your connection and browser support, then retry. Mouse controls remain available.';
}

export function createHandTracker(video, onResults, onStatus, onInference = () => {}, options = {}) {
  const makeEngine = options.createEngine ?? createInferenceEngine;
  let engine = null;
  let stream = null;
  let active = false;
  let starting = false;
  let generation = 0;
  let controller = null;
  let frameCallback = null;
  let timer = null;
  let lastFrame = -1;
  let nextInference = 0;
  let lastTimestamp = -Infinity;
  let busy = false;
  let averageInference = 0;

  function cancelSchedule() {
    if (frameCallback !== null) video.cancelVideoFrameCallback(frameCallback);
    if (timer !== null) clearTimeout(timer);
    frameCallback = timer = null;
  }

  function stop() {
    generation++;
    active = starting = false;
    cancelSchedule();
    controller?.abort();
    controller = null;
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    video.pause();
    video.srcObject = null;
    engine?.dispose();
    engine = null;
    lastFrame = -1;
    busy = false;
    onStatus('off', 'Mouse controls active.');
  }

  function schedule() {
    if (!active) return;
    if (typeof video.requestVideoFrameCallback === 'function') {
      frameCallback = video.requestVideoFrameCallback((now) => { frameCallback = null; schedule(); processFrame(now); });
    } else timer = setTimeout(() => { timer = null; schedule(); processFrame(performance.now()); }, 33);
  }

  function watchVideo() {
    if (!active) return;
    // Some browsers throttle callbacks for a hidden <video> even as its currentTime advances.
    timer = setTimeout(() => {
      timer = null;
      if (!active) return;
      processFrame(performance.now());
      watchVideo();
    }, 50);
  }

  async function processFrame(now) {
    if (active && busy && performance.now() - lastTimestamp > 3000) {
      stop();
      onStatus('error', 'Hand tracking timed out. Enable it again to retry. Mouse controls remain available.');
      return;
    }
    const checkedAt = Math.max(now, performance.now());
    if (!active || busy || document.hidden || video.readyState < 2 || video.currentTime === lastFrame || checkedAt + 1 < nextInference) return;
    const attempt = generation;
    const currentEngine = engine;
    busy = true; // Includes bitmap capture/transfer: never build a queue of stale frames.
    lastFrame = video.currentTime;
    const timestamp = Math.max(performance.now(), lastTimestamp + 0.01);
    lastTimestamp = timestamp;
    try {
      const result = await currentEngine.process(video, timestamp);
      if (attempt !== generation) return;
      const receivedAt = performance.now();
      averageInference = averageInference ? averageInference * 0.8 + result.inferenceMs * 0.2 : result.inferenceMs;
      // Worker can occupy up to ~80% of one core. Main-thread fallback gets a stricter budget.
      const interval = currentEngine.backend === 'worker' ? Math.max(50, averageInference * 1.25) : Math.max(100, averageInference * 3);
      nextInference = Math.max(timestamp + interval, receivedAt);
      onInference(result.inferenceMs, currentEngine.backend, receivedAt - timestamp, currentEngine.delegate);
      if (receivedAt - timestamp < 300) onResults(result.landmarks, timestamp, receivedAt);
    } catch (error) {
      if (attempt === generation && error.name !== 'AbortError') {
        stop();
        onStatus('error', 'Tracking interrupted. Try enabling the camera again. Mouse controls remain available.');
      }
    } finally { if (attempt === generation) busy = false; }
  }

  return {
    get running() { return active || starting; },
    async start() {
      if (active || starting) return;
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        onStatus('error', 'Camera access needs HTTPS or localhost and a browser with webcam support. Mouse controls remain available.');
        return;
      }
      starting = true;
      controller = new AbortController();
      const signal = controller.signal;
      const attempt = ++generation;
      let candidateStream = null;
      let candidateEngine = null;
      try {
        onStatus('permission', 'Allow camera access in your browser. You can keep exploring with your mouse.');
        candidateStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 }, facingMode: 'user' } });
        if (attempt !== generation) { candidateStream.getTracks().forEach((track) => track.stop()); return; }
        stream = candidateStream;
        video.srcObject = stream;
        await video.play();
        if (attempt !== generation) return;
        onStatus('loading', 'Loading hand tracking model… Mouse controls remain available.');
        candidateEngine = await makeEngine({ signal, workerUrl: options.workerUrl, forceMain: options.forceMain });
        if (attempt !== generation) { candidateEngine.dispose(); return; }
        engine = candidateEngine;
        active = true;
        starting = false;
        averageInference = nextInference = 0;
        stream.getVideoTracks()[0].addEventListener('ended', () => { if (attempt === generation) { stop(); onStatus('error', 'Camera disconnected. Reconnect it and enable hand tracking again.'); } }, { once: true });
        schedule();
        if (typeof video.requestVideoFrameCallback === 'function') watchVideo();
        onStatus('active', 'Tracking ready. Raise a hand in front of the camera.');
      } catch (error) {
        candidateStream?.getTracks().forEach((track) => track.stop());
        if (attempt !== generation) { candidateEngine?.dispose(); return; }
        stop();
        onStatus('error', cameraErrorMessage(error));
      }
    },
    stop,
  };
}
