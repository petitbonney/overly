import type { JSX } from "preact/jsx-runtime";
import type { Setting, SettingValues } from "./Setting";

export default interface Widget<S extends readonly Setting<any>[]> {
  id: string;
  description: string;
  settings: S;
  render: (values: SettingValues<S>) => JSX.Element;
}
