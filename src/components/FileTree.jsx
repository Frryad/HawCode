import React, { useState } from 'react';
import { Folder, FolderOpen, ChevronRight, ChevronDown } from 'lucide-react';
import { formatBytes } from '../lib/format';
import FileIcon from './FileIcon';
import PeerDot from './PeerDot';

function TreeNode({ node, depth, activeFile, openPaths, peersByPath, onOpenFile, onContextMenu }) {
  const [expanded, setExpanded] = useState(depth < 1);
  const indent = { paddingLeft: `${depth * 12 + 8}px` };

  if (node.type === 'directory') {
    return (
      <div>
        <div
          style={indent}
          onClick={() => setExpanded((value) => !value)}
          onContextMenu={(event) => onContextMenu(event, node)}
          className="flex items-center gap-1.5 py-1 pr-2 rounded-md cursor-pointer text-slate-300 hover:bg-slate-800/70 select-none"
        >
          {expanded
            ? <ChevronDown size={13} className="text-slate-500 flex-shrink-0" />
            : <ChevronRight size={13} className="text-slate-500 flex-shrink-0" />}
          {expanded
            ? <FolderOpen size={15} className="text-indigo-400 flex-shrink-0" />
            : <Folder size={15} className="text-indigo-400 flex-shrink-0" />}
          <span className="truncate font-medium">{node.name}</span>
        </div>
        {expanded && node.children && node.children.map((child) => (
          <TreeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            activeFile={activeFile}
            openPaths={openPaths}
            peersByPath={peersByPath}
            onOpenFile={onOpenFile}
            onContextMenu={onContextMenu}
          />
        ))}
      </div>
    );
  }

  const isActive = activeFile === node.path;
  const isOpen = openPaths && openPaths.has(node.path);
  const watchers = (peersByPath && peersByPath.get(node.path)) || [];

  return (
    <div
      style={indent}
      onClick={() => onOpenFile(node.path)}
      onContextMenu={(event) => onContextMenu(event, node)}
      title={node.path}
      className={`flex items-center gap-1.5 py-1 pr-2 rounded-md cursor-pointer select-none group ${
        isActive
          ? 'bg-indigo-500/20 text-indigo-200 font-medium'
          : isOpen
            ? 'text-slate-300 hover:bg-slate-800/70'
            : 'text-slate-400 hover:text-white hover:bg-slate-800/70'
      }`}
    >
      <span className="w-[13px] flex-shrink-0" />
      <FileIcon path={node.path} muted={!isActive && !isOpen} />
      <span className="truncate">{node.name}</span>

      {watchers.length > 0 && (
        <span className="flex items-center -space-x-1 flex-shrink-0 ml-1">
          {watchers.slice(0, 3).map((peer) => (
            <PeerDot key={peer.peerId} peer={peer} size={13} />
          ))}
        </span>
      )}

      {typeof node.size === 'number' && node.size > 0 && watchers.length === 0 && (
        <span className="ml-auto text-[10px] text-slate-600 group-hover:text-slate-500 flex-shrink-0">
          {formatBytes(node.size)}
        </span>
      )}
    </div>
  );
}

export default function FileTree({
  tree,
  activeFile,
  openPaths,
  peers,
  onOpenFile,
  onContextMenu
}) {
  // Group peers by the file they are in, so the tree can show who is where.
  const peersByPath = React.useMemo(() => {
    const map = new Map();
    for (const peer of peers || []) {
      if (!peer.path) continue;
      if (!map.has(peer.path)) map.set(peer.path, []);
      map.get(peer.path).push(peer);
    }
    return map;
  }, [peers]);

  if (!tree.length) {
    return (
      <div className="text-center text-slate-500 mt-10 p-4">
        <Folder size={30} className="mx-auto mb-2 opacity-40" />
        <p className="text-xs">This folder is empty.</p>
        <p className="text-[11px] text-slate-600 mt-1">
          Drop files into it and they sync automatically.
        </p>
      </div>
    );
  }

  return (
    <div className="text-[13px]">
      {tree.map((node) => (
        <TreeNode
          key={node.path}
          node={node}
          depth={0}
          activeFile={activeFile}
          openPaths={openPaths}
          peersByPath={peersByPath}
          onOpenFile={onOpenFile}
          onContextMenu={onContextMenu}
        />
      ))}
    </div>
  );
}
