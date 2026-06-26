// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.de>
// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { UI } from "@/lib/uiClasses";

interface TagInputProps {
  readonly tags: string[];
  readonly onChange: (tags: string[]) => void;
  readonly disabled?: boolean;
}

function normalizeTag(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function TagInput({ tags, onChange, disabled }: Readonly<TagInputProps>) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");

  const addTag = useCallback(
    (raw: string) => {
      const tag = normalizeTag(raw);
      if (!tag) return;
      const exists = tags.some((entry) => entry.toLowerCase() === tag.toLowerCase());
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
            key={tag}
            className="inline-flex items-center gap-1 rounded-full border border-vault-tag/40 bg-vault-tag/15 px-2 py-0.5 font-mono text-[10px] text-vault-tag"
          >
            {tag}
            {!disabled && (
              <button
                type="button"
                onClick={() => removeTag(index)}
                className="text-vault-tag/70 hover:text-vault-tag"
                aria-label={t("tags.removeAria", { tag })}
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
        placeholder={t("tags.inputPlaceholder")}
        className={UI.input}
      />
    </div>
  );
}
