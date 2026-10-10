import { useRef, type KeyboardEvent } from 'react'

// Native confirmation keeps focus on the triggering control when dismissed.
export function useHistoryExit(dirty:boolean,onClose:()=>void) {
  const confirming=useRef(false)
  const close=()=>{
    if(confirming.current) return
    confirming.current=true
    try { if(!dirty || confirm('尚有未套用的修改或預覽，確定捨棄並關閉？')) onClose() }
    finally { confirming.current=false }
  }
  const onKeyDown=(e:KeyboardEvent<HTMLElement>)=>{
    if(e.key!=='Escape' || e.repeat || e.defaultPrevented || e.nativeEvent.isComposing) return
    const target=e.target as HTMLElement
    // Escape belongs to native selectors / IME and nested popups first.
    if(target.tagName==='SELECT' || target instanceof HTMLInputElement && target.type==='date' || target.closest('[role="dialog"], [role="listbox"]')) return
    e.preventDefault();e.stopPropagation();close()
  }
  return {close,onKeyDown}
}
