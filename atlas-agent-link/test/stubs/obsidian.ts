/**
 * The `obsidian` package on npm only ships types — there is no runtime entry to import. Tests run
 * in Node, so this stub stands in for the handful of runtime values this plugin actually uses.
 * Plugin code that needs Obsidian behaviour is not unit-tested; it is covered by docs/E2E.md.
 */
export class TFile {
  path = '';
  extension = '';
  basename = '';
  name = '';
  constructor(path = '') {
    this.path = path;
    const name = path.split('/').pop() ?? path;
    this.name = name;
    const dot = name.lastIndexOf('.');
    this.extension = dot > 0 ? name.slice(dot + 1) : '';
    this.basename = dot > 0 ? name.slice(0, dot) : name;
  }
}

export class TFolder {
  path = '';
  constructor(path = '') { this.path = path; }
}

export class WorkspaceLeaf {}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\/|\/$/g, '');
}

export class Plugin {}
export class PluginSettingTab {}
export class Setting {}
export class Notice {
  constructor(public message?: string) {}
}
export class ItemView {}
export class FileView {}
export class Modal {}
export class Component {}
