import EntraOnlyList from '../components/EntraOnlyList.jsx'
import EntraUserDetailPanel from '../components/EntraUserDetailPanel.jsx'
import { useState, useRef } from 'react'

export default function EntraOnlyPage() {
  const [selectedUser, setSelectedUser] = useState(null) // { upn, entra_object_id, display_name }
  const [listWidth, setListWidth] = useState(380)
  const containerRef = useRef(null)

  function startResize(e) {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = listWidth
    function onMouseMove(e) {
      const containerWidth = containerRef.current?.getBoundingClientRect().width ?? 9999
      const raw = startWidth + (e.clientX - startX)
      setListWidth(Math.max(240, Math.min(containerWidth - 400, raw)))
    }
    function onMouseUp() {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  return (
    <div ref={containerRef} className="flex h-full overflow-hidden">
      {/* Left: list */}
      <div
        style={selectedUser ? { width: listWidth, minWidth: listWidth } : undefined}
        className={`flex flex-col border-r border-border-subtle ${
          selectedUser ? 'shrink-0' : 'flex-1'
        }`}
      >
        <EntraOnlyList
          selectedUpn={selectedUser?.upn}
          onUserSelect={setSelectedUser}
        />
      </div>

      {/* Drag handle */}
      {selectedUser && (
        <div
          onMouseDown={startResize}
          title="Drag to resize"
          className="w-1 shrink-0 cursor-col-resize select-none bg-border-subtle transition-colors hover:bg-brand-primary/50 active:bg-brand-primary/70"
        />
      )}

      {/* Right: detail panel */}
      {selectedUser && (
        <EntraUserDetailPanel
          user={selectedUser}
          onClose={() => setSelectedUser(null)}
        />
      )}
    </div>
  )
}
