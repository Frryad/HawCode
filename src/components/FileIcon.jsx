import React from 'react';
import { fileMeta } from '../lib/languages';

/**
 * The icon for a file, tinted with that language's colour — the same signal
 * VS Code gives you, so HTML, CSS, JS and PHP are told apart at a glance in
 * the tree and on the tabs.
 */
export default function FileIcon({ path, size = 15, className = '', muted = false }) {
  const { icon: Icon, color, label } = fileMeta(path);
  return (
    <Icon
      size={size}
      title={label}
      className={`flex-shrink-0 ${className}`}
      style={{ color, opacity: muted ? 0.55 : 1 }}
    />
  );
}
