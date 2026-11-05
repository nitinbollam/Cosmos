import { ScannerError } from './types'

/**
 * Keeping a long camera session alive (ClickUp 44/45: after about 60 scans the camera stopped counting while typed
 * codes still worked). The decode loop must never wait forever on one frame, must replace a decoder that keeps
 * failing, and must notice when the camera itself stops delivering new pictures. Kept free of React and the DOM so
 * the rules can be tested with a fake clock.
 */

/** Settles with `promise`, or rejects once `ms` have passed without an answer. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ScannerError('unknown', `Decode took longer than ${ms} ms`)), ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

/** Counts decode failures in a row; says when the decoder should be replaced. */
export class DecodeFailures {
  private inARow = 0

  constructor(private limit = 3) {}

  succeeded(): void {
    this.inARow = 0
  }

  /** True when this failure reaches the limit (and the count starts again). */
  failed(): boolean {
    this.inARow++
    if (this.inARow < this.limit) return false
    this.inARow = 0
    return true
  }
}

/**
 * Notices a frozen camera: a video whose time stops moving keeps handing the decoder the same picture, so nothing new
 * is ever read. Restarts are spaced out so a camera that can't recover isn't reopened in a tight loop.
 */
export class FrameStallWatch {
  private lastTime = -1
  private lastMoveAt: number
  private lastRestartAt = -Infinity

  constructor(
    private stallMs = 4000,
    private minRestartGapMs = 10_000,
    private now: () => number = () => Date.now(),
  ) {
    this.lastMoveAt = this.now()
  }

  /** Call on each tick with the video's currentTime. True when the camera should be reopened now. */
  shouldRestart(videoTime: number): boolean {
    const t = this.now()
    if (videoTime !== this.lastTime) {
      this.lastTime = videoTime
      this.lastMoveAt = t
      return false
    }
    if (t - this.lastMoveAt < this.stallMs || t - this.lastRestartAt < this.minRestartGapMs) return false
    this.lastRestartAt = t
    this.lastMoveAt = t
    return true
  }

  /** A fresh stream: start watching from now. */
  reset(): void {
    this.lastTime = -1
    this.lastMoveAt = this.now()
  }
}
