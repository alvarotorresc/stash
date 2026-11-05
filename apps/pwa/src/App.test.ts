import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import App from './App.svelte';

describe('App', () => {
  it('should mount and show the app name', () => {
    render(App);

    expect(screen.getByRole('heading', { level: 1, name: 'Stash' })).toBeTruthy();
  });
});
