import type { JSX } from "preact/compat";

import { TextField } from "@radix-ui/themes";

export interface SettingRenderProps<T> {
  value?: T;
  onValueChange?: (v: T) => void;
  defaultValue?: T;
  args?: any[];
}

export interface Setting<T> {
  id: string;
  required?: boolean;
  hint?: string;
  hintLink?: string;
  defaultValue?: T;
  render?: (props: SettingRenderProps<T>) => JSX.Element;
}

export type SettingValues<S extends readonly Setting<any>[]> = {
  [K in S[number]["id"]]: Extract<S[number], { id: K }> extends Setting<infer V> ? V : never;
};

export const TextFieldConfigurator = ({
  value,
  onValueChange,
  defaultValue,
}: SettingRenderProps<string>) => (
  <TextField.Root
    value={value}
    onChange={(e) => onValueChange && onValueChange(e.currentTarget.value)}
    defaultValue={defaultValue}
  />
);

// export const SelectConfigurator = ({ items, value, onValueChange }: SettingRenderProps<string>) => (
//   <Select.Root {...{ value, onValueChange }}>
//     <Select.Trigger />
//     <Select.Content>
//       {items?.map((item) => (
//         <Select.Item value={item}>item</Select.Item>
//       ))}
//     </Select.Content>
//   </Select.Root>
// );
