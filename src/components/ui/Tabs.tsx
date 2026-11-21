import { KeyboardEvent, ReactNode, useRef } from 'react';
import { cn } from '@lib/utils';

interface TabItem {
  value: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
}

interface TabsProps {
  tabs: TabItem[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
  variant?: 'default' | 'pills' | 'underline';
  /** Optional <TabPanel> children; they receive the active value through context. */
  children?: ReactNode;
}

export function Tabs({ tabs, value, onChange, className, variant = 'default', children }: TabsProps) {
  const variantStyles = {
    default: 'border-b border-border',
    pills: 'gap-1 bg-muted p-1',
    underline: 'border-b border-border',
  };

  const tabStyles = {
    default: (isActive: boolean) =>
      cn(
        'px-4 py-2 text-sm font-medium transition-colors',
        'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
        isActive
          ? 'border-b-2 border-primary text-primary'
          : 'text-muted-foreground hover:text-foreground'
      ),
    pills: (isActive: boolean) =>
      cn(
        'px-4 py-2 text-sm font-medium rounded-md transition-all',
        'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
        isActive
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground'
      ),
    underline: (isActive: boolean) =>
      cn(
        'relative px-4 py-2 text-sm font-medium transition-colors',
        'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
        isActive
          ? 'text-primary'
          : 'text-muted-foreground hover:text-foreground',
        isActive && 'after:absolute after:bottom-[-1px] after:left-0 after:right-0 after:h-0.5 after:bg-primary after:rounded-full'
      ),
  };

  const listRef = useRef<HTMLDivElement>(null);

  // Arrow keys / Home / End move between tabs (the WAI-ARIA tabs pattern); only the active tab is in the tab order.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const enabled = tabs.filter((t) => !t.disabled);
    const index = enabled.findIndex((t) => t.value === value);
    if (index === -1) return;
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = (index + 1) % enabled.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + enabled.length) % enabled.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = enabled.length - 1;
    if (next === null) return;
    event.preventDefault();
    const target = enabled[next];
    onChange(target.value);
    listRef.current?.querySelector<HTMLButtonElement>(`[data-tab="${CSS.escape(target.value)}"]`)?.focus();
  };

  return (
    <div className={cn('w-full', className)}>
      <div
        ref={listRef}
        role="tablist"
        className={cn('flex overflow-x-auto', variantStyles[variant])}
        aria-label="Tabs"
        onKeyDown={onKeyDown}
      >
        {tabs.map((tab) => (
          <button
            key={tab.value}
            type="button"
            role="tab"
            data-tab={tab.value}
            aria-selected={value === tab.value}
            tabIndex={value === tab.value ? 0 : -1}
            id={`${tab.value}-trigger`}
            disabled={tab.disabled}
            onClick={() => !tab.disabled && onChange(tab.value)}
            className={cn(
              'whitespace-nowrap',
              tabStyles[variant](value === tab.value),
              tab.disabled && 'opacity-50 pointer-events-none'
            )}
          >
            {tab.icon && <span className="mr-2 h-4 w-4">{tab.icon}</span>}
            {tab.label}
          </button>
        ))}
      </div>
      {children && <TabsProvider value={value}>{children}</TabsProvider>}
    </div>
  );
}

interface TabPanelsProps {
  children: ReactNode;
  value: string;
}

export function TabPanels({ children }: TabPanelsProps) {
  return <div>{children}</div>;
}

interface TabPanelProps {
  value: string;
  children: ReactNode;
  className?: string;
}

export function TabPanel({ value, children, className }: TabPanelProps) {
  const context = useTabsContext();
  const isActive = context?.value === value;

  if (!isActive) return null;

  return (
    <div
      role="tabpanel"
      id={`${value}-panel`}
      aria-labelledby={`${value}-trigger`}
      className={cn('animate-in fade-in-0 duration-150', className)}
    >
      {children}
    </div>
  );
}

// Context for TabPanel to know active value
import { createContext, useContext, useMemo } from 'react';

interface TabsContextValue {
  value: string;
}

const TabsContext = createContext<TabsContextValue | null>(null);

export function TabsProvider({ value, children }: { value: string; children: ReactNode }) {
  return (
    <TabsContext.Provider value={useMemo(() => ({ value }), [value])}>
      {children}
    </TabsContext.Provider>
  );
}

function useTabsContext() {
  return useContext(TabsContext);
}