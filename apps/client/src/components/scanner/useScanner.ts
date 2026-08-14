import { useCallback, useEffect, useRef, useState } from "react";
import type { BarcodeFormat, ScannerStatus } from "./types";
import { ScannerError } from "./types";
import { mapGetUserMediaError, preflightCameraSupport } from "./errors";
import { pickEngine, type ScanEngine } from "./engines";

/**
 * MediaTrackCapabilities/Constraints don't yet type `torch` in stock DOM lib.
 */
type TorchCapableTrack = MediaStreamTrack & {
  getCapabilities?: () => MediaTrackCapabilities & { torch?: boolean };
};

export type UseScannerOptions = {
  /** Only run the camera while true (mount/teardown gate). */
  active: boolean;
  /** Restrict decoded symbologies. */
  formats: BarcodeFormat[];
  /** Called with each raw decode BEFORE dedup/business rules. */
  onDecode: (rawValue: string, format: BarcodeFormat) => void;
  /** Fatal setup/stream errors. */
  onError: (error: ScannerError) => void;
  /** Milliseconds between decode attempts. Lower = snappier, more CPU. */
  scanIntervalMs?: number;
};

export type UseScannerReturn = {
  // `| null` matters: React 19's useRef<T>(null) yields RefObject<T | null>.
  // Written this way it type-checks under both React 18 and 19 typings.
  videoRef: React.RefObject<HTMLVideoElement | null>;
  status: ScannerStatus;
  error: ScannerError | null;
  /** True only when the active track actually supports the torch. */
  torchSupported: boolean;
  torchOn: boolean;
  toggleTorch: () => Promise<void>;
  /** >1 camera present -> offer a switch control. */
  canSwitchCamera: boolean;
  switchCamera: () => void;
  /** Halt/resume the decode loop without tearing down the stream. */
  pause: () => void;
  resume: () => void;
};

/**
 * Owns the camera: permission preflight, stream lifecycle, the decode loop,
 * torch, and camera switching. It deliberately does NOT dedup or apply business
 * rules — it just emits every raw decode. Composition over configuration.
 */
export function useScanner(options: UseScannerOptions): UseScannerReturn {
  const { active, formats, scanIntervalMs = 180 } = options;

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const engineRef = useRef<ScanEngine | null>(null);
  const loopTimer = useRef<number | null>(null);
  const pausedRef = useRef(false);
  const decodingRef = useRef(false);

  // Keep the latest callbacks without re-triggering the camera effect.
  const onDecodeRef = useRef(options.onDecode);
  onDecodeRef.current = options.onDecode;
  const onErrorRef = useRef(options.onError);
  onErrorRef.current = options.onError;

  const [status, setStatus] = useState<ScannerStatus>("idle");
  const [error, setError] = useState<ScannerError | null>(null);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  // The device list lives in a ref, NOT state: enumerating cameras must never
  // re-run the camera effect. It previously did, which restarted the stream on
  // deviceIds[0] — usually the FRONT camera — right after we'd correctly opened
  // the rear one. `selectedDeviceId` stays null until the user taps Flip, so the
  // first open is always driven by facingMode.
  const deviceListRef = useRef<string[]>([]);
  const [cameraCount, setCameraCount] = useState(0);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

  const stopLoop = useCallback(() => {
    if (loopTimer.current != null) {
      window.clearTimeout(loopTimer.current);
      loopTimer.current = null;
    }
  }, []);

  const teardown = useCallback(() => {
    stopLoop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    engineRef.current?.dispose();
    engineRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setTorchOn(false);
    setTorchSupported(false);
  }, [stopLoop]);

  const runLoop = useCallback(() => {
    const tick = async () => {
      loopTimer.current = null;
      const video = videoRef.current;
      const engine = engineRef.current;
      if (
        !video ||
        !engine ||
        pausedRef.current ||
        decodingRef.current ||
        video.readyState < 2 || // HAVE_CURRENT_DATA
        video.videoWidth === 0
      ) {
        loopTimer.current = window.setTimeout(tick, scanIntervalMs);
        return;
      }

      decodingRef.current = true;
      try {
        let canvas = canvasRef.current;
        if (!canvas) {
          canvas = document.createElement("canvas");
          canvasRef.current = canvas;
        }
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const hit = await engine.decode(canvas);
          if (hit && !pausedRef.current) {
            onDecodeRef.current(hit.rawValue, hit.format);
          }
        }
      } catch (err) {
        // A decode fault shouldn't kill the stream; log once and keep looping.
        onErrorRef.current(
          err instanceof ScannerError
            ? err
            : new ScannerError("unknown", "Decode error", err),
        );
      } finally {
        decodingRef.current = false;
        loopTimer.current = window.setTimeout(tick, scanIntervalMs);
      }
    };
    stopLoop();
    loopTimer.current = window.setTimeout(tick, scanIntervalMs);
  }, [scanIntervalMs, stopLoop]);

  // --- main lifecycle: (re)open the stream when active / camera changes -----
  useEffect(() => {
    if (!active) {
      teardown();
      setStatus("idle");
      setError(null);
      // Forget a manual Flip so the next open starts on the rear camera again.
      setSelectedDeviceId(null);
      return;
    }

    let cancelled = false;
    pausedRef.current = false;

    const start = async () => {
      setError(null);
      setStatus("starting");

      const preflight = preflightCameraSupport();
      if (preflight) {
        setError(preflight);
        setStatus("error");
        onErrorRef.current(preflight);
        return;
      }

      try {
        // Candidate constraints, tried in order. `exact: "environment"` is what
        // actually forces the REAR camera — `ideal` is only a hint and phones
        // are free to ignore it. It throws OverconstrainedError on front-only
        // devices (laptops), so we degrade: exact rear -> preferred rear -> any.
        const candidates: MediaTrackConstraints[] = selectedDeviceId
          ? [{ deviceId: { exact: selectedDeviceId } }]
          : [
              { facingMode: { exact: "environment" } },
              { facingMode: "environment" },
              {},
            ];

        let stream: MediaStream | null = null;
        let lastErr: unknown = null;
        for (const video of candidates) {
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              audio: false,
              video,
            });
            break;
          } catch (err) {
            lastErr = err;
            // Permission refusal won't be fixed by a looser constraint — stop.
            const name = (err as Error)?.name;
            if (name === "NotAllowedError" || name === "SecurityError") break;
          }
        }
        if (!stream) throw lastErr;

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;

        // Enumerate cameras only AFTER permission (labels/deviceIds are hidden
        // until granted). Stored in a ref so this never restarts the stream —
        // it only powers the Flip affordance.
        if (deviceListRef.current.length === 0) {
          try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const cams = devices
              .filter((d) => d.kind === "videoinput")
              .map((d) => d.deviceId)
              .filter(Boolean);
            deviceListRef.current = cams;
            if (!cancelled) setCameraCount(cams.length);
          } catch {
            /* enumeration is best-effort */
          }
        }

        const track = stream.getVideoTracks()[0] as TorchCapableTrack | undefined;
        const caps = track?.getCapabilities?.() as
          | (MediaTrackCapabilities & { torch?: boolean })
          | undefined;
        setTorchSupported(Boolean(caps?.torch));

        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          video.setAttribute("playsinline", "true"); // iOS: don't go fullscreen
          await video.play().catch(() => {
            /* autoplay can reject; the frame still renders once visible */
          });
        }

        engineRef.current = await pickEngine(formats);
        if (cancelled) return;

        setStatus("scanning");
        runLoop();
      } catch (err) {
        if (cancelled) return;
        const mapped = mapGetUserMediaError(err);
        setError(mapped);
        setStatus("error");
        onErrorRef.current(mapped);
      }
    };

    start();
    return () => {
      cancelled = true;
      teardown();
    };
    // formats is captured by value; changing it mid-session isn't a supported
    // live operation (close + reopen to change symbologies).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, selectedDeviceId, runLoop, teardown]);

  const pause = useCallback(() => {
    pausedRef.current = true;
    setStatus((s) => (s === "scanning" ? "paused" : s));
  }, []);

  const resume = useCallback(() => {
    pausedRef.current = false;
    setStatus((s) => (s === "paused" ? "scanning" : s));
  }, []);

  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({
        advanced: [{ torch: next } as MediaTrackConstraintSet],
      });
      setTorchOn(next);
    } catch (err) {
      onErrorRef.current(
        new ScannerError("unknown", "Torch toggle failed", err),
      );
    }
  }, [torchOn]);

  const switchCamera = useCallback(() => {
    const cams = deviceListRef.current;
    if (cams.length < 2) return;
    // Advance from whichever camera is actually live, not from a stale index —
    // the first stream is chosen by facingMode, so its position is unknown
    // until we look it up.
    const activeId = streamRef.current?.getVideoTracks()[0]?.getSettings?.()
      .deviceId;
    const current = activeId ? cams.indexOf(activeId) : -1;
    setSelectedDeviceId(cams[(current + 1) % cams.length]);
  }, []);

  return {
    videoRef,
    status,
    error,
    torchSupported,
    torchOn,
    toggleTorch,
    canSwitchCamera: cameraCount > 1,
    switchCamera,
    pause,
    resume,
  };
}
