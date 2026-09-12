import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

import type { LinkdqueueBridge } from '../../api/bridge';
import type { SaveConnectionResult, Settings } from '../../api/types';
import ConnectionForm from './ConnectionForm.svelte';

const ready: Settings = {
  status: 'ready',
  canonicalBaseUrl: 'https://linkding.example',
  credentialStatus: 'available',
  errorCode: null,
  allowInsecureHttp: false,
  pendingCleanup: false,
  display: { theme: 'system', textScale: 1 },
  generation: 2,
};
const result: SaveConnectionResult = { settings: ready, warning: null };
const bridge = (
  testConnection = vi.fn().mockResolvedValue({ reachable: true, serverVersion: '1' }),
) => ({ testConnection }) as unknown as LinkdqueueBridge;

function fill() {
  return Promise.all([
    fireEvent.input(screen.getByLabelText('Linkding URL'), {
      target: { value: 'https://linkding.example/' },
    }),
    fireEvent.input(screen.getByLabelText('New API token'), { target: { value: 'secret-token' } }),
  ]);
}

describe('ConnectionForm', () => {
  it('sends exact test and save DTOs and only navigates after ready settings', async () => {
    const testConnection = vi.fn().mockResolvedValue({ reachable: true, serverVersion: '1' });
    const saveConnection = vi.fn().mockResolvedValue(result);
    const onConfigured = vi.fn();
    render(ConnectionForm, {
      props: { bridge: bridge(testConnection), saveConnection, onConfigured },
    });
    await fill();
    await fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(testConnection).toHaveBeenCalledWith({
      baseUrl: 'https://linkding.example/',
      newToken: 'secret-token',
    });
    await fireEvent.input(screen.getByLabelText('New API token'), {
      target: { value: 'new-token' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Save connection' }));
    expect(saveConnection).toHaveBeenCalledWith({
      baseUrl: 'https://linkding.example/',
      newToken: 'new-token',
    });
    expect(onConfigured).toHaveBeenCalledWith(ready);
  });

  it('requires explicit consent for HTTP and prevents duplicate submits', async () => {
    const pending = new Promise<{ reachable: boolean; serverVersion: null }>(() => undefined);
    const testConnection = vi.fn().mockReturnValue(pending);
    render(ConnectionForm, { props: { bridge: bridge(testConnection), saveConnection: vi.fn() } });
    await fireEvent.input(screen.getByLabelText('Linkding URL'), {
      target: { value: 'http://localhost:9090' },
    });
    await fireEvent.input(screen.getByLabelText('New API token'), { target: { value: 'token' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(testConnection).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByLabelText(/HTTP is unencrypted/));
    await fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Testing…' }));
    expect(testConnection).toHaveBeenCalledTimes(1);
    expect(testConnection).toHaveBeenCalledWith({
      baseUrl: 'http://localhost:9090',
      newToken: 'token',
      allowInsecureHttp: true,
    });
  });

  it('does not apply a late test result to an edited draft and retains failed saves', async () => {
    let resolve: (value: { reachable: boolean; serverVersion: string }) => void = () => undefined;
    const testConnection = vi.fn().mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const saveConnection = vi.fn().mockRejectedValue({ code: 'auth_failed', message: 'secret' });
    render(ConnectionForm, { props: { bridge: bridge(testConnection), saveConnection } });
    await fill();
    await fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    await fireEvent.input(screen.getByLabelText('Linkding URL'), {
      target: { value: 'https://other.example' },
    });
    resolve({ reachable: true, serverVersion: '1' });
    await waitFor(() =>
      expect(screen.queryByText('Connection successful.')).not.toBeInTheDocument(),
    );
    await fireEvent.input(screen.getByLabelText('New API token'), {
      target: { value: 'retained-token' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Save connection' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('authentication failed'),
    );
    expect(screen.getByLabelText('New API token')).toHaveValue('retained-token');
  });
});
