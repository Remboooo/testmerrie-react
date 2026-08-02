import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { usePersistedState } from './usePersistedState';

beforeEach(() => localStorage.clear());

describe('usePersistedState', () => {
  it('uses the default when nothing is stored', () => {
    const { result } = renderHook(() => usePersistedState('k', 42, (v) => parseInt(v)));
    expect(result.current[0]).toBe(42);
  });

  it('initialises from a stored value via parse', () => {
    localStorage.setItem('k', '7');
    const { result } = renderHook(() => usePersistedState('k', 42, (v) => parseInt(v)));
    expect(result.current[0]).toBe(7);
  });

  it('writes changes back to localStorage', () => {
    const { result } = renderHook(() => usePersistedState('k', false, (v) => v === 'true'));
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
    expect(localStorage.getItem('k')).toBe('true');
  });

  it('supports functional updates', () => {
    const { result } = renderHook(() => usePersistedState('n', 1, (v) => parseInt(v)));
    act(() => result.current[1]((prev) => prev + 1));
    expect(result.current[0]).toBe(2);
    expect(localStorage.getItem('n')).toBe('2');
  });
});
