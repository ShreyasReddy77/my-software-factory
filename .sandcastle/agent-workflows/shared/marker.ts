import { isTriggerLabel, type TriggerLabel } from "./labels";

export type MarkerForm = {
  readonly write: (label: TriggerLabel) => string;
  readonly read: (body: string) => string | undefined;
};

const v1: MarkerForm = {
  write: (label) => `<!-- factory:restart-as v1 ${label} -->`,
  read: (body) => /<!-- factory:restart-as v1 (\S+) -->/.exec(body)?.[1],
};

// Current form first. A release that changes the form keeps every form the
// previous release wrote, so items queued before an upgrade still restart.
export const markerForms: readonly [MarkerForm, ...MarkerForm[]] = [v1];

export const writeMarker = (
  label: TriggerLabel,
  forms: readonly [MarkerForm, ...MarkerForm[]] = markerForms
): string => forms[0].write(label);

export const readMarker = (
  body: string,
  forms: readonly MarkerForm[] = markerForms
): TriggerLabel | undefined =>
  forms
    .map((form) => form.read(body))
    .find((label): label is TriggerLabel => label !== undefined && isTriggerLabel(label));
