// Sound effects + looping background music. Used by the TV display only.

let ctx: AudioContext | null = null;
let unlocked = false;

const MUTE_KEY = 'ff-muted';

export function isMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setMuted(m: boolean) {
  try {
    localStorage.setItem(MUTE_KEY, m ? '1' : '0');
  } catch {
    /* ignore */
  }
  applyMusic();
}

function getCtx(): AudioContext | null {
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  return ctx;
}

/** Browsers only allow audio after a user gesture; call once on the first tap/key. */
export function unlockAudio() {
  if (unlocked) return;
  const c = getCtx();
  if (!c) return;
  void c.resume().then(() => {
    unlocked = c.state === 'running';
    applyMusic(); // start whatever music is supposed to be playing
  });
  loadClips();
}

export function audioRunning(): boolean {
  return ctx?.state === 'running';
}

export function installAudioUnlock(): () => void {
  const on = () => unlockAudio();
  window.addEventListener('pointerdown', on);
  window.addEventListener('keydown', on);
  return () => {
    window.removeEventListener('pointerdown', on);
    window.removeEventListener('keydown', on);
  };
}

function tone(
  c: AudioContext,
  start: number,
  freq: number,
  dur: number,
  type: OscillatorType,
  peak: number,
  endFreq?: number,
) {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, start + dur);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(gain).connect(c.destination);
  osc.start(start);
  osc.stop(start + dur + 0.05);
}

function ready(): AudioContext | null {
  if (isMuted()) return null;
  const c = getCtx();
  if (!c) return null;
  if (c.state === 'suspended') void c.resume();
  return c;
}

/**
 * Game-show style "wrong answer" buzzer: a flat, nasal, slightly comical
 * "EHHHH" (two detuned square waves through a low-pass filter, no scary
 * sub-bass), with a little wobble and a droop at the end.
 */
function synthBuzzer() {
  const c = ready();
  if (!c) return;
  const t = c.currentTime + 0.01;
  const dur = 0.85;

  const filter = c.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 1300;
  filter.Q.value = 3;

  const gain = c.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.28, t + 0.02);
  gain.gain.setValueAtTime(0.28, t + dur - 0.12);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  filter.connect(gain).connect(c.destination);

  // Slow wobble on the pitch for the cheesy "wah" feel.
  const lfo = c.createOscillator();
  const lfoGain = c.createGain();
  lfo.frequency.value = 9;
  lfoGain.gain.value = 3;
  lfo.connect(lfoGain);

  for (const f of [233, 240]) {
    const osc = c.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(f, t);
    osc.frequency.setValueAtTime(f, t + dur - 0.2);
    osc.frequency.exponentialRampToValueAtTime(f * 0.85, t + dur);
    lfoGain.connect(osc.frequency);
    osc.connect(filter);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }
  lfo.start(t);
  lfo.stop(t + dur + 0.05);
}

/** Bell partial: sine with an exponential decay. */
function bell(c: AudioContext, start: number, freq: number, dur: number, peak: number) {
  // Bell-ish partials (slightly inharmonic) for that "DING!" sparkle.
  const partials: [number, number][] = [[1, 1], [2.01, 0.45], [3.99, 0.25], [5.4, 0.12]];
  for (const [ratio, amp] of partials) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq * ratio;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak * amp, start + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur / ratio ** 0.3);
    osc.connect(gain).connect(c.destination);
    osc.start(start);
    osc.stop(start + dur + 0.05);
  }
}

/** Cheesy bright "ba-DING!" for a correct answer. */
function synthDing() {
  const c = ready();
  if (!c) return;
  const t = c.currentTime + 0.01;
  bell(c, t, 1046.5, 0.25, 0.22); // C6 "ba-"
  bell(c, t + 0.11, 1568, 1.1, 0.3); // G6 "-DING!"
  tone(c, t + 0.11, 3136, 0.2, 'triangle', 0.05); // sparkle
}

// ---- Recorded clips (public/sounds/*.mp3), with the synthesized versions above as a fallback.

const CLIP_NAMES = ['ding', 'buzzer', 'repeat', 'flip', 'zero'] as const;
type ClipName = (typeof CLIP_NAMES)[number];
const clips: Record<ClipName, AudioBuffer | null> = { ding: null, buzzer: null, repeat: null, flip: null, zero: null };
let loading = false;

function loadClips() {
  const c = getCtx();
  if (!c || loading) return;
  loading = true;
  CLIP_NAMES.forEach((name) => {
    fetch(`/sounds/${name}.mp3`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((buf) => c.decodeAudioData(buf))
      .then((audio) => {
        clips[name] = audio;
      })
      .catch(() => undefined); // keep the synthesized fallback
  });
}

function playClip(name: ClipName, fallback: () => void) {
  loadClips();
  const audio = clips[name];
  if (!audio) return fallback();
  const c = ready();
  if (!c) return;
  const src = c.createBufferSource();
  src.buffer = audio;
  src.connect(c.destination);
  src.start();
}

export const playBuzzer = () => playClip('buzzer', synthBuzzer);
export const playDing = () => playClip('ding', synthDing);
/** Fast Money: an answer's text is revealed (before its points). */
export const playFlip = () => playClip('flip', () => {
  const c = ready();
  if (c) tone(c, c.currentTime + 0.01, 660, 0.18, 'triangle', 0.2, 990);
});
/** Fast Money: the answer scored 0 points. */
export const playZero = () => playClip('zero', synthBuzzer);
/** "Try again": player 2 repeated one of player 1's Fast Money answers. */
export const playRepeat = () => playClip('repeat', synthBuzzer);

// ---- Background music (loops until told to stop)

export type MusicTrack = 'theme' | 'fm';
const MUSIC_GAIN = 0.6;
const FADE_IN = 0.4;
const FADE_OUT = 1;

const music: Record<MusicTrack, AudioBuffer | null> = { theme: null, fm: null };
const musicLoading: Partial<Record<MusicTrack, boolean>> = {};
let wanted: MusicTrack | null = null;
let playing: { track: MusicTrack; src: AudioBufferSourceNode; gain: GainNode } | null = null;

function loadMusic(track: MusicTrack) {
  const c = getCtx();
  if (!c || musicLoading[track]) return;
  musicLoading[track] = true;
  fetch(`/sounds/${track}.mp3`)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
    .then((buf) => c.decodeAudioData(buf))
    .then((audio) => {
      music[track] = audio;
      applyMusic();
    })
    .catch(() => {
      musicLoading[track] = false;
    });
}

function stopPlaying() {
  const p = playing;
  if (!p || !ctx) return;
  playing = null;
  const t = ctx.currentTime;
  p.gain.gain.cancelScheduledValues(t);
  p.gain.gain.setValueAtTime(p.gain.gain.value, t);
  p.gain.gain.linearRampToValueAtTime(0, t + FADE_OUT);
  p.src.stop(t + FADE_OUT + 0.05);
}

/** Make the actual playback match `wanted` (called on changes, unlock, mute and when a track finishes loading). */
function applyMusic() {
  const target = isMuted() ? null : wanted;
  if (playing && playing.track !== target) stopPlaying();
  if (!target || playing) return;
  const c = getCtx();
  if (!c || c.state !== 'running') return; // waits for the first tap (see unlockAudio)
  const audio = music[target];
  if (!audio) return loadMusic(target);
  const src = c.createBufferSource();
  const gain = c.createGain();
  src.buffer = audio;
  src.loop = true;
  gain.gain.setValueAtTime(0, c.currentTime);
  gain.gain.linearRampToValueAtTime(MUSIC_GAIN, c.currentTime + FADE_IN);
  src.connect(gain).connect(c.destination);
  src.start();
  playing = { track: target, src, gain };
}

/** Loop `track` until called again with another track or null (fades out). */
export function setMusic(track: MusicTrack | null) {
  wanted = track;
  if (track) {
    getCtx();
    loadMusic(track);
  }
  applyMusic();
}
