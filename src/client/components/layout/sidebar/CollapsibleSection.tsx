import { ChevronRight } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../ui/collapsible';

interface CollapsibleSectionProps {
  title: string;
  count?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

export const CollapsibleSection = ({
  title,
  count,
  open,
  onOpenChange,
  action,
  className,
  children,
}: CollapsibleSectionProps) => {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className={className}>
      <div className="flex items-center border-b border-bd">
        <CollapsibleTrigger className="flex flex-1 items-center gap-2 px-4 py-2.5 text-xs font-medium text-t2 transition hover:bg-bg-h">
          <ChevronRight
            size={14}
            className={`shrink-0 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
          />
          <span>{title}</span>
          {count !== undefined && count > 0 && (
            <span className="rounded-full bg-bg-3 px-1.5 py-0.5 text-[10px] text-t3">{count}</span>
          )}
        </CollapsibleTrigger>
        {action && <div className="pr-3">{action}</div>}
      </div>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  );
};
