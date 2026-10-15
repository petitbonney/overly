import {
  type AssetKind,
  AssetsResponseSchema,
  type CreateWidgetBody,
  PluginsResponseSchema,
  type RunActionBody,
  RunActionResponseSchema,
  type UpdateWidgetBody,
  WidgetDetailSchema,
  WidgetsResponseSchema,
} from '@overly/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError, apiDelete, apiGet, apiSend, apiUpload } from './client.js';

export const queryKeys = {
  plugins: ['plugins'] as const,
  widgets: ['widgets'] as const,
  widget: (id: string) => ['widget', id] as const,
  assets: (kinds: readonly AssetKind[]) => ['assets', kinds.join(',')] as const,
};

/** Retries network trouble, but not answers like 404 that won't change. */
function retryUnlessClientError(failures: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status < 500) return false;
  return failures < 2;
}

export function usePlugins() {
  return useQuery({
    queryKey: queryKeys.plugins,
    queryFn: () => apiGet('/api/plugins', PluginsResponseSchema),
  });
}

export function useWidgets() {
  return useQuery({
    queryKey: queryKeys.widgets,
    queryFn: () => apiGet('/api/widgets', WidgetsResponseSchema),
  });
}

export function useWidget(id: string) {
  return useQuery({
    queryKey: queryKeys.widget(id),
    queryFn: () => apiGet(`/api/widgets/${encodeURIComponent(id)}`, WidgetDetailSchema),
    retry: retryUnlessClientError,
  });
}

export function useAssets(kinds: readonly AssetKind[]) {
  return useQuery({
    queryKey: queryKeys.assets(kinds),
    queryFn: () =>
      apiGet(`/api/assets?kind=${encodeURIComponent(kinds.join(','))}`, AssetsResponseSchema),
  });
}

export function useCreateWidget() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateWidgetBody) =>
      apiSend('POST', '/api/widgets', body, WidgetDetailSchema),
    onSuccess: (widget) => {
      client.setQueryData(queryKeys.widget(widget.id), widget);
      void client.invalidateQueries({ queryKey: queryKeys.widgets });
    },
  });
}

export function useUpdateWidget(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateWidgetBody) =>
      apiSend('PATCH', `/api/widgets/${encodeURIComponent(id)}`, body, WidgetDetailSchema),
    onSuccess: (widget) => {
      client.setQueryData(queryKeys.widget(widget.id), widget);
      void client.invalidateQueries({ queryKey: queryKeys.widgets });
    },
  });
}

export function useDeleteWidget() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/api/widgets/${encodeURIComponent(id)}`),
    onSuccess: (_result, id) => {
      client.removeQueries({ queryKey: queryKeys.widget(id) });
      void client.invalidateQueries({ queryKey: queryKeys.widgets });
    },
  });
}

export function useDuplicateWidget() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiSend('POST', `/api/widgets/${encodeURIComponent(id)}/duplicate`, {}, WidgetDetailSchema),
    onSuccess: (widget) => {
      client.setQueryData(queryKeys.widget(widget.id), widget);
      void client.invalidateQueries({ queryKey: queryKeys.widgets });
    },
  });
}

export function useRunAction(widgetId: string) {
  return useMutation({
    mutationFn: ({ action, body }: { action: string; body: Partial<RunActionBody> }) =>
      apiSend(
        'POST',
        `/api/widgets/${encodeURIComponent(widgetId)}/actions/${encodeURIComponent(action)}`,
        body,
        RunActionResponseSchema,
      ),
  });
}

export function useUploadAsset() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => apiUpload(file),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['assets'] });
    },
  });
}

export function useDeleteAsset() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/api/assets/${encodeURIComponent(id)}`),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['assets'] });
    },
  });
}
