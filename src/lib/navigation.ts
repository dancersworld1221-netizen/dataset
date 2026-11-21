import {
  LayoutDashboard,
  Upload,
  Eye,
  CheckCircle,
  BarChart,
  Brain,
  Sparkles,
  Settings as SettingsIcon,
  MessageSquare,
  FileText,
} from 'lucide-react';
import type { NavItem } from '@/types';

export const primaryNavItems: NavItem[] = [
  { label: 'Dashboard', path: '/', icon: LayoutDashboard, description: 'Overview and quick actions' },
  { label: 'Upload Dataset', path: '/upload', icon: Upload, description: 'Import CSV datasets' },
  { label: 'Data Preview', path: '/preview', icon: Eye, description: 'Explore dataset contents' },
  { label: 'Data Quality', path: '/quality', icon: CheckCircle, description: 'Quality metrics and issues' },
  { label: 'Feature Analysis', path: '/analysis', icon: BarChart, description: 'Statistical analysis' },
  { label: 'AI Insights', path: '/insights', icon: Brain, description: 'AI-powered insights from your data' },
  { label: 'Dataset Assistant', path: '/ai-chat', icon: MessageSquare, description: 'Ask questions about your data' },
  { label: 'AI Report', path: '/ai-report', icon: FileText, description: 'AI-generated dataset report' },
  { label: 'Data Cleaning', path: '/cleaning', icon: Sparkles, description: 'Cleaning workflow' },
];

export const secondaryNavItems: NavItem[] = [
  { label: 'Settings', path: '/settings', icon: SettingsIcon, description: 'Application preferences' },
];

export const navItems = [...primaryNavItems, ...secondaryNavItems];

export interface Breadcrumb {
  label: string;
  path?: string;
}

/** Builds "Home / <page>" breadcrumbs for the current pathname. */
export function getBreadcrumbs(pathname: string): Breadcrumb[] {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  if (normalized === '/') {
    return [{ label: 'Dashboard' }];
  }
  const item = navItems.find((entry) => entry.path === normalized);
  return [{ label: 'Home', path: '/' }, { label: item?.label ?? 'Not Found' }];
}
