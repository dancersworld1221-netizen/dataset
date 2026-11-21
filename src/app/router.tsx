import { createBrowserRouter } from 'react-router-dom';
import { Layout } from '@components/layout/Layout';
import { Dashboard } from '@pages/Dashboard';
import { Upload } from '@pages/Upload';
import { NotFound } from '@pages/NotFound';
import { RouteError } from '@components/common/RouteError';
import { LoadingState } from '@components/common/LoadingState';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    // Shown instead of React Router's raw error screen when a page crashes or a lazy chunk fails to load.
    errorElement: <RouteError />,
    HydrateFallback: () => <LoadingState text="Loading…" />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'upload', element: <Upload /> },
      {
        path: 'preview',
        lazy: async () => {
          const { Preview } = await import('@pages/Preview');
          return { Component: Preview };
        },
      },
      {
        path: 'quality',
        lazy: async () => {
          const { Quality } = await import('@pages/Quality');
          return { Component: Quality };
        },
      },
      {
        path: 'analysis',
        // Loaded on demand: the analytics UI is the largest part of the app.
        lazy: async () => {
          const { FeatureAnalysis } = await import('@pages/FeatureAnalysis');
          return { Component: FeatureAnalysis };
        },
      },
      {
        path: 'insights',
        lazy: async () => {
          const { AIInsights } = await import('@pages/AIInsights');
          return { Component: AIInsights };
        },
      },
      {
        path: 'ai-chat',
        lazy: async () => {
          const { AIChat } = await import('@pages/AIChat');
          return { Component: AIChat };
        },
      },
      {
        path: 'ai-report',
        lazy: async () => {
          const { AIReport } = await import('@pages/AIReport');
          return { Component: AIReport };
        },
      },
      {
        path: 'cleaning',
        lazy: async () => {
          const { Cleaning } = await import('@pages/Cleaning');
          return { Component: Cleaning };
        },
      },
      {
        path: 'settings',
        lazy: async () => {
          const { Settings } = await import('@pages/Settings');
          return { Component: Settings };
        },
      },
      { path: '*', element: <NotFound /> },
    ],
  },
]);
