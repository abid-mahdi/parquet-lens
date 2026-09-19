import { describe, expect, it } from 'vitest'
import { nextIndex } from '../../src/hooks/useKeyboardNavigation'

describe('nextIndex', () => {
  it('starts at the first row when nothing is selected and you press down', () => {
    expect(nextIndex('ArrowDown', null, 100, 20)).toBe(0)
  })

  it('ignores up and page-up when nothing is selected', () => {
    expect(nextIndex('ArrowUp', null, 100, 20)).toBeNull()
    expect(nextIndex('PageUp', null, 100, 20)).toBeNull()
  })

  it('moves one row at a time', () => {
    expect(nextIndex('ArrowDown', 5, 100, 20)).toBe(6)
    expect(nextIndex('ArrowUp', 5, 100, 20)).toBe(4)
  })

  it('clamps at both ends instead of wrapping', () => {
    expect(nextIndex('ArrowUp', 0, 100, 20)).toBe(0)
    expect(nextIndex('ArrowDown', 99, 100, 20)).toBe(99)
  })

  it('pages by the viewport size and clamps', () => {
    expect(nextIndex('PageDown', 10, 100, 20)).toBe(30)
    expect(nextIndex('PageDown', 95, 100, 20)).toBe(99)
    expect(nextIndex('PageUp', 10, 100, 20)).toBe(0)
  })

  it('jumps to the ends', () => {
    expect(nextIndex('Home', 50, 100, 20)).toBe(0)
    expect(nextIndex('End', 50, 100, 20)).toBe(99)
  })

  it('returns null for keys it does not handle', () => {
    expect(nextIndex('a', 5, 100, 20)).toBeNull()
    expect(nextIndex('Enter', 5, 100, 20)).toBeNull()
  })

  it('does nothing on an empty table', () => {
    expect(nextIndex('ArrowDown', null, 0, 20)).toBeNull()
    expect(nextIndex('End', null, 0, 20)).toBeNull()
  })
})
