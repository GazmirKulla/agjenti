"use client";
import { Icon } from "@/components/dashboard/icon";
import { capabilityGroups, toggleCapabilityGroup } from "@/lib/onboarding/capability-groups";
import type { Choice } from "@/lib/onboarding/rules";

export function CapabilityPicker({ options, selected, onChange }: {
  options: readonly Choice[];
  selected: readonly string[];
  onChange: (selected: string[]) => void;
}) {
  return capabilityGroups(options).map(group => {
    const checked = group.capabilities.every(id => selected.includes(id));
    const partial = !checked && group.capabilities.some(id => selected.includes(id));
    return (
      <label key={group.id} className={`onboarding-option ${checked || partial ? "selected" : ""}`}>
        <input type="checkbox" name="capability-group" value={group.id} checked={checked}
          ref={node => { if (node) node.indeterminate = partial; }}
          onChange={() => onChange(toggleCapabilityGroup(selected, group.capabilities))} />
        <Icon name={group.icon} size={24} />
        <span>{group.label}<small className="onboarding-goal-description">{group.description}</small>
          {partial && <small className="onboarding-goal-description">Disa veprime të këtij grupi janë zgjedhur.</small>}
        </span>
        <span className="onboarding-choice" aria-hidden="true">{checked ? "✓" : partial ? "−" : ""}</span>
      </label>
    );
  });
}
