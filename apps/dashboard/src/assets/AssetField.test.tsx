import type { Asset } from '@overly/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mockApi } from '../test/api.js';
import { renderWithProviders } from '../test/render.js';
import { AssetField } from './AssetField.js';

const logo: Asset = {
  id: 'abcdefghij12',
  name: 'logo.png',
  kind: 'image',
  mime: 'image/png',
  size: 10,
  sha256: 'a'.repeat(64),
  createdAt: '2026-10-15T09:00:00.000Z',
};
const uploaded: Asset = { ...logo, id: 'uploadedfile', name: 'new.png', sha256: 'b'.repeat(64) };

function api(assets: Asset[] = [logo]) {
  return mockApi(({ method, url }) => {
    if (method === 'GET' && url.startsWith('/api/assets')) return { body: { assets } };
    if (method === 'POST' && url.startsWith('/api/assets')) return { status: 201, body: uploaded };
    if (method === 'DELETE' && url === `/api/assets/${logo.id}`) return { status: 204 };
    return undefined;
  });
}

function Field({ initial, onChange }: { initial: string; onChange: (value: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <AssetField
      label="Image"
      accept={['image']}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AssetField', () => {
  it('shows the selected asset', async () => {
    api();
    renderWithProviders(<Field initial={logo.id} onChange={vi.fn()} />);
    expect(await screen.findByText('logo.png')).toBeInTheDocument();
  });

  it('shows Missing asset for an unknown ID', async () => {
    api();
    renderWithProviders(<Field initial="zzzzzzzzzz99" onChange={vi.fn()} />);
    expect(await screen.findByText('Missing asset')).toBeInTheDocument();
  });

  it('selects an asset from the modal', async () => {
    const calls = api();
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<Field initial="" onChange={onChange} />);
    expect(screen.getByText('None')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Choose…' }));
    await user.click(await screen.findByRole('button', { name: 'Select logo.png' }));
    expect(onChange).toHaveBeenCalledWith(logo.id);
    expect(calls[0]?.url).toBe('/api/assets?kind=image');
  });

  it('uploads a file and selects it', async () => {
    const calls = api();
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<Field initial="" onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Choose…' }));
    await screen.findByRole('button', { name: 'Upload' });
    const input = document.querySelector<HTMLInputElement>('input[type=file]');
    expect(input?.accept).toContain('.png');
    const file = new File(['png'], 'new.png', { type: 'image/png' });
    if (input === null) throw new Error('no file input');
    await user.upload(input, file);
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(uploaded.id);
    });
    expect(calls.find((call) => call.method === 'POST')).toMatchObject({
      url: '/api/assets?name=new.png',
      body: file,
    });
  });

  it('clears the value', async () => {
    api();
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<Field initial={logo.id} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onChange).toHaveBeenCalledWith('');
    expect(screen.getByText('None')).toBeInTheDocument();
  });

  it('deletes an asset after confirmation', async () => {
    const calls = api();
    const user = userEvent.setup();
    renderWithProviders(<Field initial="" onChange={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Choose…' }));
    await user.click(await screen.findByRole('button', { name: 'Delete logo.png' }));
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false);
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(calls.find((call) => call.method === 'DELETE')?.url).toBe(`/api/assets/${logo.id}`);
    });
  });
});
