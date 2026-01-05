import { Select } from "@radix-ui/themes";
import WIDGETS from "../constants/widgets";

interface WidgetSelectorProps {
  value?: string;
  onValueChange?: (v: string) => void;
}

const WidgetSelector = (props: WidgetSelectorProps) => (
  <Select.Root {...props}>
    <Select.Trigger />
    <Select.Content>
      {WIDGETS.map((widget) => (
        <Select.Item value={widget.id}>
          [#{widget.id}] - {widget.description}
        </Select.Item>
      ))}
    </Select.Content>
  </Select.Root>
);

export default WidgetSelector;
