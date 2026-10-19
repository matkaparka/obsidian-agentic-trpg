/**
 * Atlas Agent Link — plugin entry.
 *
 * Serves one local MCP endpoint (127.0.0.1) and an SSE event stream, and turns every Atlas store
 * write into a semantic event for the orchestrator. All Atlas knowledge lives in
 * `src/atlas/adapter.ts`; this file is wiring, settings and the kill switch.
 */
import { Notice, Plugin, PluginSettingTab, Setting, type App } from 'obsidian';
import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import { AtlasAdapter, type AtlasView } from './atlas/adapter';
import { PlayerFrameController } from './atlas/playerFrame';
import { deriveEvents, EventBus } from './events';
import { startHttp } from './http';
import { McpServer } from './mcp/server';
import { DEFAULT_SETTINGS, type Settings } from './settings';
import { buildTools, type CallRecord } from './tools';

export default class AtlasAgentLink extends Plugin {
  declare settings: Settings;
  server: Server | null = null;
  bus = new EventBus();
  callLog: CallRecord[] = [];
  /** The stream frame injected into Atlas' player popout (tool: atlas_player_frame). */
  playerFrame!: PlayerFrameController;
  private unsubscribe: (() => void) | null = null;
  private subscribedStore: unknown = null;
  private statusEl: HTMLElement | null = null;
  private sceneLoaded = false;
  private boundMapPath: string | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    if (!this.settings.token) {
      this.settings.token = randomBytes(24).toString('hex');
      await this.saveSettings();
    }

    this.addSettingTab(new AtlasAgentLinkTab(this.app, this));
    this.statusEl = this.addStatusBarItem();
    this.playerFrame = new PlayerFrameController(this.app, new AtlasAdapter(this.app));
    this.playerFrame.install();

    this.addCommand({ id: 'start', name: 'Start agent server', callback: () => { void this.start(); } });
    this.addCommand({ id: 'stop', name: 'Stop agent server (kill switch)', callback: () => this.stop(true) });
    this.addCommand({
      id: 'toggle-write',
      name: 'Toggle AI write access',
      callback: async () => {
        this.settings.allowWrite = !this.settings.allowWrite;
        await this.saveSettings();
        this.renderStatus();
        new Notice(`Atlas Agent Link: AI writes ${this.settings.allowWrite ? 'ENABLED' : 'disabled (read-only)'}`);
      },
    });
    this.addCommand({
      id: 'copy-token',
      name: 'Copy bearer token',
      callback: async () => {
        await navigator.clipboard.writeText(this.settings.token);
        new Notice('Atlas Agent Link: token copied');
      },
    });
    this.addCommand({
      id: 'status',
      name: 'Show status',
      callback: () => {
        const atlas = new AtlasAdapter(this.app);
        const caps = atlas.capabilities();
        new Notice([
          `Atlas Agent Link ${this.manifest.version}`,
          `server: ${this.server ? `http://127.0.0.1:${this.settings.port}/mcp` : 'stopped'}`,
          `writes: ${this.settings.allowWrite ? 'on' : 'off (read-only)'}`,
          `Atlas: ${caps.version ?? 'not found'} (${caps.tested ? 'verified' : 'UNTESTED'})`,
          `scenes open: ${caps.openScenes} (loaded: ${caps.loadedScenes})`,
          `events: ${this.bus.size()}`,
        ].join('\n'));
      },
    });
    this.addCommand({
      id: 'screenshot-scene',
      name: 'Copy a screenshot of the scene to the clipboard? (see atlas_screenshot)',
      callback: () => new Notice('Use the atlas_screenshot tool (or the MCP client) — it returns the PNG as image content.'),
    });

    // Follow whichever Atlas scene is active, so the event stream never goes quiet on a tab switch.
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.rebind()));
    this.registerEvent(this.app.workspace.on('layout-change', () => this.rebind()));
    this.registerEvent(this.app.workspace.on('file-open', () => { this.unsubscribe?.(); this.unsubscribe = null; this.subscribedStore = null; this.rebind(); }));

    if (this.settings.autostart) this.app.workspace.onLayoutReady(() => { void this.start(); });
    this.renderStatus();

    // Handy for debugging from the Obsidian dev console (and for this plugin's own E2E script).
    (window as any).atlasAgentLink = this;
  }

  onunload(): void {
    this.playerFrame?.dispose();
    this.stop();
  }

  async loadSettings(): Promise<void> {
    const stored = (await this.loadData()) as Partial<Settings> | null;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...(stored ?? {}),
      applyAllowlist: Array.isArray(stored?.applyAllowlist) && stored!.applyAllowlist!.length ? stored!.applyAllowlist! : DEFAULT_SETTINGS.applyAllowlist,
    };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.renderStatus();
  }

  /**
   * Points the event stream at the store of the scene that is in front.
   *
   * Binding follows the *view* (one store per Atlas view, whatever tab it shows), not the loaded
   * scene, because Atlas finishes loading a scene long after the workspace has settled: a
   * subscription made only on workspace events would miss every write to a freshly opened scene.
   * Writes made while a scene is still loading are not narrated.
   */
  rebind(): void {
    const atlas = new AtlasAdapter(this.app);
    const views = atlas.views();
    const active = this.app.workspace.getActiveViewOfType(Object as any) as unknown as AtlasView | null;
    const view = active && views.includes(active) ? active : views[0] ?? null;
    let store: any = null;
    try { store = view ? atlas.store(view) : null; } catch { store = null; }

    if (store === this.subscribedStore) return;

    this.unsubscribe?.();
    this.unsubscribe = null;
    this.subscribedStore = store;

    if (!store) {
      if (this.sceneLoaded) this.bus.emit('scene_closed', {});
      this.sceneLoaded = false;
      this.boundMapPath = null;
      this.renderStatus();
      return;
    }

    this.unsubscribe = store.subscribe((next: any, prev: any) => {
      if (!next || next === prev) return;
      const loading = next.isMapLoading === true || next.mapLoaded !== true;
      if (loading) {
        if (this.sceneLoaded) {
          this.sceneLoaded = false;
          this.bus.emit('scene_closed', { mapPath: this.boundMapPath });
          this.boundMapPath = null;
        }
        return;
      }
      if (!this.sceneLoaded || this.boundMapPath !== next.mapPath) {
        this.sceneLoaded = true;
        this.boundMapPath = typeof next.mapPath === 'string' ? next.mapPath : null;
        this.bus.emit('scene_loaded', { mapPath: this.boundMapPath, atlasVersion: atlas.version() });
        this.renderStatus();
        // The load itself is not a scene edit; start narrating from the state it settled on.
        return;
      }
      if (!prev) return;
      try {
        for (const event of deriveEvents(prev, next)) this.bus.emit(event.type, event as any);
      } catch (e) {
        this.bus.emit('event_error', { message: (e as Error)?.message ?? String(e) });
      }
    });

    // A scene that is already loaded when we bind must announce itself at once.
    try {
      const state = store.getState();
      if (state?.mapLoaded && !state.isMapLoading) {
        this.sceneLoaded = true;
        this.boundMapPath = typeof state.mapPath === 'string' ? state.mapPath : null;
        this.bus.emit('scene_loaded', { mapPath: this.boundMapPath, atlasVersion: atlas.version() });
      }
    } catch { /* a store that cannot be read yet announces itself on its first write */ }
    this.renderStatus();
  }

  private safeMapPath(atlas: AtlasAdapter): string | null {
    try { return atlas.loadedViews()[0]?.getStore().getState().mapPath ?? null; } catch { return null; }
  }

  async start(): Promise<void> {
    if (this.server) {
      new Notice(`Atlas Agent Link is already listening on 127.0.0.1:${this.settings.port}`);
      return;
    }
    const atlas = new AtlasAdapter(this.app);
    const mcp = new McpServer({
      allowWrite: () => this.settings.allowWrite,
      onCall: (entry) => {
        this.callLog.push({ at: Date.now(), ...entry });
        if (this.callLog.length > 500) this.callLog.shift();
        this.bus.emit('tool_call', { tool: entry.tool, ok: entry.ok, ms: entry.ms, ...(entry.error ? { error: entry.error } : {}) });
      },
      tools: () => buildTools({
        app: this.app,
        atlas,
        bus: this.bus,
        settings: () => this.settings,
        callLog: () => this.callLog.slice(-100),
        playerFrame: this.playerFrame,
      }),
      serverInfo: { name: 'atlas-agent-link', version: this.manifest.version },
    });

    try {
      this.server = await startHttp({
        port: this.settings.port,
        token: this.settings.token,
        mcp,
        bus: this.bus,
        maxPerMinute: this.settings.rateLimit,
        status: () => ({
          writes: this.settings.allowWrite,
          atlasVersion: atlas.version(),
          mapPath: this.safeMapPath(atlas),
        }),
      });
      this.rebind();
      this.renderStatus();
      new Notice(`Atlas Agent Link on 127.0.0.1:${this.settings.port} (AI writes ${this.settings.allowWrite ? 'ON' : 'off'})`);
    } catch (e: any) {
      const message = e?.code === 'EADDRINUSE'
        ? `port ${this.settings.port} is already in use — change it in the Atlas Agent Link settings`
        : (e?.message ?? String(e));
      new Notice(`Atlas Agent Link failed to start: ${message}`, 8000);
      this.bus.emit('server_error', { message });
    }
  }

  stop(announce = false): void {
    this.server?.closeAllConnections?.();
    this.server?.close();
    this.server = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.subscribedStore = null;
    this.sceneLoaded = false;
    this.renderStatus();
    if (announce) new Notice('Atlas Agent Link stopped (kill switch). No tool can reach Atlas until it is started again.');
  }

  private renderStatus(): void {
    if (!this.statusEl) return;
    const state = this.server ? `:${this.settings.port}` : 'stopped';
    const writes = this.settings.allowWrite ? 'W' : 'RO';
    this.statusEl.setText(`Atlas link ${state} ${writes}`);
    this.statusEl.setAttribute('aria-label', `Atlas Agent Link — server ${state}, AI writes ${this.settings.allowWrite ? 'enabled' : 'read-only'}`);
  }
}

class AtlasAgentLinkTab extends PluginSettingTab {
  constructor(app: App, private plugin: AtlasAgentLink) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings;
    const save = async () => { await this.plugin.saveSettings(); this.plugin['renderStatus']?.(); };

    containerEl.createEl('h3', { text: 'Atlas Agent Link' });
    containerEl.createEl('p', {
      text: `MCP: http://127.0.0.1:${s.port}/mcp   ·   events (SSE): http://127.0.0.1:${s.port}/events   ·   server ${this.plugin.server ? 'running' : 'stopped'}`,
    });

    new Setting(containerEl)
      .setName('Allow AI to modify the scene')
      .setDesc('Off = read-only: every write tool fails. Can also be toggled with the "Toggle AI write access" command.')
      .addToggle((t) => t.setValue(s.allowWrite).onChange(async (v) => { s.allowWrite = v; await save(); this.plugin['renderStatus']?.(); }));

    new Setting(containerEl)
      .setName('Port')
      .setDesc('Loopback only (127.0.0.1). Restart the server after changing it.')
      .addText((t) => t.setValue(String(s.port)).onChange(async (v) => {
        const next = Number(v);
        if (Number.isInteger(next) && next >= 1024 && next <= 65535) { s.port = next; await save(); }
      }));

    new Setting(containerEl)
      .setName('Start with Obsidian')
      .setDesc('Start the local server when the workspace is ready.')
      .addToggle((t) => t.setValue(s.autostart).onChange(async (v) => { s.autostart = v; await save(); }));

    new Setting(containerEl)
      .setName('Bearer token')
      .setDesc('Send as "Authorization: Bearer <token>". Regenerating restarts the server.')
      .addText((t) => t.setValue(s.token).setDisabled(true))
      .addButton((b) => b.setButtonText('Copy').onClick(async () => { await navigator.clipboard.writeText(s.token); new Notice('Token copied'); }))
      .addButton((b) => b.setButtonText('Regenerate').onClick(async () => {
        s.token = randomBytes(24).toString('hex');
        await save();
        this.plugin.stop();
        await this.plugin.start();
        this.display();
      }));

    new Setting(containerEl)
      .setName('Rate limit (requests/minute)')
      .setDesc('Applies to POST /mcp. The event stream is not rate limited.')
      .addText((t) => t.setValue(String(s.rateLimit)).onChange(async (v) => { const n = Number(v); if (Number.isFinite(n) && n >= 10) { s.rateLimit = n; await save(); } }));

    new Setting(containerEl)
      .setName('Screenshot folder')
      .setDesc('Where atlas_screenshot writes PNGs inside the vault.')
      .addText((t) => t.setValue(s.screenshotDir).onChange(async (v) => { s.screenshotDir = v.trim() || DEFAULT_SETTINGS.screenshotDir; await save(); }));

    new Setting(containerEl)
      .setName('Screenshot max side (px)')
      .setDesc('Screenshots are downscaled to this longest side before being returned.')
      .addText((t) => t.setValue(String(s.screenshotMaxWidth)).onChange(async (v) => { const n = Number(v); if (n >= 160 && n <= 4000) { s.screenshotMaxWidth = n; await save(); } }));

    new Setting(containerEl)
      .setName('Actions atlas_apply may call')
      .setDesc('Comma separated store action names. Destructive actions stay blocked even if listed here.')
      .addTextArea((t) => t.setValue(s.applyAllowlist.join(', ')).onChange(async (v) => {
        s.applyAllowlist = v.split(',').map((x) => x.trim()).filter(Boolean);
        await save();
      }));

    new Setting(containerEl)
      .setName('Server')
      .setDesc(this.plugin.server ? 'Running. "Stop" is the kill switch: nothing can reach Atlas until started again.' : 'Stopped.')
      .addButton((b) => b.setButtonText('Start').onClick(async () => { await this.plugin.start(); this.display(); }))
      .addButton((b) => b.setButtonText('Stop').setWarning().onClick(() => { this.plugin.stop(true); this.display(); }));
  }
}
