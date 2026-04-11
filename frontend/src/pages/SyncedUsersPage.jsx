import { useState, useRef } from 'react'
import ADTree from '../components/ADTree.jsx'
import UserDetail from '../components/UserDetail.jsx'
import SearchBar from '../components/SearchBar.jsx'
import SearchResults from '../components/SearchResults.jsx'

export default function SyncedUsersPage() {
  const [selectedUserDn, setSelectedUserDn] = useState(null)
  const [treeWidth, setTreeWidth] = useState(330)
  const containerRef = useRef(null)
  const [searchResults, setSearchResults] = useState(null)
  const [isSearchLoading, setIsSearchLoading] = useState(false)

  const isSearchActive = searchResults !== null

  function startResize(e) {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = treeWidth
    function onMouseMove(e) {
      const containerWidth = containerRef.current?.getBoundingClientRect().width ?? 9999
      const raw = startWidth + (e.clientX - startX)
      setTreeWidth(Math.max(160, Math.min(containerWidth - 400, raw)))
    }
    function onMouseUp() {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  function handleSearchResults(results) {
    setSearchResults(results)
    setIsSearchLoading(false)
    setSelectedUserDn(null)
  }

  function handleSearchClear() {
    setSearchResults(null)
    setIsSearchLoading(false)
    setSelectedUserDn(null)
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <SearchBar
        mode="synced"
        onResults={handleSearchResults}
        onClear={handleSearchClear}
        isActive={isSearchActive}
      />
      <div ref={containerRef} className="flex flex-1 overflow-hidden">
        <div
          style={selectedUserDn ? { width: treeWidth, minWidth: treeWidth } : undefined}
          className={`flex flex-col border-r border-border-subtle ${
            selectedUserDn ? 'shrink-0' : 'flex-1'
          }`}
        >
          <div className="shrink-0 border-b border-border-subtle px-4 py-3">
            <h2 className="text-sm font-medium text-slate-300">
              {isSearchActive
                ? `Results (${searchResults.length})`
                : 'Synced Users'}
            </h2>
          </div>
          <div className="flex-1 overflow-auto">
            {isSearchActive ? (
              <SearchResults
                results={searchResults}
                isLoading={isSearchLoading}
                selectedDn={selectedUserDn}
                onUserSelect={setSelectedUserDn}
              />
            ) : (
              <ADTree
                mode="synced-users"
                showSyncBadge
                onUserSelect={setSelectedUserDn}
                selectedDn={selectedUserDn}
              />
            )}
          </div>
        </div>

        {selectedUserDn && (
          <div
            onMouseDown={startResize}
            title="Drag to resize"
            className="w-1 shrink-0 cursor-col-resize select-none bg-border-subtle transition-colors hover:bg-brand-primary/50 active:bg-brand-primary/70"
          />
        )}

        {selectedUserDn && (
          <UserDetail
            userDn={selectedUserDn}
            mode="merged"
            onClose={() => setSelectedUserDn(null)}
            onUserSelect={setSelectedUserDn}
          />
        )}
      </div>
    </div>
  )
}
