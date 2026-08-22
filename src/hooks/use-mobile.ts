import * as React from "react"

import { DESKTOP_MEDIA_QUERY } from "@/lib/responsive"

function subscribe(onStoreChange: () => void) {
  const query = window.matchMedia(DESKTOP_MEDIA_QUERY)
  query.addEventListener("change", onStoreChange)
  return () => query.removeEventListener("change", onStoreChange)
}

function getSnapshot() {
  return !window.matchMedia(DESKTOP_MEDIA_QUERY).matches
}

function getServerSnapshot() {
  return false
}

export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
