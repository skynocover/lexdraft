import { type FC } from 'react';
import { useTabStore } from '../../stores/useTabStore';
import { cleanText } from '../../lib/textUtils';

interface FileRefTagsProps {
  refs: string[];
  fileByName: Map<string, { id: string; filename: string }>;
  keyPrefix?: string;
}

export const FileRefTags: FC<FileRefTagsProps> = ({ refs, fileByName, keyPrefix = '' }) => (
  <>
    {refs.map((ref, i) => {
      const file = fileByName.get(ref);
      const label = cleanText(ref).replace(/\.\w+$/, '');
      return file ? (
        <button
          key={`${keyPrefix}${i}`}
          type="button"
          onClick={() => useTabStore.getState().openFileTab(file.id, file.filename)}
          className="rounded bg-bg-3 px-1.5 py-0.5 text-xs text-t2 transition hover:bg-bg-h hover:text-t1"
        >
          {label}
        </button>
      ) : (
        <span key={`${keyPrefix}${i}`} className="rounded bg-bg-3 px-1.5 py-0.5 text-xs text-t3/60">
          {label}
        </span>
      );
    })}
  </>
);
