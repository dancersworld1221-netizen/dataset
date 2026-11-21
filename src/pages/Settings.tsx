import { useEffect, useState } from 'react';
import { User, Palette, Database, Shield, Lock, Info, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@components/ui/Card';
import { Button } from '@components/ui/Button';
import { Badge } from '@components/ui/Badge';
import { PageHeader } from '@components/common/PageHeader';
import { useTheme } from '@hooks/useTheme';
import { useDataset } from '@hooks/useDataset';
import { aiResultStore } from '@/lib/ai/resultStore';
import type { ThemePreference } from '@lib/theme';

const themeOptions: Array<{ value: ThemePreference; label: string }> = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function Settings() {
  const { preference, setTheme } = useTheme();
  const { dataset, clearDataset } = useDataset();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null);

  // How much browser storage the app uses; not every browser can tell.
  useEffect(() => {
    let cancelled = false;
    navigator.storage?.estimate?.().then((estimate) => {
      if (!cancelled && estimate.usage !== undefined && estimate.quota !== undefined) {
        setUsage({ used: estimate.usage, quota: estimate.quota });
      }
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [dataset?.id, dataset?.lastProcessedAt]);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Settings"
        description="Manage your application preferences"
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="h-5 w-5" />
            Appearance
          </CardTitle>
          <CardDescription>Customize the look and feel of the application</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 border border-border rounded-lg">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10">
                <Palette className="h-5 w-5 text-accent" />
              </div>
              <div>
                <p className="font-medium text-foreground">Theme</p>
                <p className="text-sm text-muted-foreground">Light, dark, or system preference</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {themeOptions.map((option) => (
                <Button
                  key={option.value}
                  variant={preference === option.value ? 'primary' : 'outline'}
                  size="sm"
                  aria-pressed={preference === option.value}
                  onClick={() => setTheme(option.value)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between p-4 border border-border rounded-lg">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                <Info className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <p className="font-medium text-foreground">Reduced Motion</p>
                <p className="text-sm text-muted-foreground">Respect system preference for reduced animations</p>
              </div>
            </div>
            <Badge variant="outline">System</Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Privacy & Data
          </CardTitle>
          <CardDescription>Data handling and privacy settings</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 border border-border rounded-lg">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10">
                <Database className="h-5 w-5 text-accent" />
              </div>
              <div>
                <p className="font-medium text-foreground">Local Processing</p>
                <p className="text-sm text-muted-foreground">
                  CSV files are parsed and profiled entirely in your browser
                </p>
              </div>
            </div>
            <Badge variant="success">Active</Badge>
          </div>
          <div className="flex items-center justify-between p-4 border border-border rounded-lg">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10">
                <Lock className="h-5 w-5 text-accent" />
              </div>
              <div>
                <p className="font-medium text-foreground">No Cloud Storage</p>
                <p className="text-sm text-muted-foreground">
                  Datasets are saved only in this browser (IndexedDB); nothing is uploaded to a server
                </p>
              </div>
            </div>
            <Badge variant="success">Active</Badge>
          </div>
          <div className="flex items-center justify-between p-4 border border-border rounded-lg">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-warning/10">
                <Shield className="h-5 w-5 text-warning" />
              </div>
              <div>
                <p className="font-medium text-foreground">AI Processing</p>
                <p className="text-sm text-muted-foreground">
                  AI features send a compact summary (column names, statistics, quality issues, correlations and common
                  values of low-cardinality text columns) to Google Gemini through this app&apos;s server. Raw rows are never sent.
                </p>
              </div>
            </div>
            <Badge variant="info">Summary only</Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Stored data
          </CardTitle>
          <CardDescription>The dataset is kept in this browser so it survives a reload</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-4">
            <div className="min-w-0">
              <p className="font-medium text-foreground">Current dataset</p>
              <p className="truncate text-sm text-muted-foreground" dir="auto">
                {dataset
                  ? `${dataset.filename} — ${dataset.recordCount.toLocaleString()} rows × ${dataset.columnCount} columns`
                  : 'No dataset stored'}
              </p>
              {usage && (
                <p className="text-xs text-muted-foreground">
                  Browser storage in use: {formatBytes(usage.used)} of about {formatBytes(usage.quota)}
                </p>
              )}
            </div>
            {dataset &&
              (confirmDelete ? (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setConfirmDelete(false)}>
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={async () => {
                      aiResultStore.clear();
                      await clearDataset();
                      setConfirmDelete(false);
                    }}
                  >
                    Yes, delete it
                  </Button>
                </div>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setConfirmDelete(true)}>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete stored dataset
                </Button>
              ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Account
          </CardTitle>
          <CardDescription>Account settings and profile information</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 border border-border rounded-lg">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10">
                <User className="h-5 w-5 text-accent" />
              </div>
              <div>
                <p className="font-medium text-foreground">Authentication</p>
                <p className="text-sm text-muted-foreground">Not implemented yet</p>
              </div>
            </div>
            <Badge variant="outline">Planned</Badge>
          </div>
          <div className="flex items-center justify-between p-4 border border-border rounded-lg">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10">
                <Database className="h-5 w-5 text-accent" />
              </div>
              <div>
                <p className="font-medium text-foreground">API Keys</p>
                <p className="text-sm text-muted-foreground">Manage API keys for integrations</p>
              </div>
            </div>
            <Badge variant="outline">Planned</Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Application Info</CardTitle>
          <CardDescription>Version and build information</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Version</span>
            <span className="font-mono">0.2.0</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Framework</span>
            <span className="font-mono">React 19 + TypeScript</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Runtime</span>
            <span className="font-mono">Cloudflare Workers</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Styling</span>
            <span className="font-mono">Tailwind CSS v4</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Build Tool</span>
            <span className="font-mono">Vite</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Router</span>
            <span className="font-mono">React Router v7</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
