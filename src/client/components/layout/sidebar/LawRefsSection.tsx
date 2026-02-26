import { useBriefStore } from '../../../stores/useBriefStore';
import { useCitedLawRefs } from '../../../hooks/useCitedLawRefs';
import { LawRefCard } from './LawRefCard';

export const LawRefsSection = () => {
  const removeLawRef = useBriefStore((s) => s.removeLawRef);
  const { citedLawRefs, availableLawRefs } = useCitedLawRefs();

  return (
    <div>
      <div className="px-3 py-2">
        {citedLawRefs.length === 0 && availableLawRefs.length === 0 ? (
          <div className="py-2 text-center">
            <p className="text-xs text-t3">尚無法條</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {citedLawRefs.length > 0 &&
              citedLawRefs.map((ref) => (
                <LawRefCard key={ref.id} lawRef={ref} cited onRemove={removeLawRef} />
              ))}
            {availableLawRefs.length > 0 && (
              <>
                <p className="px-1 pt-2 text-xs font-medium text-t3">
                  備用 ({availableLawRefs.length})
                </p>
                {availableLawRefs.map((ref) => (
                  <LawRefCard key={ref.id} lawRef={ref} onRemove={removeLawRef} />
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
