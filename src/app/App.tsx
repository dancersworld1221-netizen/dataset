import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { ToastProvider } from '@components/ui/Toast';
import { DatasetProvider } from '@/context/DatasetProvider';
import { AnalyticsProvider } from '@/context/AnalyticsProvider';

export function App() {
  return (
    <ToastProvider>
      <DatasetProvider>
        <AnalyticsProvider>
          <RouterProvider router={router} />
        </AnalyticsProvider>
      </DatasetProvider>
    </ToastProvider>
  );
}
