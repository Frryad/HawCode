/**
 * The single registry every action in the app is declared in.
 *
 * The command palette lists these, the keyboard layer binds them, and buttons
 * in the UI call the same `run` — so a shortcut and a button can never drift
 * apart. `actions` is the set of callbacks App passes in.
 */
export function buildCommands(actions) {
  const list = [
    {
      id: 'file.quickOpen',
      title: 'Go to File…',
      category: 'File',
      binding: 'ctrl+p',
      run: actions.openQuickOpen
    },
    {
      id: 'file.new',
      title: 'New File',
      category: 'File',
      binding: 'ctrl+n',
      run: () => actions.createEntry('file')
    },
    {
      id: 'file.newFolder',
      title: 'New Folder',
      category: 'File',
      run: () => actions.createEntry('dir')
    },
    {
      id: 'file.save',
      title: 'Save',
      category: 'File',
      binding: 'ctrl+s',
      run: actions.saveActive
    },
    {
      id: 'file.cancel',
      title: 'Cancel Changes (reload from disk)',
      category: 'File',
      run: actions.cancelActive
    },
    {
      id: 'file.toggleSyncMode',
      title: 'Toggle Live / Manual Sync for This File',
      category: 'File',
      run: actions.toggleSyncMode
    },
    {
      id: 'file.closeTab',
      title: 'Close Editor',
      category: 'File',
      binding: 'ctrl+w',
      run: actions.closeActiveTab
    },
    // `native: true` means Monaco (or xterm) already binds this key itself.
    // The palette still lists it and still shows the shortcut, but the global
    // key handler leaves the combination alone — intercepting it would replace
    // a working built-in with a worse copy.
    {
      id: 'edit.undo',
      title: 'Undo',
      category: 'Edit',
      binding: 'ctrl+z',
      native: true,
      run: actions.undo
    },
    {
      id: 'edit.redo',
      title: 'Redo',
      category: 'Edit',
      binding: 'ctrl+y',
      native: true,
      run: actions.redo
    },
    {
      id: 'edit.find',
      title: 'Find in This File',
      category: 'Edit',
      binding: 'ctrl+f',
      native: true,
      run: actions.findInFile
    },
    {
      id: 'edit.format',
      title: 'Format Document',
      category: 'Edit',
      binding: 'shift+alt+f',
      run: actions.formatDocument
    },
    {
      id: 'file.revealFolder',
      title: 'Open Folder in File Explorer',
      category: 'File',
      run: actions.revealFolder
    },
    {
      id: 'view.search',
      title: 'Find in Files',
      category: 'View',
      binding: 'ctrl+shift+f',
      run: () => actions.showSidebar('search')
    },
    {
      id: 'view.files',
      title: 'Show Explorer',
      category: 'View',
      binding: 'ctrl+shift+e',
      run: () => actions.showSidebar('files')
    },
    {
      id: 'view.git',
      title: 'Show Source Control',
      category: 'View',
      binding: 'ctrl+shift+g',
      run: () => actions.showSidebar('git')
    },
    {
      id: 'view.run',
      title: 'Show Scripts',
      category: 'View',
      run: () => actions.showSidebar('run')
    },
    {
      id: 'view.settings',
      title: 'Open Settings',
      category: 'View',
      binding: 'ctrl+,',
      run: actions.openSettings
    },
    {
      id: 'view.splitEditor',
      title: 'Split Editor',
      category: 'View',
      binding: 'ctrl+\\',
      run: actions.toggleSplit
    },
    {
      id: 'terminal.toggle',
      title: 'Toggle Terminal',
      category: 'Terminal',
      binding: 'ctrl+`',
      run: actions.toggleTerminal
    },
    {
      id: 'terminal.new',
      title: 'New Terminal',
      category: 'Terminal',
      binding: 'ctrl+shift+`',
      run: actions.newTerminal
    },
    {
      id: 'terminal.kill',
      title: 'Close Active Terminal',
      category: 'Terminal',
      run: actions.killActiveTerminal
    },
    {
      id: 'sync.pause',
      title: 'Pause Sync',
      category: 'Sync',
      run: actions.pauseSync
    },
    {
      id: 'sync.resume',
      title: 'Resume Sync',
      category: 'Sync',
      run: actions.resumeSync
    },
    {
      id: 'sync.stop',
      title: 'Stop Sync',
      category: 'Sync',
      run: actions.stopSync
    },
    {
      id: 'sync.activity',
      title: 'Show Sync Activity',
      category: 'Sync',
      run: actions.showSyncActivity
    }
  ];

  return list.filter((command) => typeof command.run === 'function');
}

/**
 * Turn the registry into the map `useKeybindings` expects.
 *
 * Commands flagged `native` are skipped: Monaco and xterm already bind those
 * keys, and their own handling is better than anything routed back through
 * React would be.
 */
export function bindingsFrom(commands, extra = {}) {
  const map = { ...extra };
  for (const command of commands) {
    if (command.binding && !command.native) map[command.binding] = () => command.run();
  }
  return map;
}
