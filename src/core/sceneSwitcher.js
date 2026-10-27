'use strict';

const { EventEmitter } = require('events');

const DEFAULT_SETTLE_MS = 300; // pause between Preview and Transition, see below
const LATCH_GRACE_MS = 100; // extra time after the Bridge's transition change, so its whole batch has landed
const TRANSITION_END_CAP_MS = 3000; // OBS may never send SceneTransitionEnded for an interrupted transition
const RESOURCE_NOT_FOUND = 600;

/**
 * Puts a scene on air the way an operator would in Studio Mode: load it into Preview, then press Transition.
 * Going through Preview (not SetCurrentProgramScene) lets the EMEET-OBS Bridge see the change coming, choose the
 * right transition and move the camera. We never touch the transition ourselves; the Bridge owns that choice.
 *
 * The pause between the two steps matters: if Transition fires before the Bridge has selected its transition, OBS
 * latches the old one and the camera moves late. So we wait `settleMs` after Preview is set, or only a short grace
 * once OBS reports the transition changed (i.e. the Bridge has acted).
 */
class SceneSwitcher extends EventEmitter {
  constructor(client, { settleMs = DEFAULT_SETTLE_MS } = {}) {
    super();
    this.client = client;
    this.settleMs = settleMs;
    this.scenes = []; // names in the order OBS lists them; kept while disconnected so saved choices stay visible
    this.problem = null; // why the last switch could not happen
    this.last = null; // {scene, at, outcome: 'sent' | 'already-live'}
    this.busy = false;
    this._pending = null; // latest requested scene while a switch is running
    this._loop = null;

    client.on('ready', () => this.refreshScenes());
    client.on('state', () => this.emit('change'));
    client.on('event', (type) => {
      if (type === 'SceneListChanged' || type === 'CurrentSceneCollectionChanged') this.refreshScenes();
    });
  }

  async refreshScenes() {
    try {
      const r = await this.client.request('GetSceneList');
      this.scenes = (r.scenes || []).sort((a, b) => b.sceneIndex - a.sceneIndex).map((s) => s.sceneName); // OBS lists bottom-up
      this.emit('change');
    } catch {
      /* the connection state already says what is wrong */
    }
  }

  /**
   * Puts `sceneName` on air. Resolves when the switch (and anything queued behind it) is finished; never rejects.
   * If a switch is already running, only the most recently requested scene runs after it.
   */
  switchTo(sceneName) {
    this._pending = sceneName;
    if (!this._loop) this._loop = this._drain().finally(() => (this._loop = null));
    return this._loop;
  }

  async _drain() {
    this._set({ busy: true });
    while (this._pending !== null) {
      const scene = this._pending;
      this._pending = null;
      try {
        const outcome = await this._run(scene);
        this.last = { scene, at: Date.now(), outcome };
        this._set({ problem: null });
      } catch (err) {
        this._set({ problem: err.code === RESOURCE_NOT_FOUND ? `OBS has no scene called “${scene}”` : err.message });
      }
    }
    this._set({ busy: false });
  }

  _set(patch) {
    Object.assign(this, patch);
    this.emit('change');
  }

  async _run(scene) {
    const c = this.client;
    if (!c.connected) throw new Error('Not connected to OBS');

    if (!(await c.request('GetStudioModeEnabled')).studioModeEnabled) throw new Error('Turn on Studio Mode in OBS so scenes can be previewed first');

    const live = await c.request('GetCurrentProgramScene');
    if ((live.sceneName ?? live.currentProgramSceneName) === scene) return 'already-live';

    // Step 1: Preview. Watch for the Bridge reacting (it changes the transition) before we send, as the event can beat the response.
    const reacted = c.waitFor('CurrentSceneTransitionChanged');
    try {
      await c.request('SetCurrentPreviewScene', { sceneName: scene });
      await settle(reacted.promise, this.settleMs, LATCH_GRACE_MS);
    } finally {
      reacted.cancel();
    }

    // Step 2: Transition, exactly like the Transition button. Stay busy until it is over so two never overlap.
    const ended = c.waitFor('SceneTransitionEnded', TRANSITION_END_CAP_MS);
    try {
      await c.request('TriggerStudioModeTransition');
      await ended.promise;
    } finally {
      ended.cancel();
    }
    return 'sent';
  }
}

/** Waits `ms`, or just `graceMs` after `signal` resolves true, whichever is sooner. */
function settle(signal, ms, graceMs) {
  return new Promise((resolve) => {
    let early = null;
    const done = () => {
      clearTimeout(full);
      clearTimeout(early);
      resolve();
    };
    const full = setTimeout(done, ms);
    signal.then((fired) => {
      if (fired) early = setTimeout(done, Math.min(graceMs, ms));
    });
  });
}

module.exports = { SceneSwitcher, DEFAULT_SETTLE_MS };
