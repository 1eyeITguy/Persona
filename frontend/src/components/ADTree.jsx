import { useEffect } from 'react'
import { Folder, User, Monitor, ChevronRight, Loader2, AlertCircle } from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'
import { useADTree } from '../hooks/useADTree.js'

// ---------------------------------------------------------------------------
// TreeNode — a single row in the directory tree
// ---------------------------------------------------------------------------

function TreeNode({ node, depth, treeState, onUserSelect, selectedDn }) {
  const { nodeMap, loadingSet, errorMap, expandedSet, toggleExpand } = treeState
  const isLeaf     = node.type === 'user' || node.type === 'computer'
  const isExpanded = expandedSet.has(node.dn)
  const isLoading  = loadingSet.has(node.dn)
  const isSelected = isLeaf && node.dn === selectedDn
  const error      = errorMap[node.dn]
  const children   = nodeMap[node.dn]

  function handleClick() {
    if (isLeaf) {
      onUserSelect(node.dn)
    } else if (node.has_children) {
      toggleExpand(node.dn)
    }
  }

  return (
    <div>
      {/* Row */}
      <div
        style={{ paddingLeft: `${depth}rem` }}
        onClick={handleClick}
        className={`flex cursor-pointer select-none items-center gap-1.5 rounded-md px-2 py-1 transition-colors ${
          isSelected
            ? 'bg-brand-primary/20 text-brand-primary'
            : 'hover:bg-white/5'
        }`}
      >
        {/* Chevron — only for containers/OUs with children */}
        {!isLeaf ? (
          <ChevronRight
            className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${
              isSelected ? 'text-brand-primary' : 'text-slate-500'
            } ${isExpanded ? 'rotate-90' : ''} ${
              !node.has_children ? 'pointer-events-none opacity-0' : ''
            }`}
          />
        ) : (
          <span className="inline-block h-3.5 w-3.5 shrink-0" />
        )}

        {/* Icon — spinner during fetch, otherwise folder / person / monitor */}
        {isLoading ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-brand-primary" />
        ) : node.type === 'computer' ? (
          <Monitor
            className={`h-4 w-4 shrink-0 ${isSelected ? 'text-brand-primary' : 'text-slate-400'}`}
          />
        ) : node.type === 'user' ? (
          node.photo ? (
            <img
              src={node.photo}
              alt=""
              className={`h-4 w-4 shrink-0 rounded-full object-cover ring-1 ${
                isSelected ? 'ring-brand-primary' : 'ring-slate-600'
              }`}
              onError={e => { e.currentTarget.style.display = 'none' }}
            />
          ) : (
            <User
              className={`h-4 w-4 shrink-0 ${isSelected ? 'text-brand-primary' : 'text-slate-400'}`}
            />
          )
        ) : (
          <Folder
            className={`h-4 w-4 shrink-0 transition-colors ${
              isExpanded ? 'text-brand-primary' : 'text-slate-400'
            }`}
          />
        )}

        {/* Label */}
        <span
          className={`whitespace-nowrap text-sm ${
            isSelected
              ? 'font-medium text-brand-primary'
              : isLeaf
              ? 'text-slate-300 hover:text-white'
              : 'font-medium text-slate-200'
          }`}
        >
          {node.name}
        </span>
      </div>

      {/* Inline error for this node */}
      {error && (
        <div
          style={{ paddingLeft: `${depth + 1.5}rem` }}
          className="flex items-center gap-1 py-0.5 text-xs text-danger"
        >
          <AlertCircle className="h-3 w-3 shrink-0" />
          {error}
        </div>
      )}

      {/* Children */}
      {isExpanded &&
        children?.map(child => (
          <TreeNode
            key={child.dn}
            node={child}
            depth={depth + 1}
            treeState={treeState}
            onUserSelect={onUserSelect}
            selectedDn={selectedDn}
          />
        ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ADTree — root component
// ---------------------------------------------------------------------------

export default function ADTree({ onUserSelect, selectedDn, mode = 'users' }) {
  const { getToken } = useAuth()
  const treeState = useADTree(getToken, mode)
  const { nodeMap, loadingSet, errorMap, rootDn, fetchRoot } = treeState

  // Load the root level once on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchRoot() }, [])

  const isRootLoading = loadingSet.has('__root__')
  const rootError     = errorMap.__root__
  const rootChildren  = rootDn ? nodeMap[rootDn] : null

  if (isRootLoading) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading directory…
      </div>
    )
  }

  if (rootError) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-danger">
        <AlertCircle className="h-4 w-4" />
        {rootError}
      </div>
    )
  }

  if (!rootChildren) return null

  return (
    <div className="min-w-max py-2 pr-4">
      {rootChildren.map(node => (
        <TreeNode
          key={node.dn}
          node={node}
          depth={1}
          treeState={treeState}
          onUserSelect={onUserSelect}
          selectedDn={selectedDn}
        />
      ))}
    </div>
  )
}
