"use client"

import { useState, useCallback, useRef, useEffect } from "react"

export function useDebouncedSearch() {
  const [searchQuery, setSearchQuery] = useState("")
  const [searchTerm, setSearchTerm] = useState("")
  const [debouncedServerQuery, setDebouncedServerQuery] = useState("")
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value)
    if (!value) {
      setSearchTerm("")
      setDebouncedServerQuery("")
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
      return
    }
    setSearchTerm(value)
    if (value.length >= 3) {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = setTimeout(() => setDebouncedServerQuery(value), 300)
    } else {
      setDebouncedServerQuery("")
    }
  }, [])

  const handleSearch = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    setSearchTerm(searchQuery)
    if (searchQuery.length >= 3) setDebouncedServerQuery(searchQuery)
  }, [searchQuery])

  useEffect(() => {
    return () => { if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current) }
  }, [])

  return {
    searchQuery,
    searchTerm,
    debouncedServerQuery,
    handleSearchChange,
    handleSearch,
    setSearchQuery,
  }
}
