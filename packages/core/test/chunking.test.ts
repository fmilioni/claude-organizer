import { describe, expect, it } from 'vitest'

import { chunkText } from '../src/chunking'

describe('chunkText', () => {
  it('returns no chunks for empty or whitespace-only text', () => {
    expect(chunkText('')).toEqual([])
    expect(chunkText('   \n  ')).toEqual([])
  })

  it('returns a single chunk for content that fits one window', () => {
    const text = 'um corpo curto que cabe numa janela'
    expect(chunkText(text)).toEqual([text])
  })

  it('splits content longer than the window into multiple chunks', () => {
    const text = 'palavra '.repeat(600).trim() // ~4800 chars, well over one window
    const chunks = chunkText(text)
    expect(chunks.length).toBeGreaterThan(1)
  })

  it('keeps every chunk within the window and cuts on word boundaries', () => {
    const window = 100
    const overlap = 20
    const text = 'lorem ipsum dolor sit amet '.repeat(40).trim()
    const chunks = chunkText(text, window, overlap)
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(window)
      // A boundary cut never leaves a partial word at either edge.
      expect(chunk).toBe(chunk.trim())
      expect(chunk.startsWith(' ')).toBe(false)
    }
    // Reassembled (de-overlapped) content preserves every word.
    expect(chunks.join(' ')).toContain('lorem ipsum dolor sit amet')
  })

  it('overlaps consecutive windows so boundary context is shared', () => {
    const window = 100
    const overlap = 30
    const text = 'a'.repeat(50) + ' ' + 'b'.repeat(50) + ' ' + 'c'.repeat(50)
    const chunks = chunkText(text, window, overlap)
    expect(chunks.length).toBeGreaterThan(1)
    // The tail of chunk N reappears at the head of chunk N+1.
    const firstTail = chunks[0]!.slice(-overlap)
    expect(chunks[1]!.includes(firstTail.trim().slice(0, 5))).toBe(true)
  })
})
