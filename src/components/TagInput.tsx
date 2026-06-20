import { useCallback, useState } from "react";

interface TagInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  disabled?: boolean;
}

function normalizeTag(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function TagInput({ tags, onChange, disabled }: TagInputProps) {
  const [draft, setDraft] = useState("");

  const addTag = useCallback(
    (raw: string) => {
      const tag = normalizeTag(raw);
      if (!tag) return;
      const exists = tags.some((t) => t.toLowerCase() === tag.toLowerCase());
      if (exists) {
        setDraft("");
        return;
      }
      onChange([...tags, tag]);
      setDraft("");
    },
    [tags, onChange],
  );

  const removeTag = (index: number) => {
    onChange(tags.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {tags.map((tag, index) => (
          <span
            key={`${tag}-${index}`}
            className="inline-flex items-center gap-1 rounded-full border border-vault-tag/40 bg-vault-tag/15 px-2 py-0.5 font-mono text-[10px] text-vault-tag"
          >
            {tag}
            {!disabled && (
              <button
                type="button"
                onClick={() => removeTag(index)}
                className="text-vault-tag/70 hover:text-vault-tag"
                aria-label={`Tag ${tag} entfernen`}
              >
                ×
              </button>
            )}
          </span>
        ))}
      </div>
      <input
        type="text"
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            addTag(draft);
          } else if (e.key === "Backspace" && !draft && tags.length > 0) {
            removeTag(tags.length - 1);
          }
        }}
        onBlur={() => {
          if (draft.trim()) addTag(draft);
        }}
        placeholder="Tag eingeben, Enter…"
        className="w-full rounded border border-vault-border bg-vault-bg px-3 py-2 font-mono text-sm placeholder:text-vault-muted focus:border-vault-accent outline-none disabled:opacity-50"
      />
    </div>
  );
}
