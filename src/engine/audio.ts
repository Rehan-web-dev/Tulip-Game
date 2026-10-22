/*
 * Web Audio mixer with saved Music and SFX buses. Browsers only allow sound after a user gesture,
 * so unlock() is called by the title/menu actions before playback begins.
 */
export type Sfx = 'pickup' | 'jump' | 'land' | 'hurt' | 'ui' | 'win' | 'lose' | 'dash' | 'birthday'
export type GardenSfx = 'pick' | 'feed'

export class Audio {
  readonly ctx: AudioContext
  private master: GainNode
  private music: GainNode
  private sfx: GainNode
  private musicTimer = 0
  private musicOn = false
  private birthdayTimer = 0
  private birthdayPlaying = false
  private musicLevel = 0.55
  private buffers = new Map<string, AudioBuffer>()
  private musicSources: AudioBufferSourceNode[] = []
  private gardenBuffers: { music?: AudioBuffer; birthday?: AudioBuffer; ambience?: AudioBuffer; pick?: AudioBuffer; feed?: AudioBuffer } = {}

  constructor() {
    this.ctx = new AudioContext()
    this.master = this.ctx.createGain()
    this.music = this.ctx.createGain()
    this.sfx = this.ctx.createGain()
    this.music.connect(this.master)
    this.sfx.connect(this.master)
    this.master.connect(this.ctx.destination)
  }

  /** Play the supplied birthday song while suspending the looping garden bed for 15 seconds. */
  playBirthdaySong(): void {
    if (this.ctx.state !== 'running') return
    const buffer = this.gardenBuffers.birthday
    if (!buffer) {
      this.play('birthday')
      return
    }
    clearTimeout(this.birthdayTimer)
    this.birthdayPlaying = true
    this.music.gain.setTargetAtTime(0, this.ctx.currentTime, 0.04)
    const source = this.playBuffer(buffer, 'sfx', false, 1)
    const finish = () => {
      if (!this.birthdayPlaying) return
      this.birthdayPlaying = false
      this.birthdayTimer = 0
      this.music.gain.setTargetAtTime(this.musicOn ? this.musicLevel : 0, this.ctx.currentTime, 0.12)
    }
    this.birthdayTimer = window.setTimeout(() => {
      try { source.stop() } catch { /* already ended */ }
      finish()
    }, 15_000)
  }

  unlock(): void {
    if (this.ctx.state === 'suspended') void this.ctx.resume()
  }

  get gardenAudioLoaded(): { music: boolean; ambience: boolean; pick: boolean; feed: boolean } {
    return {
      music: this.gardenBuffers.music !== undefined,
      ambience: this.gardenBuffers.ambience !== undefined,
      pick: this.gardenBuffers.pick !== undefined,
      feed: this.gardenBuffers.feed !== undefined,
    }
  }

  get gardenMusicPlaying(): boolean {
    return this.musicOn
  }

  /** Volumes in 0..1. Both generated beds use the Music bus; interactions use SFX. */
  setVolumes(music: number, sfx: number, muted = false): void {
    const t = this.ctx.currentTime
    this.musicLevel = muted ? 0 : music * 0.55
    this.music.gain.setTargetAtTime(this.birthdayPlaying ? 0 : this.musicLevel, t, 0.05)
    this.sfx.gain.setTargetAtTime(muted ? 0 : sfx * 0.8, t, 0.05)
  }

  async load(url: string): Promise<AudioBuffer> {
    const cached = this.buffers.get(url)
    if (cached) return cached
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Audio request failed (${response.status}): ${url}`)
    const data = await response.arrayBuffer()
    const buffer = await this.ctx.decodeAudioData(data)
    this.buffers.set(url, buffer)
    return buffer
  }

  setGardenAudio(buffers: { music?: AudioBuffer; birthday?: AudioBuffer; ambience?: AudioBuffer; pick?: AudioBuffer; feed?: AudioBuffer }): void {
    this.gardenBuffers = buffers
  }

  playBuffer(buffer: AudioBuffer, bus: 'music' | 'sfx' = 'sfx', loop = false, volume = 1): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource()
    const level = this.ctx.createGain()
    src.buffer = buffer
    src.loop = loop
    level.gain.value = volume
    src.connect(level).connect(bus === 'music' ? this.music : this.sfx)
    src.start()
    return src
  }

  playGardenSfx(name: GardenSfx): void {
    if (this.ctx.state !== 'running') return
    const buffer = this.gardenBuffers[name]
    if (buffer) this.playBuffer(buffer, 'sfx')
    else this.play(name === 'pick' ? 'pickup' : 'ui')
  }

  play(name: Sfx): void {
    if (this.ctx.state !== 'running') return
    const t = this.ctx.currentTime
    const tone = (freq: number, end: number, dur: number, type: OscillatorType, vol: number, delay = 0) => {
      const o = this.ctx.createOscillator()
      const g = this.ctx.createGain()
      o.type = type
      o.frequency.setValueAtTime(freq, t + delay)
      o.frequency.exponentialRampToValueAtTime(Math.max(end, 20), t + delay + dur)
      g.gain.setValueAtTime(0.0001, t + delay)
      g.gain.exponentialRampToValueAtTime(vol, t + delay + 0.012)
      g.gain.exponentialRampToValueAtTime(0.0001, t + delay + dur)
      o.connect(g).connect(this.sfx)
      o.start(t + delay)
      o.stop(t + delay + dur + 0.05)
    }
    switch (name) {
      case 'pickup': tone(880, 1320, 0.12, 'triangle', 0.35); tone(1320, 1760, 0.16, 'sine', 0.25, 0.06); break
      case 'jump': tone(300, 620, 0.14, 'square', 0.12); break
      case 'land': tone(160, 70, 0.1, 'sine', 0.25); break
      case 'hurt': tone(220, 90, 0.28, 'sawtooth', 0.22); break
      case 'ui': tone(660, 700, 0.06, 'triangle', 0.18); break
      case 'dash': tone(500, 180, 0.18, 'sawtooth', 0.1); break
      case 'win': [523, 659, 784, 1047].forEach((f, i) => tone(f, f * 1.01, 0.3, 'triangle', 0.25, i * 0.11)); break
      case 'lose': [392, 330, 262].forEach((f, i) => tone(f, f * 0.98, 0.38, 'sine', 0.25, i * 0.16)); break
      case 'birthday': [392, 392, 440, 392, 523, 494, 392, 392, 440, 392, 587, 523].forEach((f, i) => tone(f, f * 1.01, 0.2, 'triangle', 0.2, i * 0.21)); break
    }
  }

  /** Start generated looping beds when the player enters the garden, after browser audio unlock. */
  startMusic(): void {
    if (this.musicOn) return
    this.musicOn = true
    if (this.gardenBuffers.music) {
      this.musicSources.push(this.playBuffer(this.gardenBuffers.music, 'music', true, 1))
      if (this.gardenBuffers.ambience) this.musicSources.push(this.playBuffer(this.gardenBuffers.ambience, 'music', true, 0.22))
      return
    }
    this.startFallbackMusic()
  }

  stopMusic(): void {
    this.musicOn = false
    clearTimeout(this.musicTimer)
    for (const source of this.musicSources) {
      try { source.stop() } catch { /* already stopped */ }
    }
    this.musicSources = []
  }

  /** Gentle chord fallback remains available if an optional downloaded music file cannot decode. */
  private startFallbackMusic(): void {
    const chords = [[220, 277.2, 329.6], [196, 246.9, 293.7], [174.6, 220, 261.6], [196, 261.6, 329.6]]
    let bar = 0
    const schedule = () => {
      if (!this.musicOn) return
      const t = this.ctx.currentTime + 0.05
      const chord = chords[bar % chords.length]
      for (const f of chord) {
        for (const detune of [-6, 6]) {
          const o = this.ctx.createOscillator()
          const g = this.ctx.createGain()
          o.type = 'sine'
          o.frequency.value = f / 2
          o.detune.value = detune
          g.gain.setValueAtTime(0.0001, t)
          g.gain.linearRampToValueAtTime(0.05, t + 1.2)
          g.gain.linearRampToValueAtTime(0.0001, t + 4.2)
          o.connect(g).connect(this.music)
          o.start(t)
          o.stop(t + 4.4)
        }
      }
      bar += 1
      this.musicTimer = window.setTimeout(schedule, 3600)
    }
    schedule()
  }
}
